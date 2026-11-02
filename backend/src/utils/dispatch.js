/**
 * @file backend/src/utils/dispatch.js
 * @description 根据服务台开关决定派单方式，通知相关人，并生成/关闭关联待办
 *
 * 派单与待办联动 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 工单派发（接单池）
// 流程说明：
//   员工报障 / 手工投入「待接单池」 → 工单状态 pending（待接单）
//   → 给「应收到提醒的人」各生成一条待办 + SSE 实时推送，浏览器右下角弹出「有新工单」
//   → 谁先点「接取」谁处理（数据库原子更新，保证只有一个人接得走）
//   → 接单后状态变 processing，其余人的待办提醒自动关闭
const { query } = require('../db')
const { settingGet } = require('./seed')
const rt = require('./realtime')

// 服务台是可选角色：开了服务台由服务台派单，不开服务台就全员抢单
/**
 * 读取「服务台开关」。
 *
 * @returns {Promise<boolean>} true = 开启服务台模式（由 service/admin 派单）
 * @sideeffect 每次调用都查一次 sys_setting；本函数在派单主链路上，
 *             调用频率等于建单频率，不走缓存是为了改开关后立即生效
 */
async function serviceDeskEnabled() {
  return (await settingGet('service_desk_enable')) === '1'
}

/**
 * 计算本条工单该提醒谁。
 *
 * 口径：先剔除停用账号与审计员（只读，不该收到待办）；
 * 开了服务台 → 只提醒 service 与 admin（他们负责派单）；
 * 没开服务台 → 全部在职运维（含 admin）一起抢单。
 *
 * @returns {Promise<{desk:boolean, list:Array<{user_id:number, real_name:string, role:string}>}>}
 *          desk 用于决定待办标题是「待派单」还是「待接单」
 */
async function notifyUsers() {
  const desk = await serviceDeskEnabled()
  const rows = await query(
    "SELECT user_id, real_name, role FROM sys_user WHERE is_enable = 1 AND role <> 'auditor'"
  )
  const list = desk ? rows.filter(u => u.role === 'service' || u.role === 'admin') : rows
  return { desk, list }
}

function todayStr() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 取单行摘要作为待办标题：工单正文常有多行，待办列表只容得下一行
function shortText(s) {
  const t = String(s || '').split('\n')[0].trim()
  return t.length > 40 ? t.slice(0, 40) + '…' : (t || '新报障工单')
}

// 工单进入待接单池：生成待办 + 实时提醒
/**
 * 工单进入待接单池后的联动入口：批量生成待办 + SSE 实时提醒。
 *
 * 与服务台开关的关系：
 * · 开服务台时，待办标题是「待派单：」，收件人是 service/admin，由他们指派给具体人；
 * · 不开服务台时，标题是「待接单：」，全体现职运维同时收到，先点先得。
 * 返回的 desk 也透传给前端（mode 字段），决定右下角弹窗显示「去派单」还是「去接单」。
 *
 * @param {object} t 工单行（至少含 ticket_id、service_content，其余字段用于拼摘要）
 * @returns {Promise<{notified:number, desk:boolean}>} notified = 实际生成待办的人数
 * @sideeffect 向 todo 表插入 N 行、向在线客户端推 ticket:new 事件；
 *             重复调用会产生重复待办（本函数自身不做去重，由调用方保证只调一次）
 */
async function dispatchTicket(t) {
  const { desk, list } = await notifyUsers()
  const ids = list.map(u => u.user_id)
  if (!ids.length) return { notified: 0, desk }

  const title = ((desk ? '待派单：' : '待接单：') + shortText(t.service_content)).slice(0, 200)
  const detail = [
    t.contact ? `报障人：${t.contact}` : '',
    t.dept ? `部门：${t.dept}` : '',
    t.app_system ? `系统：${t.app_system}` : ''
  ].filter(Boolean).join('　') || '（点击查看工单详情）'
  const today = todayStr()

  // 一条 SQL 批量插入，避免运维人数多时循环几百次
  const rows = ids.map(() => '(?,?,?,?,?,?)').join(',')
  const params = []
  for (const uid of ids) params.push(uid, title, detail, today, 'ticket', t.ticket_id)
  await query(
    `INSERT INTO todo (user_id, todo_title, todo_detail, plan_date, source, ticket_id) VALUES ${rows}`,
    params
  )

  // 实时推送到在线的运维浏览器（右下角弹出接单提示）
  rt.send(ids, 'ticket:new', {
    ticket_id: t.ticket_id,
    report_no: t.report_no || '',
    service_content: t.service_content || '',
    contact: t.contact || '',
    dept: t.dept || '',
    app_system: t.app_system || '',
    problem_type: t.problem_type || '',
    priority: t.priority || 'normal',
    happen_time: t.happen_time || '',
    mode: desk ? 'desk' : 'pool'
  })
  return { notified: ids.length, desk }
}

// 被接单 / 已派单 / 已完成 → 关掉所有人关于这条工单的待办提醒
/**
 * 关闭某张工单产生的全部未完成待办。
 *
 * 触发时机：接单、指派、完成、作废——任何让「有人该处理」不再成立的动作都要调，
 * 否则抢单池里没人接的单被某人接走后，其他人的待办会一直挂着变成噪音。
 * 只关 is_finish = 0 的行，保留已完成的记录不做物理删除。
 *
 * @param {number} ticketId 工单 ID
 * @returns {Promise<void>}
 */
async function closeTicketTodos(ticketId) {
  await query('UPDATE todo SET is_finish = 1 WHERE ticket_id = ? AND is_finish = 0', [ticketId])
}

// 本文件三个函数是一组：dispatchTicket 建待办、closeTicketTodos 销待办、
// notifyUsers 决定收件人范围。路由里不要绕过它们自己写 SQL，
// 否则「服务台开关」和「审计员不提醒」这两条口径会各写一遍，迟早走偏
module.exports = { dispatchTicket, closeTicketTodos, serviceDeskEnabled, notifyUsers }
