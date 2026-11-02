const express = require('express')
const router = express.Router()
const { query } = require('../db')
const { ok, asyncHandler } = require('../utils/helpers')
const { auth, isViewAll } = require('../middleware/auth')

router.use(auth)

function scope(req) {
  if (isViewAll(req.user.role) && req.query.all === '1') return ''
  return `AND user_id = ${req.user.user_id}`
}

// 工单口径：自己提的 + 指派/抢单给自己的。
// 员工扫码报障的单 user_id = 0，若不带上 assignee_id，运维个人看板会漏掉自己处理的单
function ticketScope(req) {
  if (isViewAll(req.user.role) && req.query.all === '1') return { sql: '', params: [] }
  const uid = Number(req.user.user_id)
  return { sql: 'AND (user_id = ? OR assignee_id = ?)', params: [uid, uid] }
}

function pad2(n) { return String(n).padStart(2, '0') }
function ymOf(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}` }

// 指标卡片 + 今日工单 + 未完成待办 + 目标进度
router.get('/', asyncHandler(async (req, res) => {
  const sc = scope(req)
  const scT = scope(req, true)
  const cur = `SELECT
      (SELECT COUNT(*) FROM ticket WHERE DATE(happen_time)=CURDATE() ${scT}) AS today_ticket,
      (SELECT COUNT(*) FROM ticket WHERE DATE(happen_time)=CURDATE() AND status='done' ${scT}) AS today_done,
      (SELECT COUNT(*) FROM todo WHERE plan_date=CURDATE() AND is_finish=0 ${sc.replace(/user_id/g,'user_id')}) AS today_todo,
      (SELECT COUNT(*) FROM ticket WHERE YEARWEEK(happen_time,1)=YEARWEEK(CURDATE(),1) ${scT}) AS week_ticket,
      (SELECT COUNT(*) FROM ticket WHERE YEARWEEK(happen_time,1)=YEARWEEK(CURDATE(),1)-1 ${scT}) AS last_week_ticket,
      (SELECT COUNT(*) FROM ticket WHERE DATE_FORMAT(happen_time,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m') ${scT}) AS month_ticket,
      (SELECT COUNT(*) FROM ticket WHERE DATE_FORMAT(happen_time,'%Y-%m')=DATE_FORMAT(DATE_SUB(CURDATE(),INTERVAL 1 MONTH),'%Y-%m') ${scT}) AS last_month_ticket,
      (SELECT ROUND(AVG(TIMESTAMPDIFF(MINUTE,happen_time,finish_time))/60,1) FROM ticket WHERE status='done' AND happen_time IS NOT NULL AND finish_time IS NOT NULL AND finish_time > happen_time AND DATE_FORMAT(happen_time,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m') ${scT}) AS avg_handle_hours,
      (SELECT COUNT(*) FROM ticket WHERE status='done' AND finish_time > happen_time AND DATE_FORMAT(happen_time,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m') ${scT}) AS handle_sample,
      (SELECT COUNT(*) FROM month_goal WHERE is_finish=1 AND goal_month = DATE_FORMAT(CURDATE(),'%Y-%m') ${sc}) AS goal_done,
      (SELECT COUNT(*) FROM month_goal WHERE goal_month = DATE_FORMAT(CURDATE(),'%Y-%m') ${sc}) AS goal_total
    `
  const m = await query(cur)
  const metrics = m[0]

  // 环比
  metrics.week_diff = metrics.week_ticket - metrics.last_week_ticket
  metrics.month_diff = metrics.month_ticket - metrics.last_month_ticket
  metrics.handle_sample = Number(metrics.handle_sample || 0)
  metrics.avg_handle_hours = metrics.avg_handle_hours === null || metrics.avg_handle_hours === undefined
    ? null : Number(metrics.avg_handle_hours)
  metrics.goal_done = metrics.goal_done || 0
  metrics.goal_total = metrics.goal_total || 0
  metrics.goal_progress = metrics.goal_total ? Math.round(metrics.goal_done / metrics.goal_total * 100) : 0

  const t = new Date()
  const month = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`

  const todayTickets = await query(
    `SELECT ticket_id, happen_time, dept, service_content, app_system, problem_type, status FROM ticket
     WHERE DATE(happen_time)=CURDATE() ${scT} ORDER BY happen_time DESC LIMIT 8`
  )
  const pendingTodos = await query(
    `SELECT todo_id, todo_title, plan_date FROM todo WHERE plan_date=CURDATE() AND is_finish=0 ${sc} ORDER BY todo_id DESC LIMIT 8`
  )
  const monthGoals = await query(
    `SELECT goal_id, goal_content, weight_score, is_finish FROM month_goal WHERE goal_month=? ${sc} ORDER BY goal_id DESC`,
    [month]
  )
  // 项目到期提醒：周期已到仍未完成
  const dueProjects = await query(
    `SELECT project_id, project_name, end_date, progress FROM project
     WHERE status='active' AND end_date IS NOT NULL AND end_date < CURDATE() ${sc}
     ORDER BY end_date ASC LIMIT 8`
  )

  ok(res, { metrics, todayTickets, pendingTodos, monthGoals, dueProjects })
}))

// 扩展数据（故障 / 巡检 / SLA / 满意度 / 指派给我）：单独一个接口，首页按需加载，失败不影响主看板
router.get('/extra', asyncHandler(async (req, res) => {
  const uid = req.user.user_id
  const viewAll = isViewAll(req.user.role) && req.query.all === '1'
  const ticketScope = viewAll ? '' : `AND (user_id = ${uid} OR assignee_id = ${uid})`

  const incident = await query(
    `SELECT COUNT(*) AS total, SUM(status='ongoing') AS ongoing,
            SUM(level IN ('P1','P2')) AS serious
     FROM incident WHERE DATE_FORMAT(start_time,'%Y-%m') = DATE_FORMAT(CURDATE(),'%Y-%m') ${viewAll ? '' : `AND user_id = ${uid}`}`
  )
  const sla = await query(
    `SELECT
       SUM(status <> 'done' AND sla_resolve_due IS NOT NULL AND sla_resolve_due < NOW()) AS overdue,
       SUM(status <> 'done' AND sla_resolve_due IS NOT NULL AND sla_resolve_due >= NOW()
           AND sla_resolve_due < DATE_ADD(NOW(), INTERVAL 4 HOUR)) AS soon
     FROM ticket WHERE 1=1 ${ticketScope}`
  )
  const satisfy = await query(
    `SELECT ROUND(AVG(satisfy_score), 2) AS avg_score, COUNT(*) AS cnt
     FROM ticket WHERE satisfy_score IS NOT NULL ${ticketScope}`
  )
  const insp = await query(
    'SELECT COUNT(*) AS cnt FROM inspection WHERE user_id = ? AND insp_date = CURDATE()', [uid]
  )
  const assigned = await query(
    `SELECT COUNT(*) AS cnt FROM ticket WHERE assignee_id = ? AND status <> 'done'`, [uid]
  )

  const i = incident[0] || {}
  const s = sla[0] || {}
  ok(res, {
    incident: {
      total: Number(i.total || 0),
      ongoing: Number(i.ongoing || 0),
      serious: Number(i.serious || 0)
    },
    sla: { overdue: Number(s.overdue || 0), soon: Number(s.soon || 0) },
    satisfy: { avg: Number((satisfy[0] && satisfy[0].avg_score) || 0), count: Number((satisfy[0] && satisfy[0].cnt) || 0) },
    inspection_today: Number((insp[0] && insp[0].cnt) || 0) > 0,
    assigned_to_me: Number((assigned[0] && assigned[0].cnt) || 0)
  })
}))

// 工单趋势（按日）：本周 / 本月
router.get('/trend', asyncHandler(async (req, res) => {
  const sc = scope(req)
  const range = req.query.range === 'month' ? 'month' : 'week'
  let rows
  if (range === 'month') {
    rows = await query(
      `SELECT DATE_FORMAT(happen_time,'%Y-%m-%d') AS d, COUNT(*) AS c FROM ticket
       WHERE DATE_FORMAT(happen_time,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m') ${sc}
       GROUP BY DATE_FORMAT(happen_time,'%Y-%m-%d') ORDER BY d`
    )
  } else {
    rows = await query(
      `SELECT DATE_FORMAT(happen_time,'%Y-%m-%d') AS d, COUNT(*) AS c FROM ticket
       WHERE YEARWEEK(happen_time,1)=YEARWEEK(CURDATE(),1) ${sc}
       GROUP BY DATE_FORMAT(happen_time,'%Y-%m-%d') ORDER BY d`
    )
  }
  ok(res, rows)
}))

// 饼图分布（range: today=当日 / month=本月，默认本月）
router.get('/distribution', asyncHandler(async (req, res) => {
  const sc = scope(req)
  const range = req.query.range === 'today' ? 'today' : 'month'
  const timeCond = range === 'today'
    ? 'AND DATE(happen_time)=CURDATE()'
    : `AND DATE_FORMAT(happen_time,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m')`
  const pt = await query(
    `SELECT problem_type AS name, COUNT(*) AS value FROM ticket WHERE problem_type IS NOT NULL ${timeCond} ${sc} GROUP BY problem_type ORDER BY value DESC`
  )
  const as = await query(
    `SELECT app_system AS name, COUNT(*) AS value FROM ticket WHERE app_system IS NOT NULL ${timeCond} ${sc} GROUP BY app_system ORDER BY value DESC`
  )
  ok(res, { problemType: pt, appSystem: as, range })
}))

// 汇总分析：上月 + 本年度（个人看板用，管理员带 all=1 则为全公司）
router.get('/summary', asyncHandler(async (req, res) => {
  const sc = ticketScope(req)
  const now = new Date()
  const thisYm = ymOf(now)
  const lastYm = ymOf(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const year = now.getFullYear()

  // 单月指标：受理量按发生时间，完成量按完成时间（与团队分析口径一致）
  async function monthOf(ym) {
    const rows = await query(
      `SELECT
         COUNT(*) AS accepted,
         SUM(status = 'done') AS closed,
         ROUND(AVG(CASE WHEN status = 'done' AND finish_time IS NOT NULL AND finish_time > happen_time
                        THEN TIMESTAMPDIFF(MINUTE, happen_time, finish_time) / 60 END), 1) AS avg_hours,
         SUM(CASE WHEN status = 'done' AND sla_resolve_due IS NOT NULL AND finish_time > sla_resolve_due
                  THEN 1 ELSE 0 END) AS sla_overdue,
         ROUND(AVG(satisfy_score), 2) AS satisfy_avg,
         SUM(satisfy_score IS NOT NULL) AS satisfy_cnt
       FROM ticket
       WHERE DATE_FORMAT(happen_time, '%Y-%m') = ? ${sc.sql}`,
      [ym, ...sc.params]
    )
    const done = await query(
      `SELECT COUNT(*) AS c FROM ticket
       WHERE status = 'done' AND finish_time IS NOT NULL AND DATE_FORMAT(finish_time, '%Y-%m') = ? ${sc.sql}`,
      [ym, ...sc.params]
    )
    const r = rows[0] || {}
    const accepted = Number(r.accepted || 0)
    const closed = Number(r.closed || 0)
    return {
      ym,
      label: `${Number(ym.slice(5, 7))} 月`,
      accepted,
      done: Number((done[0] && done[0].c) || 0),
      done_rate: accepted ? Math.round(closed / accepted * 100) : 0,
      avg_hours: r.avg_hours === null || r.avg_hours === undefined ? null : Number(r.avg_hours),
      sla_overdue: Number(r.sla_overdue || 0),
      satisfy_avg: r.satisfy_avg === null || r.satisfy_avg === undefined ? null : Number(r.satisfy_avg),
      satisfy_cnt: Number(r.satisfy_cnt || 0)
    }
  }

  // 本年度按月：12 个月全部铺开，没有数据的月份补 0，避免图表跳月
  async function yearOf(y) {
    const rows = await query(
      `SELECT DATE_FORMAT(happen_time, '%m') AS m, COUNT(*) AS c,
              ROUND(AVG(CASE WHEN status = 'done' AND finish_time IS NOT NULL AND finish_time > happen_time
                             THEN TIMESTAMPDIFF(MINUTE, happen_time, finish_time) / 60 END), 1) AS h
       FROM ticket WHERE YEAR(happen_time) = ? ${sc.sql}
       GROUP BY DATE_FORMAT(happen_time, '%m')`,
      [y, ...sc.params]
    )
    const doneRows = await query(
      `SELECT DATE_FORMAT(finish_time, '%m') AS m, COUNT(*) AS c FROM ticket
       WHERE status = 'done' AND finish_time IS NOT NULL AND YEAR(finish_time) = ? ${sc.sql}
       GROUP BY DATE_FORMAT(finish_time, '%m')`,
      [y, ...sc.params]
    )
    const map = new Map(rows.map(r => [String(r.m), r]))
    const doneMap = new Map(doneRows.map(r => [String(r.m), Number(r.c)]))
    const months = []
    let totalAccepted = 0, totalDone = 0, hoursSum = 0, hoursCnt = 0
    for (let m = 1; m <= 12; m++) {
      const key = pad2(m)
      const r = map.get(key)
      const accepted = Number((r && r.c) || 0)
      const done = doneMap.get(key) || 0
      const avg = r && r.h !== null && r.h !== undefined ? Number(r.h) : null
      totalAccepted += accepted
      totalDone += done
      if (avg !== null) { hoursSum += avg; hoursCnt += 1 }
      months.push({ ym: `${y}-${key}`, label: `${m} 月`, accepted, done, avg_hours: avg })
    }
    return {
      year: y,
      months,
      total_accepted: totalAccepted,
      total_done: totalDone,
      avg_hours: hoursCnt ? Math.round(hoursSum / hoursCnt * 10) / 10 : null
    }
  }

  // 上月问题类别 TOP（个人看板用来回顾"上个月主要在忙什么"）
  const typeRows = await query(
    `SELECT problem_type AS name, COUNT(*) AS value FROM ticket
     WHERE problem_type IS NOT NULL AND problem_type <> '' AND DATE_FORMAT(happen_time, '%Y-%m') = ? ${sc.sql}
     GROUP BY problem_type ORDER BY value DESC LIMIT 8`,
    [lastYm, ...sc.params]
  )

  const [lastMonth, thisMonth, yearStat] = await Promise.all([
    monthOf(lastYm), monthOf(thisYm), yearOf(year)
  ])

  ok(res, {
    last_month: lastMonth,
    this_month: thisMonth,
    // 环比（上月 → 本月）
    diff: {
      accepted: thisMonth.accepted - lastMonth.accepted,
      done: thisMonth.done - lastMonth.done,
      avg_hours: (thisMonth.avg_hours !== null && lastMonth.avg_hours !== null)
        ? Math.round((thisMonth.avg_hours - lastMonth.avg_hours) * 10) / 10 : null
    },
    year: yearStat,
    last_month_types: typeRows.map(r => ({ name: r.name, value: Number(r.value) }))
  })
}))

// =============================================================================
//  整页看板（时间维度驱动）
//  -----------------------------------------------------------------------------
//  GET /api/dashboard/overview?range=today|week|month|last_month|year&all=1
//  一次返回整页所需数据，前端切换维度时整页跟着刷新：
//    metrics      本期受理/完成/完成率/平均时长/超期未完成/满意度 + 上一周期对比
//    trend        按维度自动选择粒度：今日→按小时，周/月→按天，本年→按月
//    distribution 本期问题类别、应用系统分布
//    typeRank     本期问题类别排名 TOP 8
//    recent       本期最新工单
//  口径：受理按 happen_time，完成按 finish_time，
//        平均处理时长只统计「本期完成且有完整起止」的工单。
// =============================================================================
const DASH_RANGES = ['today', 'week', 'month', 'last_month', 'year']

function fmtDT(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

// 计算本期、上期区间，以及趋势分桶粒度
function dashRange(range) {
  const now = new Date()
  const Y = now.getFullYear(), M = now.getMonth(), D = now.getDate()
  let start, end, prevStart, prevEnd, label, unit
  if (range === 'today') {
    start = new Date(Y, M, D); end = new Date(Y, M, D + 1)
    prevStart = new Date(Y, M, D - 1); prevEnd = start
    label = '今日'; unit = 'hour'
  } else if (range === 'week') {
    const dow = (now.getDay() + 6) % 7 // 周一作为一周起点
    start = new Date(Y, M, D - dow); end = new Date(Y, M, D - dow + 7)
    prevStart = new Date(Y, M, D - dow - 7); prevEnd = start
    label = '本周'; unit = 'day'
  } else if (range === 'last_month') {
    start = new Date(Y, M - 1, 1); end = new Date(Y, M, 1)
    prevStart = new Date(Y, M - 2, 1); prevEnd = start
    label = '上月'; unit = 'day'
  } else if (range === 'year') {
    start = new Date(Y, 0, 1); end = new Date(Y + 1, 0, 1)
    prevStart = new Date(Y - 1, 0, 1); prevEnd = start
    label = '本年'; unit = 'month'
  } else {
    start = new Date(Y, M, 1); end = new Date(Y, M + 1, 1)
    prevStart = new Date(Y, M - 1, 1); prevEnd = start
    label = '本月'; unit = 'day'
  }
  return { start, end, prevStart, prevEnd, label, unit }
}

// 单区间核心指标
async function periodStat(start, end, sc) {
  const rows = await query(
    `SELECT
       COUNT(*) AS accepted,
       SUM(status = 'done') AS closed,
       SUM(status <> 'done') AS pending,
       SUM(status <> 'done' AND sla_resolve_due IS NOT NULL AND sla_resolve_due < NOW()) AS overdue_open,
       SUM(status = 'done' AND sla_resolve_due IS NOT NULL AND finish_time IS NOT NULL
           AND finish_time > sla_resolve_due) AS overdue_done,
       ROUND(AVG(satisfy_score), 2) AS satisfy_avg,
       SUM(satisfy_score IS NOT NULL) AS satisfy_cnt
     FROM ticket WHERE happen_time >= ? AND happen_time < ? ${sc.sql}`,
    [fmtDT(start), fmtDT(end), ...sc.params]
  )
  // 完成量与平均时长按完成时间统计，避免「上月单本月才做完」漏算
  const doneRows = await query(
    `SELECT COUNT(*) AS done,
            SUM(finish_time > happen_time) AS sample,
            ROUND(AVG(CASE WHEN finish_time > happen_time
                           THEN TIMESTAMPDIFF(MINUTE, happen_time, finish_time) / 60 END), 1) AS avg_hours
     FROM ticket
     WHERE status = 'done' AND finish_time IS NOT NULL AND finish_time >= ? AND finish_time < ? ${sc.sql}`,
    [fmtDT(start), fmtDT(end), ...sc.params]
  )
  const r = rows[0] || {}
  const d = doneRows[0] || {}
  const accepted = Number(r.accepted || 0)
  const closed = Number(r.closed || 0)
  return {
    accepted,
    done: Number(d.done || 0),
    done_rate: accepted ? Math.round(closed / accepted * 100) : 0,
    pending: Number(r.pending || 0),
    overdue_open: Number(r.overdue_open || 0),
    overdue_done: Number(r.overdue_done || 0),
    avg_hours: d.avg_hours === null || d.avg_hours === undefined ? null : Number(d.avg_hours),
    sample: Number(d.sample || 0),
    satisfy_avg: r.satisfy_avg === null || r.satisfy_avg === undefined ? null : Number(r.satisfy_avg),
    satisfy_cnt: Number(r.satisfy_cnt || 0)
  }
}

// 趋势分桶：按小时 / 按天 / 按月
function bucketKeys(start, end, unit) {
  const list = []
  if (unit === 'hour') {
    for (let h = 0; h < 24; h++) list.push({ key: String(h), label: `${pad2(h)}:00` })
  } else if (unit === 'month') {
    for (let m = 1; m <= 12; m++) list.push({ key: String(m), label: `${m} 月` })
  } else {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    const stop = new Date(end.getFullYear(), end.getMonth(), end.getDate())
    while (d < stop) {
      list.push({
        key: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
        label: `${d.getMonth() + 1}/${d.getDate()}`
      })
      d.setDate(d.getDate() + 1)
    }
  }
  return list
}

async function trendOf(start, end, unit, sc) {
  const accExpr = unit === 'hour' ? `HOUR(happen_time)`
    : unit === 'month' ? `DATE_FORMAT(happen_time,'%c')`
      : `DATE_FORMAT(happen_time,'%Y-%m-%d')`
  const doneExpr = unit === 'hour' ? `HOUR(finish_time)`
    : unit === 'month' ? `DATE_FORMAT(finish_time,'%c')`
      : `DATE_FORMAT(finish_time,'%Y-%m-%d')`

  const accRows = await query(
    `SELECT ${accExpr} AS k, COUNT(*) AS c,
            ROUND(AVG(CASE WHEN status = 'done' AND finish_time IS NOT NULL AND finish_time > happen_time
                           THEN TIMESTAMPDIFF(MINUTE, happen_time, finish_time) / 60 END), 1) AS h
     FROM ticket WHERE happen_time >= ? AND happen_time < ? ${sc.sql}
     GROUP BY ${accExpr}`,
    [fmtDT(start), fmtDT(end), ...sc.params]
  )
  const doneRows = await query(
    `SELECT ${doneExpr} AS k, COUNT(*) AS c FROM ticket
     WHERE status = 'done' AND finish_time IS NOT NULL AND finish_time >= ? AND finish_time < ? ${sc.sql}
     GROUP BY ${doneExpr}`,
    [fmtDT(start), fmtDT(end), ...sc.params]
  )

  const accMap = new Map(accRows.map(r => [String(r.k), r]))
  const doneMap = new Map(doneRows.map(r => [String(r.k), Number(r.c)]))
  const buckets = bucketKeys(start, end, unit)

  return buckets.map(b => {
    const a = accMap.get(b.key)
    return {
      label: b.label,
      accepted: Number((a && a.c) || 0),
      done: doneMap.get(b.key) || 0,
      avg_hours: a && a.h !== null && a.h !== undefined ? Number(a.h) : null
    }
  })
}

router.get('/overview', asyncHandler(async (req, res) => {
  const range = DASH_RANGES.includes(String(req.query.range)) ? String(req.query.range) : 'month'
  const sc = ticketScope(req)
  const scUser = scope(req)
  const rg = dashRange(range)

  const [cur, prev, trend, pt, asys, typeRank, recent] = await Promise.all([
    periodStat(rg.start, rg.end, sc),
    periodStat(rg.prevStart, rg.prevEnd, sc),
    trendOf(rg.start, rg.end, rg.unit, sc),
    query(
      `SELECT problem_type AS name, COUNT(*) AS value FROM ticket
       WHERE happen_time >= ? AND happen_time < ? AND problem_type IS NOT NULL AND problem_type <> '' ${sc.sql}
       GROUP BY problem_type ORDER BY value DESC`,
      [fmtDT(rg.start), fmtDT(rg.end), ...sc.params]
    ),
    query(
      `SELECT app_system AS name, COUNT(*) AS value FROM ticket
       WHERE happen_time >= ? AND happen_time < ? AND app_system IS NOT NULL AND app_system <> '' ${sc.sql}
       GROUP BY app_system ORDER BY value DESC`,
      [fmtDT(rg.start), fmtDT(rg.end), ...sc.params]
    ),
    query(
      `SELECT problem_type AS name, COUNT(*) AS value FROM ticket
       WHERE happen_time >= ? AND happen_time < ? AND problem_type IS NOT NULL AND problem_type <> '' ${sc.sql}
       GROUP BY problem_type ORDER BY value DESC LIMIT 8`,
      [fmtDT(rg.start), fmtDT(rg.end), ...sc.params]
    ),
    query(
      `SELECT ticket_id, report_no, happen_time, dept, service_content, app_system, problem_type, status
       FROM ticket WHERE happen_time >= ? AND happen_time < ? ${sc.sql}
       ORDER BY happen_time DESC LIMIT 8`,
      [fmtDT(rg.start), fmtDT(rg.end), ...sc.params]
    )
  ])

  // 待办 / 月度目标与时间维度无关（本身就按「今日 / 本月」定义），各取各自口径
  const month = ymOf(new Date())
  const [pendingTodos, monthGoals, dueProjects] = await Promise.all([
    query('SELECT todo_id, todo_title, plan_date FROM todo WHERE plan_date = CURDATE() AND is_finish = 0 ' + scUser + ' ORDER BY todo_id DESC LIMIT 8'),
    query('SELECT goal_id, goal_content, weight_score, is_finish FROM month_goal WHERE goal_month = ? ' + scUser + ' ORDER BY goal_id DESC', [month]),
    query(
      `SELECT project_id, project_name, end_date, progress FROM project
       WHERE status = 'active' AND end_date IS NOT NULL AND end_date < CURDATE() ${scUser}
       ORDER BY end_date ASC LIMIT 8`
    )
  ])

  const totalTypes = pt.reduce((s, r) => s + Number(r.value), 0)

  ok(res, {
    range,
    range_label: rg.label,
    start_date: fmtDT(rg.start).slice(0, 10),
    end_date: fmtDT(new Date(rg.end.getTime() - 86400000)).slice(0, 10),
    unit: rg.unit,
    metrics: cur,
    prev,
    diff: {
      accepted: cur.accepted - prev.accepted,
      done: cur.done - prev.done,
      avg_hours: (cur.avg_hours !== null && prev.avg_hours !== null)
        ? Math.round((cur.avg_hours - prev.avg_hours) * 10) / 10 : null
    },
    trend,
    distribution: {
      problemType: pt.map(r => ({ name: r.name, value: Number(r.value) })),
      appSystem: asys.map(r => ({ name: r.name, value: Number(r.value) }))
    },
    typeRank: typeRank.map(r => ({
      name: r.name,
      value: Number(r.value),
      ratio: totalTypes ? Math.round(Number(r.value) / totalTypes * 1000) / 10 : 0
    })),
    recent,
    pendingTodos,
    monthGoals,
    dueProjects
  })
}))

module.exports = router
