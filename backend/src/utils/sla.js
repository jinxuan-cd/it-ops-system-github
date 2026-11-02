/**
 * @file backend/src/utils/sla.js
 * @description 按问题类别与优先级匹配策略，推算应响应/应解决时间，判定超时状态
 *
 * SLA 时效计算 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// SLA 时效计算：根据问题类别 + 优先级匹配策略，算出应响应 / 应解决时间
const { query } = require('../db')

const DEFAULT_POLICY = { respond_hours: 4, resolve_hours: 24 }

// 取全部策略（量很小，直接全量缓存式读取）
/**
 * 读取全部 SLA 策略。
 * 策略表通常只有几条到几十条，全量取出后在内存里匹配，
 * 比每条工单都带 WHERE 条件查一次库省得多（批量回填时差异尤其明显）。
 *
 * @returns {Promise<Array<object>>} 按 policy_id 排序的策略行
 */
async function loadPolicies() {
  return query('SELECT * FROM sla_policy ORDER BY policy_id')
}

// 匹配优先级：类别+优先级 精确 > 类别任意 > 默认类别+优先级 > 默认任意
/**
 * 按「问题类别 + 优先级」选出适用的策略。
 *
 * 匹配顺序（先命中先返回）：类别+优先级 → 类别不限优先级 → 默认类别+优先级 → 兜底 → 代码内置默认值。
 * 这样管理员只配一条「打印机 4h/24h」就能覆盖该类别下所有优先级，
 * 需要时再给「打印机 + urgent」单独收紧，不必为每种组合都建一行。
 *
 * @param {Array<object>} policies loadPolicies() 的结果
 * @param {string} problemType 工单的问题类别
 * @param {string} [priority] 优先级，缺省按 normal 处理
 * @returns {{respond_hours:number|string, resolve_hours:number|string}} 命中的策略（或 DEFAULT_POLICY）
 */
function pickPolicy(policies, problemType, priority) {
  const p = priority || 'normal'
  const hit = (pt, pr) => policies.find(x =>
    (x.problem_type || '*') === pt && ((x.priority || null) === pr)
  )
  return hit(problemType, p) || hit(problemType, null) || hit('*', p) || hit('*', null) || DEFAULT_POLICY
}

/**
 * 在给定时间上加若干小时。
 *
 * 口径：**自然时段**，不是工作时段——4 小时的响应时限就是 4 个自然小时，
 * 17:30 报的 urgent 单，当天 21:30 就算超时，不跳过夜间与周末。
 * 这是刻意选择：内网小团队的运维值班是 7×24 待命，
 * 若按 9:00-18:00 工作日推算，周五下班前报的单要到下周一才计时，
 * 与「紧急故障必须当天响应」的实际要求相悖。
 * 若要改成工作时段，只需在此处引入节假日日历，调用方无需改动。
 *
 * @param {string} dtStr 基准时间 'YYYY-MM-DD HH:mm:ss'
 * @param {number|string} hours 小时数（支持小数，来自 DECIMAL 列）
 * @returns {string|null} 推算结果；基准时间缺失或非法返回 null
 */
function addHours(dtStr, hours) {
  if (!dtStr) return null
  const d = new Date(String(dtStr).replace(' ', 'T'))
  if (isNaN(d.getTime())) return null
  d.setMinutes(d.getMinutes() + Math.round(Number(hours) * 60))
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// 给工单算出两个截止时间（创建 / 修改问题类别时调用）
/**
 * 按工单的发生时间、类别、优先级推算两个截止时间。
 *
 * 以 happen_time 而非 create_time 为基准：补录的历史工单发生时间可能早于录入时间，
 * 用录入时间算会把已经超期的单显示成未超期。
 *
 * @param {string} happenTime 发生时间
 * @param {string} problemType 问题类别
 * @param {string} [priority] 优先级
 * @returns {Promise<{sla_respond_due:string|null, sla_resolve_due:string|null}>}
 * @sideeffect 每次调用都会查一次策略表（不缓存），改完策略即刻生效
 */
async function computeDue(happenTime, problemType, priority) {
  const policies = await loadPolicies()
  const pol = pickPolicy(policies, problemType, priority)
  return {
    sla_respond_due: addHours(happenTime, pol.respond_hours),
    sla_resolve_due: addHours(happenTime, pol.resolve_hours)
  }
}

// 本机时区的当前时间字符串（容器已设 TZ=Asia/Shanghai）
// 注意：不能用 toISOString()，那是 UTC，会比北京时间慢 8 小时，
// 导致「已超期 0~8 小时」的工单仍显示未超期（与 remain_hours 自相矛盾）
/**
 * 本机时区的当前时间 'YYYY-MM-DD HH:mm:ss'。
 * 与数据库 DATETIME 的字符串格式严格一致，才能直接用字符串比较大小。
 *
 * @returns {string}
 */
function localNow() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 单条工单的 SLA 状态（列表 / 详情展示用）
//   respond_state: ok / overdue / pending
//   resolve_state: ok / overdue / pending
//   state: 汇总（overdue 优先）
/**
 * 计算单条工单的 SLA 展示状态。
 *
 * 判定口径：
 * · respond：已有 respond_time 就按「实际响应 vs 应响应」比，没有才用当前时间判是否已超期；
 * · resolve：已完成且有时间按「完成 vs 应解决」比，未完成用当前时间判；
 * · remain_hours 只对未完成工单给出（负值表示已超期多少小时），已完成时为 null；
 * · 汇总 state 里 overdue 优先于 ok，只要任一段超时整单就算超时。
 * 所有比较都用 'YYYY-MM-DD HH:mm:ss' 字符串直接比大小（同格式下字典序等价于时间序），
 * 前提是两边都来自同一时区的本地时间串，不能混入 UTC 的 ISO 串。
 *
 * @param {object} row 工单行，需含 status / respond_time / finish_time / sla_*_due
 * @param {string} [nowStr] 当前时间，缺省用 localNow()
 * @returns {{respond_state:string, resolve_state:string, state:string, remain_hours:number|null}}
 *          state 取值 normal / ok / overdue；respond_state 与 resolve_state 取值 ok / overdue / pending
 */
function slaStateOf(row, nowStr) {
  const now = nowStr || localNow()
  const done = row.status === 'done'
  const out = { respond_state: 'pending', resolve_state: 'pending', state: 'normal', remain_hours: null }

  if (row.sla_respond_due) {
    if (row.respond_time) out.respond_state = String(row.respond_time) <= String(row.sla_respond_due) ? 'ok' : 'overdue'
    else out.respond_state = String(now) > String(row.sla_respond_due) ? 'overdue' : 'pending'
  }
  if (row.sla_resolve_due) {
    if (done && row.finish_time) out.resolve_state = String(row.finish_time) <= String(row.sla_resolve_due) ? 'ok' : 'overdue'
    else out.resolve_state = String(now) > String(row.sla_resolve_due) ? 'overdue' : 'pending'
    if (!done) {
      const ms = new Date(String(row.sla_resolve_due).replace(' ', 'T')).getTime() - Date.now()
      out.remain_hours = Math.round(ms / 3600000 * 10) / 10
    }
  }
  if (out.respond_state === 'overdue' || out.resolve_state === 'overdue') out.state = 'overdue'
  else if (done) out.state = 'ok'
  return out
}

// 给单条工单回填 SLA 截止时间（创建 / 修改类别 / 导入后调用）
/**
 * 为单条工单重算并写入 SLA 截止时间。
 *
 * @param {number} ticketId 工单 ID
 * @returns {Promise<void>}
 * @sideeffect 直接更新 ticket 两列，调用后需要重新查库才能看到最新值
 *
 * 触发时机必须覆盖「改类别」「改优先级」：改了类别但没重算，
 * 会出现换了更严的策略而截止时间还停留在旧值的错账。
 */
async function applySla(ticketId) {
  const rows = await query('SELECT happen_time, problem_type, priority FROM ticket WHERE ticket_id = ?', [ticketId])
  if (!rows.length) return
  const t = rows[0]
  if (!t.happen_time) return
  const due = await computeDue(t.happen_time, t.problem_type, t.priority)
  await query(
    'UPDATE ticket SET sla_respond_due = ?, sla_resolve_due = ? WHERE ticket_id = ?',
    [due.sla_respond_due, due.sla_resolve_due, ticketId]
  )
}

// 批量回填（迁移时给历史工单补 SLA 截止时间）
// 分批循环，避免一次 LIMIT 5000 之后剩下的工单永远补不上
/**
 * 批量为缺少 SLA 截止时间的历史工单补算。
 *
 * 只处理 sla_resolve_due IS NULL 的行，因此天然可重入：
 * 中途失败重启后接着补剩下的，已算好的不会被覆盖（管理员手改过的值也保得住）。
 *
 * @returns {Promise<number>} 本次补算的工单总数
 * @sideeffect 逐条 UPDATE；数据量大时会跑几十秒，只在启动迁移时调用，不要在请求链路里调
 */
async function backfillSla() {
  let total = 0
  for (;;) {
    const rows = await query(
      'SELECT ticket_id, happen_time, problem_type, priority FROM ticket WHERE happen_time IS NOT NULL AND sla_resolve_due IS NULL LIMIT 5000'
    )
    if (!rows.length) break
    const policies = await loadPolicies()
    for (const t of rows) {
      const pol = pickPolicy(policies, t.problem_type, t.priority)
      await query(
        'UPDATE ticket SET sla_respond_due = ?, sla_resolve_due = ? WHERE ticket_id = ?',
        [addHours(t.happen_time, pol.respond_hours), addHours(t.happen_time, pol.resolve_hours), t.ticket_id]
      )
    }
    total += rows.length
    if (rows.length < 5000) break
  }
  return total
}

module.exports = { loadPolicies, pickPolicy, computeDue, slaStateOf, addHours, applySla, backfillSla, localNow, DEFAULT_POLICY }
