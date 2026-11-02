// 团队运营分析（管理员 / 审计员专用）：全公司工单数据的聚合视图
// 设计原则：
//   1) 只给「聚合 + 排名」，明细工单通过下钻接口按需查看（避免一屏堆几百条明细，也符合最小必要原则）
//   2) 完成量统一按 finish_time 统计（员工"干了多少活"），受理量按 happen_time 统计（"来了多少活"）
//   3) 未完成工单只统计「当前积压」，不随所选周期变化，避免误读
const express = require('express')
const router = express.Router()
const { query } = require('../db')
const { ok, fail, asyncHandler } = require('../utils/helpers')
const { auth, canViewAll } = require('../middleware/auth')

// 仅管理员 / 审计员可访问
router.use(auth, canViewAll)

const RANGE_META = {
  today: { label: '今日', prevLabel: '昨日' },
  week: { label: '本周', prevLabel: '上周' },
  month: { label: '本月', prevLabel: '上月' },
  last_month: { label: '上月', prevLabel: '上上月' },
  year: { label: '本年', prevLabel: '去年' }
}

// 工单归属人：已指派/已接单的算处理人，未指派的算提单人。
// 员工扫码报障的单 user_id = 0，若不这样算，运维的完成量会全部漏掉
const OWNER = 'COALESCE(assignee_id, NULLIF(user_id, 0))'

// 生成时间条件（which: cur=本期 / prev=上一期）
function cond(field, range, which = 'cur') {
  const prev = which === 'prev'
  switch (range) {
    case 'today':
      return `DATE(${field}) = ${prev ? 'DATE_SUB(CURDATE(), INTERVAL 1 DAY)' : 'CURDATE()'}`
    case 'week':
      return `YEARWEEK(${field},1) = YEARWEEK(CURDATE(),1)${prev ? ' - 1' : ''}`
    case 'last_month':
      return `DATE_FORMAT(${field},'%Y-%m') = DATE_FORMAT(${prev ? 'DATE_SUB(CURDATE(), INTERVAL 2 MONTH)' : 'DATE_SUB(CURDATE(), INTERVAL 1 MONTH)'},'%Y-%m')`
    case 'year':
      return `YEAR(${field}) = YEAR(CURDATE())${prev ? ' - 1' : ''}`
    case 'month':
    default:
      return `DATE_FORMAT(${field},'%Y-%m') = DATE_FORMAT(${prev ? 'DATE_SUB(CURDATE(), INTERVAL 1 MONTH)' : 'CURDATE()'},'%Y-%m')`
  }
}

// 本期核心指标
async function metricsOf(range, which) {
  const rows = await query(
    `SELECT
       COUNT(*) AS accepted,
       SUM(status = 'done') AS closed_in_period,
       ROUND(AVG(CASE WHEN status = 'done' AND finish_time IS NOT NULL AND happen_time IS NOT NULL
                           AND finish_time > happen_time
                      THEN TIMESTAMPDIFF(MINUTE, happen_time, finish_time) / 60 END), 1) AS avg_hours,
       COUNT(DISTINCT user_id) AS active_users
     FROM ticket WHERE ${cond('happen_time', range, which)}`
  )
  const doneRows = await query(
    `SELECT COUNT(*) AS done_cnt FROM ticket
     WHERE status = 'done' AND finish_time IS NOT NULL AND ${cond('finish_time', range, which)}`
  )
  const m = rows[0] || {}
  const accepted = Number(m.accepted || 0)
  const closed = Number(m.closed_in_period || 0)
  const done = Number(doneRows[0].done_cnt || 0)
  return {
    accepted,
    done,                       // 本期完成量（按完成时间，反映"干了多少活"）
    closed_in_period: closed,   // 本期受理且已闭环（用于完成率）
    avg_hours: m.avg_hours === null || m.avg_hours === undefined ? null : Number(m.avg_hours),
    active_users: Number(m.active_users || 0),
    // 完成率分母用「本期受理」，避免跨期完成导致超过 100%
    done_rate: accepted ? Math.round(closed / accepted * 100) : 0
  }
}

// 当前积压（不随周期变化）：未完成工单，及其中超过 24h / 72h 未闭环的
async function backlogOf() {
  const rows = await query(
    `SELECT
       COUNT(*) AS backlog,
       SUM(happen_time IS NOT NULL AND happen_time < DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS over24,
       SUM(happen_time IS NOT NULL AND happen_time < DATE_SUB(NOW(), INTERVAL 72 HOUR)) AS over72
     FROM ticket WHERE status <> 'done'`
  )
  const r = rows[0] || {}
  return {
    backlog: Number(r.backlog || 0),
    over24: Number(r.over24 || 0),
    over72: Number(r.over72 || 0)
  }
}

// 趋势：今日按小时，本周/本月按天，上月/本年按月；双序列（受理 / 完成）
// 时间轴按周期完整铺开（没有数据的日期补 0），否则图表会「跳日期」，看起来像数据拉取异常
function pad(n) { return String(n).padStart(2, '0') }
function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

function bucketsOf(range) {
  const now = new Date()
  const out = []
  if (range === 'today') {
    for (let h = 0; h < 24; h++) out.push(pad(h))
  } else if (range === 'week') {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dow = (base.getDay() + 6) % 7 // 周一为 0，与 YEARWEEK(...,1) 对齐
    base.setDate(base.getDate() - dow)
    for (let i = 0; i < 7; i++) {
      const x = new Date(base); x.setDate(base.getDate() + i); out.push(fmtDate(x))
    }
  } else if (range === 'month') {
    const y = now.getFullYear(), m = now.getMonth()
    const days = new Date(y, m + 1, 0).getDate()
    for (let i = 1; i <= days; i++) out.push(`${y}-${pad(m + 1)}-${pad(i)}`)
  } else if (range === 'last_month') {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    for (let i = 1; i <= days; i++) out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(i)}`)
  } else {
    for (let i = 1; i <= 12; i++) out.push(`${now.getFullYear()}-${pad(i)}`)
  }
  return out
}

async function trendOf(range) {
  let bucket, whereCur, doneWhere
  if (range === 'today') {
    bucket = `DATE_FORMAT(happen_time, '%H')`
    whereCur = cond('happen_time', 'today')
    doneWhere = cond('finish_time', 'today')
  } else if (range === 'last_month' || range === 'year') {
    bucket = `DATE_FORMAT(happen_time, '%Y-%m')`
    whereCur = cond('happen_time', range)
    doneWhere = cond('finish_time', range)
  } else {
    bucket = `DATE_FORMAT(happen_time, '%Y-%m-%d')`
    whereCur = cond('happen_time', range)
    doneWhere = cond('finish_time', range)
  }
  const accept = await query(
    `SELECT ${bucket} AS b, COUNT(*) AS c FROM ticket WHERE ${whereCur} GROUP BY b`
  )
  // 完成序列按完成时间分桶，bucket 表达式换成 finish_time
  const doneBucket = bucket.replace(/happen_time/g, 'finish_time')
  const done = await query(
    `SELECT ${doneBucket} AS b, COUNT(*) AS c FROM ticket
     WHERE status = 'done' AND finish_time IS NOT NULL AND ${doneWhere} GROUP BY b`
  )
  // 以完整时间轴为骨架，两边数据按 key 填入；落在轴外的数据（异常时间）忽略，避免出现孤立柱子
  const map = new Map()
  bucketsOf(range).forEach(k => map.set(k, { key: k, accepted: 0, done: 0 }))
  accept.forEach(r => { if (map.has(r.b)) map.get(r.b).accepted = Number(r.c) })
  done.forEach(r => { if (map.has(r.b)) map.get(r.b).done = Number(r.c) })
  return [...map.values()]
}

// 人员产能排名：本期完成量 / 受理量 / 当前积压 / 平均时长 / 知识沉淀
async function userRankOf(range) {
  const rows = await query(
    `SELECT u.user_id, u.username, u.real_name, u.role,
            COALESCE(d.done_cnt, 0)  AS done_cnt,
            COALESCE(d.avg_hours, 0) AS avg_hours,
            COALESCE(a.accept_cnt, 0) AS accept_cnt,
            COALESCE(a.closed_cnt, 0) AS closed_cnt,
            COALESCE(b.backlog, 0)   AS backlog,
            COALESCE(k.kb_cnt, 0)    AS kb_cnt
     FROM sys_user u
     LEFT JOIN (
       SELECT ${OWNER} AS uid, COUNT(*) AS done_cnt,
              ROUND(AVG(CASE WHEN happen_time IS NOT NULL AND finish_time > happen_time
                             THEN TIMESTAMPDIFF(MINUTE, happen_time, finish_time) / 60 END), 1) AS avg_hours
       FROM ticket WHERE status = 'done' AND finish_time IS NOT NULL AND ${cond('finish_time', range)}
       GROUP BY ${OWNER}
     ) d ON d.uid = u.user_id
     LEFT JOIN (
       SELECT ${OWNER} AS uid, COUNT(*) AS accept_cnt, SUM(status = 'done') AS closed_cnt
       FROM ticket WHERE ${cond('happen_time', range)} GROUP BY ${OWNER}
     ) a ON a.uid = u.user_id
     LEFT JOIN (
       SELECT ${OWNER} AS uid, COUNT(*) AS backlog FROM ticket WHERE status <> 'done' GROUP BY ${OWNER}
     ) b ON b.uid = u.user_id
     LEFT JOIN (
       SELECT user_id, COUNT(*) AS kb_cnt FROM knowledge GROUP BY user_id
     ) k ON k.user_id = u.user_id
     WHERE u.is_enable = 1
     ORDER BY done_cnt DESC, accept_cnt DESC, u.user_id`
  )
  return rows.map(r => ({
    ...r,
    done_cnt: Number(r.done_cnt),
    accept_cnt: Number(r.accept_cnt),
    closed_cnt: Number(r.closed_cnt),
    backlog: Number(r.backlog),
    kb_cnt: Number(r.kb_cnt),
    avg_hours: Number(r.avg_hours || 0),
    done_rate: Number(r.accept_cnt) ? Math.round(Number(r.closed_cnt) / Number(r.accept_cnt) * 100) : 0
  }))
}

// 维度排名（问题类别 / 应用系统 / 部门），带占比与累计占比，用于帕累托分析
async function rankOf(field, range, limit = 10) {
  const rows = await query(
    `SELECT ${field} AS name, COUNT(*) AS value,
            SUM(status = 'done') AS done,
            ROUND(AVG(CASE WHEN status = 'done' AND finish_time IS NOT NULL AND happen_time IS NOT NULL
                                AND finish_time > happen_time
                           THEN TIMESTAMPDIFF(MINUTE, happen_time, finish_time) / 60 END), 1) AS avg_hours
     FROM ticket
     WHERE ${field} IS NOT NULL AND ${field} <> '' AND ${cond('happen_time', range)}
     GROUP BY ${field} ORDER BY value DESC`
  )
  const total = rows.reduce((s, r) => s + Number(r.value), 0)
  let cum = 0
  const all = rows.map(r => {
    const value = Number(r.value)
    cum += value
    return {
      name: r.name,
      value,
      done: Number(r.done),
      avg_hours: Number(r.avg_hours || 0),
      ratio: total ? Math.round(value / total * 1000) / 10 : 0,
      cum_ratio: total ? Math.round(cum / total * 1000) / 10 : 0
    }
  })
  return { list: all.slice(0, limit), total, kinds: all.length }
}

// 近 6 个月趋势（月度复盘用）
async function monthlyTrendOf() {
  const rows = await query(
    `SELECT DATE_FORMAT(happen_time, '%Y-%m') AS m,
            COUNT(*) AS accepted,
            SUM(status = 'done') AS done
     FROM ticket
     WHERE happen_time >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
     GROUP BY m ORDER BY m`
  )
  return rows.map(r => ({ month: r.m, accepted: Number(r.accepted), done: Number(r.done) }))
}

// 超期未闭环工单（重点标记对象）
// 注意：age_hours 用 GREATEST(...,0) 兜底，出现「已挂 -7h」这类负值一定是服务器时区不一致，不允许直接展示
async function overdueOf(limit = 20) {
  const rows = await query(
    `SELECT t.ticket_id, t.user_id, u.real_name, t.happen_time, t.dept, t.app_system,
            t.problem_type, t.service_content, t.status,
            GREATEST(TIMESTAMPDIFF(MINUTE, t.happen_time, NOW()), 0) AS age_min
     FROM ticket t LEFT JOIN sys_user u ON u.user_id = t.user_id
     WHERE t.status <> 'done' AND t.happen_time IS NOT NULL
     ORDER BY t.happen_time ASC LIMIT ?`,
    [String(limit)]
  )
  return rows.map(r => ({
    ...r,
    age_min: Number(r.age_min || 0),
    age_hours: Math.floor(Number(r.age_min || 0) / 60)
  }))
}

// 超期未闭环工单：分页取（首页只给 10 条，避免积压一多把整页拉长）
async function overduePage(page = 1, size = 10, userId = 0) {
  const p = Math.max(1, Number(page) || 1)
  const s = Math.min(50, Math.max(1, Number(size) || 10))
  const userCond = userId ? 'AND t.user_id = ?' : ''
  const userParam = userId ? [userId] : []
  const cnt = await query(
    `SELECT COUNT(*) AS c FROM ticket t WHERE t.status <> 'done' AND t.happen_time IS NOT NULL ${userCond}`,
    userParam
  )
  const rows = await query(
    `SELECT t.ticket_id, t.user_id, u.real_name, t.happen_time, t.dept, t.app_system,
            t.problem_type, t.service_content, t.status,
            GREATEST(TIMESTAMPDIFF(MINUTE, t.happen_time, NOW()), 0) AS age_min
     FROM ticket t LEFT JOIN sys_user u ON u.user_id = t.user_id
     WHERE t.status <> 'done' AND t.happen_time IS NOT NULL ${userCond}
     ORDER BY t.happen_time ASC LIMIT ? OFFSET ?`,
    [...userParam, String(s), String((p - 1) * s)]
  )
  return {
    list: rows.map(r => ({
      ...r,
      age_min: Number(r.age_min || 0),
      age_hours: Math.floor(Number(r.age_min || 0) / 60)
    })),
    total: Number((cnt[0] && cnt[0].c) || 0),
    page: p,
    size: s
  }
}

// 知识沉淀（团队视角）
async function knowledgeStat(range) {
  const rows = await query(
    `SELECT
       (SELECT COUNT(*) FROM knowledge) AS kb_total,
       (SELECT COUNT(*) FROM knowledge WHERE ${cond('create_time', range)}) AS kb_new,
       (SELECT COUNT(*) FROM knowledge WHERE view_count > 0) AS kb_used
    `
  )
  const r = rows[0] || {}
  return { kb_total: Number(r.kb_total || 0), kb_new: Number(r.kb_new || 0), kb_used: Number(r.kb_used || 0) }
}

// SLA 时效达成情况（响应达成率 / 解决达成率 / 当前超出时限数）
async function slaOf(range) {
  const rows = await query(
    `SELECT
       SUM(sla_respond_due IS NOT NULL) AS with_sla,
       SUM(respond_time IS NOT NULL AND sla_respond_due IS NOT NULL) AS respond_base,
       SUM(respond_time IS NOT NULL AND sla_respond_due IS NOT NULL AND respond_time <= sla_respond_due) AS respond_ok,
       SUM(status = 'done' AND finish_time IS NOT NULL AND sla_resolve_due IS NOT NULL) AS resolve_base,
       SUM(status = 'done' AND finish_time IS NOT NULL AND sla_resolve_due IS NOT NULL AND finish_time <= sla_resolve_due) AS resolve_ok,
       SUM(status <> 'done' AND sla_resolve_due IS NOT NULL AND sla_resolve_due < NOW()) AS overdue_now
     FROM ticket WHERE ${cond('happen_time', range)}`
  )
  const r = rows[0] || {}
  const total = Number(r.with_sla || 0)
  const rBase = Number(r.respond_base || 0)
  const sBase = Number(r.resolve_base || 0)
  return {
    sla_total: total,
    respond_ok: Number(r.respond_ok || 0),
    resolve_ok: Number(r.resolve_ok || 0),
    respond_base: rBase,
    resolve_base: sBase,
    sla_overdue_now: Number(r.overdue_now || 0),
    // 分母用「有实际响应记录的工单」：历史导入数据没有接单时间，不应算作未及时响应
    respond_rate: rBase ? Math.round(Number(r.respond_ok || 0) / rBase * 100) : null,
    resolve_rate: sBase ? Math.round(Number(r.resolve_ok || 0) / sBase * 100) : null
  }
}

// 满意度（只有报障人评价过才有数据）
async function satisfyOf(range) {
  const rows = await query(
    `SELECT ROUND(AVG(satisfy_score), 2) AS avg_score, COUNT(*) AS cnt,
            SUM(satisfy_score >= 4) AS good, SUM(satisfy_score <= 2) AS bad
     FROM ticket WHERE satisfy_score IS NOT NULL AND ${cond('finish_time', range)}`
  )
  const r = rows[0] || {}
  const cnt = Number(r.cnt || 0)
  return {
    score: Number(r.avg_score || 0),
    count: cnt,
    good_rate: cnt ? Math.round(Number(r.good || 0) / cnt * 100) : 0,
    bad: Number(r.bad || 0)
  }
}

// 故障（事件）统计：没有记录时 total=0，前端据此整块隐藏
async function incidentOf(range) {
  const rows = await query(
    `SELECT COUNT(*) AS total, SUM(status = 'ongoing') AS ongoing,
            SUM(level IN ('P1','P2')) AS serious,
            ROUND(AVG(CASE WHEN start_time IS NOT NULL AND finish_time IS NOT NULL AND finish_time >= start_time
                           THEN TIMESTAMPDIFF(MINUTE, start_time, finish_time) END) / 60, 1) AS avg_hours,
            ROUND(AVG(CASE WHEN start_time IS NOT NULL AND accept_time IS NOT NULL AND accept_time >= start_time
                           THEN TIMESTAMPDIFF(MINUTE, start_time, accept_time) END), 0) AS avg_respond_min
     FROM incident WHERE ${cond('start_time', range)}`
  )
  const r = rows[0] || {}
  const byLevel = await query(
    `SELECT level AS name, COUNT(*) AS value FROM incident WHERE ${cond('start_time', range)} GROUP BY level ORDER BY level`
  )
  return {
    total: Number(r.total || 0),
    ongoing: Number(r.ongoing || 0),
    serious: Number(r.serious || 0),
    avg_hours: Number(r.avg_hours || 0),
    avg_respond_min: Number(r.avg_respond_min || 0),
    byLevel: byLevel.map(x => ({ name: x.name, value: Number(x.value) }))
  }
}

// 总览：一次返回看板所需的全部聚合数据
router.get('/overview', asyncHandler(async (req, res) => {
  const range = RANGE_META[req.query.range] ? req.query.range : 'month'
  const [cur, prev, backlog, trend, userRank, problemRank, appRank, deptRank, monthlyTrend, od, kb, sla, satisfy, incident] = await Promise.all([
    metricsOf(range, 'cur'),
    metricsOf(range, 'prev'),
    backlogOf(),
    trendOf(range),
    userRankOf(range),
    rankOf('problem_type', range, 10),
    rankOf('app_system', range, 10),
    rankOf('dept', range, 8),
    monthlyTrendOf(),
    overduePage(1, 10),
    knowledgeStat(range),
    slaOf(range),
    satisfyOf(range),
    incidentOf(range)
  ])

  const activeUsers = cur.active_users || 0
  ok(res, {
    range,
    range_label: RANGE_META[range].label,
    prev_label: RANGE_META[range].prevLabel,
    metrics: {
      ...cur,
      ...backlog,
      per_capita: activeUsers ? Math.round(cur.done / activeUsers * 10) / 10 : 0,
      kb_total: kb.kb_total,
      kb_new: kb.kb_new,
      kb_used: kb.kb_used,
      // 环比（与上一周期对比）
      accepted_diff: cur.accepted - prev.accepted,
      done_diff: cur.done - prev.done,
      hours_diff: Math.round((cur.avg_hours - prev.avg_hours) * 10) / 10,
      prev
    },
    trend,
    userRank,
    problemRank,
    appRank,
    deptRank,
    monthlyTrend,
    overdue: od.list,
    overdue_total: od.total,
    sla,
    satisfy,
    incident
  })
}))

// 下钻：某人本期工单明细（只读）
router.get('/user-tickets', asyncHandler(async (req, res) => {
  const userId = Number(req.query.user_id)
  if (!userId) return ok(res, [])
  const range = RANGE_META[req.query.range] ? req.query.range : 'month'
  const rows = await query(
    `SELECT t.ticket_id, t.happen_time, t.finish_time, t.dept, t.app_system, t.problem_type,
            t.service_content, t.handle_desc, t.status,
            CASE WHEN t.status = 'done' AND t.happen_time IS NOT NULL AND t.finish_time >= t.happen_time
                 THEN ROUND(TIMESTAMPDIFF(MINUTE, t.happen_time, t.finish_time) / 60, 1) END AS hours
     FROM ticket t
     WHERE t.user_id = ?
       AND ((${cond('t.happen_time', range)}) OR (t.status = 'done' AND ${cond('t.finish_time', range)}))
     ORDER BY t.happen_time DESC, t.ticket_id DESC LIMIT 200`,
    [userId]
  )
  ok(res, rows.map(r => ({ ...r, hours: r.hours == null ? null : Number(r.hours) })))
}))

// 超期未闭环工单：分页接口（团队分析右侧列表，积压再多也只占一屏）
router.get('/overdue', asyncHandler(async (req, res) => {
  const data = await overduePage(req.query.page, req.query.size, Number(req.query.user_id) || 0)
  ok(res, data)
}))

// 人员维度分析：选定一个员工，只看他自己的工单情况
router.get('/person', asyncHandler(async (req, res) => {
  const userId = Number(req.query.user_id)
  if (!userId) return fail(res, '请先选择员工')
  const range = RANGE_META[req.query.range] ? req.query.range : 'month'
  const users = await query('SELECT user_id, username, real_name, role, is_enable FROM sys_user WHERE user_id = ?', [userId])
  if (!users.length) return fail(res, '员工不存在')
  const u = users[0]

  const bucket = range === 'today'
    ? `DATE_FORMAT(happen_time, '%H')`
    : (range === 'last_month' || range === 'year' ? `DATE_FORMAT(happen_time, '%Y-%m')` : `DATE_FORMAT(happen_time, '%Y-%m-%d')`)
  const doneBucket = bucket.replace(/happen_time/g, 'finish_time')

  const [base, doneRow, backlog, overdueSla, satisfyRow, typeRows, appRows, acceptRows, doneRows, recent, kbRow] = await Promise.all([
    query(
      `SELECT COUNT(*) AS accepted, SUM(status = 'done') AS closed,
              SUM(status = 'pending') AS pending, SUM(status = 'processing') AS processing
       FROM ticket WHERE ${OWNER} = ? AND ${cond('happen_time', range)}`, [userId]
    ),
    query(
      `SELECT COUNT(*) AS done,
              ROUND(AVG(CASE WHEN happen_time IS NOT NULL AND finish_time > happen_time
                             THEN TIMESTAMPDIFF(MINUTE, happen_time, finish_time) / 60 END), 1) AS avg_hours,
              SUM(CASE WHEN sla_resolve_due IS NOT NULL AND finish_time > sla_resolve_due THEN 1 ELSE 0 END) AS sla_overdue
       FROM ticket WHERE ${OWNER} = ? AND status = 'done' AND finish_time IS NOT NULL AND ${cond('finish_time', range)}`,
      [userId]
    ),
    query(
      `SELECT COUNT(*) AS backlog,
              SUM(happen_time IS NOT NULL AND happen_time < DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS over24,
              SUM(happen_time IS NOT NULL AND happen_time < DATE_SUB(NOW(), INTERVAL 72 HOUR)) AS over72
       FROM ticket WHERE ${OWNER} = ? AND status <> 'done'`, [userId]
    ),
    query(
      `SELECT COUNT(*) AS c FROM ticket
       WHERE ${OWNER} = ? AND status <> 'done' AND sla_resolve_due IS NOT NULL AND sla_resolve_due < NOW()`, [userId]
    ),
    query(
      `SELECT ROUND(AVG(satisfy_score), 2) AS avg_score, COUNT(*) AS cnt FROM ticket
       WHERE ${OWNER} = ? AND satisfy_score IS NOT NULL AND ${cond('finish_time', range)}`, [userId]
    ),
    query(
      `SELECT problem_type AS name, COUNT(*) AS value FROM ticket
       WHERE ${OWNER} = ? AND problem_type IS NOT NULL AND problem_type <> '' AND ${cond('happen_time', range)}
       GROUP BY problem_type ORDER BY value DESC LIMIT 8`, [userId]
    ),
    query(
      `SELECT app_system AS name, COUNT(*) AS value FROM ticket
       WHERE ${OWNER} = ? AND app_system IS NOT NULL AND app_system <> '' AND ${cond('happen_time', range)}
       GROUP BY app_system ORDER BY value DESC LIMIT 8`, [userId]
    ),
    query(`SELECT ${bucket} AS b, COUNT(*) AS c FROM ticket WHERE ${OWNER} = ? AND ${cond('happen_time', range)} GROUP BY b`, [userId]),
    query(
      `SELECT ${doneBucket} AS b, COUNT(*) AS c FROM ticket
       WHERE ${OWNER} = ? AND status = 'done' AND finish_time IS NOT NULL AND ${cond('finish_time', range)} GROUP BY b`, [userId]
    ),
    query(
      `SELECT ticket_id, report_no, happen_time, finish_time, dept, app_system, problem_type,
              service_content, status, priority,
              CASE WHEN status = 'done' AND happen_time IS NOT NULL AND finish_time >= happen_time
                   THEN ROUND(TIMESTAMPDIFF(MINUTE, happen_time, finish_time) / 60, 1) END AS hours
       FROM ticket WHERE ${OWNER} = ? AND ((${cond('happen_time', range)}) OR (status = 'done' AND ${cond('finish_time', range)}))
       ORDER BY happen_time DESC, ticket_id DESC LIMIT 10`, [userId]
    ),
    query('SELECT COUNT(*) AS c FROM knowledge WHERE user_id = ?', [userId])
  ])

  const b = base[0] || {}
  const d = doneRow[0] || {}
  const bk = backlog[0] || {}
  const accepted = Number(b.accepted || 0)
  const closed = Number(b.closed || 0)

  const map = new Map()
  bucketsOf(range).forEach(k => map.set(k, { key: k, accepted: 0, done: 0 }))
  acceptRows.forEach(r => { if (map.has(r.b)) map.get(r.b).accepted = Number(r.c) })
  doneRows.forEach(r => { if (map.has(r.b)) map.get(r.b).done = Number(r.c) })

  ok(res, {
    range,
    range_label: RANGE_META[range].label,
    user: { user_id: u.user_id, username: u.username, real_name: u.real_name, role: u.role, is_enable: u.is_enable },
    metrics: {
      accepted,
      done: Number(d.done || 0),
      done_rate: accepted ? Math.round(closed / accepted * 100) : 0,
      avg_hours: d.avg_hours === null || d.avg_hours === undefined ? null : Number(d.avg_hours),
      sla_overdue: Number(d.sla_overdue || 0),
      backlog: Number(bk.backlog || 0),
      over24: Number(bk.over24 || 0),
      over72: Number(bk.over72 || 0),
      overdue_now: Number((overdueSla[0] && overdueSla[0].c) || 0),
      satisfy_avg: Number((satisfyRow[0] && satisfyRow[0].avg_score) || 0),
      satisfy_cnt: Number((satisfyRow[0] && satisfyRow[0].cnt) || 0),
      kb_cnt: Number((kbRow[0] && kbRow[0].c) || 0)
    },
    trend: [...map.values()],
    problemRank: typeRows.map(r => ({ name: r.name, value: Number(r.value) })),
    appRank: appRows.map(r => ({ name: r.name, value: Number(r.value) })),
    recent: recent.map(r => ({ ...r, hours: r.hours == null ? null : Number(r.hours) }))
  })
}))

// 数据体检：找出会影响统计口径的异常数据（只读）
async function healthOf() {
  const rows = await query(
    `SELECT
       (SELECT COUNT(*) FROM ticket WHERE happen_time IS NOT NULL AND finish_time IS NOT NULL AND finish_time < happen_time) AS finish_before_happen,
       (SELECT COUNT(*) FROM ticket WHERE status = 'done' AND finish_time IS NULL) AS done_without_finish,
       (SELECT COUNT(*) FROM ticket WHERE happen_time > DATE_ADD(NOW(), INTERVAL 1 HOUR)) AS happen_in_future,
       (SELECT COUNT(*) FROM ticket WHERE status = 'processing' AND finish_time IS NOT NULL AND finish_time < '1971-01-01') AS invalid_finish,
       (SELECT COUNT(*) FROM ticket WHERE app_system IS NULL OR app_system = '') AS missing_app,
       (SELECT COUNT(*) FROM ticket WHERE problem_type IS NULL OR problem_type = '') AS missing_type,
       (SELECT COUNT(*) FROM ticket WHERE dept IS NULL OR dept = '') AS missing_dept`
  )
  const r = rows[0] || {}
  const o = {}
  Object.keys(r).forEach(k => { o[k] = Number(r[k] || 0) })
  o.issues = o.finish_before_happen + o.done_without_finish + o.invalid_finish
  return o
}

router.get('/data-health', asyncHandler(async (req, res) => {
  ok(res, await healthOf())
}))

// 一键修复（只修口径类的确定性问题，不改业务语义）
router.post('/data-repair', asyncHandler(async (req, res) => {
  const a = await query(
    `UPDATE ticket SET finish_time = happen_time
     WHERE happen_time IS NOT NULL AND finish_time IS NOT NULL AND finish_time < happen_time`
  )
  const b = await query(
    `UPDATE ticket SET finish_time = COALESCE(happen_time, NOW()) WHERE status = 'done' AND finish_time IS NULL`
  )
  const fixed = (a.affectedRows || 0) + (b.affectedRows || 0)
  ok(res, { fixed, health: await healthOf() }, fixed ? `已修复 ${fixed} 条异常工单` : '没有需要修复的数据')
}))

module.exports = router
