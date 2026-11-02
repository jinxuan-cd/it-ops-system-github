/**
 * @file backend/src/routes/dashboard.js
 * @description 按今日/本周/本月/上月/本年聚合指标、环比、趋势、类型排名与待办
 *
 * 个人看板路由 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
const express = require('express')
const router = express.Router()
const { query } = require('../db')
const { ok, asyncHandler } = require('../utils/helpers')
const { auth, isViewAll } = require('../middleware/auth')

router.use(auth)

/**
 * 普通表（todo / month_goal / project 等）的个人范围条件，只有 user_id 一个维度。
 * 管理员/审计员带 all=1 时返回空串；注意入参已由内部拼接，不适用于带用户输入的字段。
 *
 * @param {import('express').Request} req
 * @returns {string} 形如 `AND user_id = 3`，无限制时为空串
 */
function scope(req) {
  if (isViewAll(req.user.role) && req.query.all === '1') return ''
  return `AND user_id = ${req.user.user_id}`
}

// 工单口径：自己提的 + 指派/抢单给自己的。
// 员工扫码报障的单 user_id = 0，若不带上 assignee_id，运维个人看板会漏掉自己处理的单
/**
 * 工单专用范围条件：自己提的 + 指派/抢单给自己的，两个维度都要 OR 上。
 * 只按 user_id 过滤会把「别人报、自己处理」的单漏掉，完成量就永远偏低。
 *
 * @param {import('express').Request} req
 * @returns {{sql: string, params: number[]}}
 */
function ticketScope(req) {
  if (isViewAll(req.user.role) && req.query.all === '1') return { sql: '', params: [] }
  const uid = Number(req.user.user_id)
  return { sql: 'AND (user_id = ? OR assignee_id = ?)', params: [uid, uid] }
}

function pad2(n) { return String(n).padStart(2, '0') }
function ymOf(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}` }

// 指标卡片 + 今日工单 + 未完成待办 + 目标进度
/**
 * 首页主看板：一次返回指标卡、今日工单、今日待办、本月目标、到期项目五块数据。
 * 权限：登录即可；管理员/审计员带 all=1 时看全公司，否则只看自己（scope / ticketScope）。
 * 口径：今日/本周/本月受理量按 happen_time，平均处理时长只统计「本月已完成且有完整起止」的单；
 *      周环比 = 本周 - 上周，月环比 = 本月 - 上月；目标进度 = 已完成目标数 / 目标总数。
 *
 * @param {import('express').Request} req query.all=1 时管理员看全员
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/', asyncHandler(async (req, res) => {
  const sc = scope(req)
  // 工单类子查询单独留一个变量：目前与 sc 同源，将来若两类表隔离规则不同可以就地改
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
/**
 * 看板扩展块：本月故障、SLA 超期与临期、满意度、今日是否已巡检、指派给我未完成数。
 * 权限：登录即可；all=1 时故障与工单类指标看全公司，巡检与「指派给我」恒为本人。
 * 口径：SLA soon 取未来 4 小时内到期且未完成的单，用来提示「快超时了」；满意度不限周期。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
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
/**
 * 简易趋势：本周或本月按天返回受理量，只返回有数据的日期。
 * 需要连续时间轴请用 /overview 的 trend（那边会补 0 桶），这里是给旧版小组件留的接口。
 *
 * @param {import('express').Request} req query.range=month 取本月，否则按本周
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
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
/**
 * 饼图分布：本期问题类别、应用系统的占比数据。
 * 口径：按 happen_time 归期，空值不参与分组（否则会出现一个无名扇区）。
 *
 * @param {import('express').Request} req query.range=today|month
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
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
/**
 * 汇总分析：上月与本月的月度指标、环比、本年度 12 个月走势、上月问题类别 TOP8。
 * 权限：登录即可，管理员/审计员带 all=1 看全公司。
 * 口径：受理量按 happen_time、完成量按 finish_time，跨月的单两边都算，所以「上月×本月」允许出现
 *      本月完成里含上月受理的单；完成率分母仍是本期受理。年度平均时长按「有数据的月份」取平均，
 *      空月份不进分母，避免被 0 摊薄。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/summary', asyncHandler(async (req, res) => {
  const sc = ticketScope(req)
  const now = new Date()
  const thisYm = ymOf(now)
  const lastYm = ymOf(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const year = now.getFullYear()

  // 单月指标：受理量按发生时间，完成量按完成时间（与团队分析口径一致）
  /**
   * 算单月指标：受理、完成、完成率、平均时长、SLA 超期、满意度。
   * 两个口径分别查再合并，不能塞进同一条 SQL，否则完成量会被受理时间条件限制住。
   *
   * @param {string} ym 形如 2026-10
   * @returns {Promise<object>}
   */
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
  /**
   * 全年 12 个月走势：受理按 happen_time、完成按 finish_time 各自分组后按月份拼回骨架。
   *
   * @param {number} y 年份
   * @returns {Promise<object>} months 长度恒为 12，空月份补 0
   */
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

/**
 * 把 Date 拼成 MySQL 认的 'YYYY-MM-DD HH:mm:ss'，统一用本地时区（容器已设 Asia/Shanghai）。
 *
 * @param {Date} d
 * @returns {string}
 */
function fmtDT(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

// 计算本期、上期区间，以及趋势分桶粒度
/**
 * 算「本期 + 上一周期」的半开区间 [start, end) 与趋势粒度。
 * 环比一律跟上一个同长度周期比：今日↔昨日、本周↔上周、本月/上月↔再前一个月、本年↔去年；
 * 粒度跟着周期走：今日按小时、周/月/上月按天、本年按月。
 *
 * @param {string} range today|week|month|last_month|year
 * @returns {{start: Date, end: Date, prevStart: Date, prevEnd: Date, label: string, unit: 'hour'|'day'|'month'}}
 */
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
/**
 * 算一个区间的核心指标，cur/prev 都调它，保证环比两端口径一致。
 * 口径：受理、待处理、满意度按发生时间落在区间内；完成量、平均时长按完成时间落在区间内；
 *      done_rate 分母用本区间受理量，跨期完成不会把比率顶过 100%；
 *      sample 是平均时长的有效样本数（含跨天、完成晚于发生的单），前端据此判断要不要显示均值。
 *
 * @param {Date} start 含
 * @param {Date} end 不含
 * @param {{sql: string, params: number[]}} sc 数据隔离条件
 * @returns {Promise<object>}
 */
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
/**
 * 铺出该区间的完整桶骨架：今日 24 个整点桶、按月 12 个桶、按天则从 start 逐日走到 end。
 * 先有骨架再填数，空桶自然补 0，图表不会因为缺数据而「跳日期」。
 *
 * @param {Date} start
 * @param {Date} end 不含
 * @param {'hour'|'day'|'month'} unit
 * @returns {Array<{key: string, label: string}>}
 */
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

/**
 * 双序列趋势：受理按 happen_time 分桶，完成按 finish_time 分桶，再按骨架合并。
 * 空桶补 0；落在骨架外的数据（时区错乱的脏时间）直接丢弃，避免出现孤立柱子。
 *
 * @param {Date} start
 * @param {Date} end 不含
 * @param {'hour'|'day'|'month'} unit
 * @param {{sql: string, params: number[]}} sc
 * @returns {Promise<Array<{label:string, accepted:number, done:number, avg_hours:number|null}>>}
 */
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

/**
 * 整页看板总入口：按 range 一次返回指标、环比、趋势、分布、类别 TOP8、最新工单与右侧待办块。
 * 权限：登录即可，管理员/审计员带 all=1 看全公司。
 * 口径：受理按 happen_time、完成按 finish_time；今日按小时分 24 桶，周/月/上月按天，本年按月，
 *      空桶补 0；环比跟「上一个同长度周期」比（本月↔上月、本年↔去年），日期类给绝对差，
 *      平均时长给差且两端都有值才算，否则返回 null 让前端显示「—」。
 *
 * @param {import('express').Request} req query.range、query.all
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
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
