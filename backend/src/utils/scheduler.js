/**
 * @file backend/src/utils/scheduler.js
 * @description 周期性扫描超时工单、晚间提醒未提交日报的人员
 *
 * 定时任务 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 定时提醒：每天固定时间向企业微信/钉钉/飞书群推送
//  09:00 超期未闭环工单 + 今日待办
//  18:00 今日工单小结 + 未填日报提醒
// 用 10 分钟轮询 + 当天去重，避免依赖外部 cron
const { query } = require('../db')
const { broadcast } = require('./notifier')

const sent = new Set() // key: 'YYYY-MM-DD-event'

/**
 * 本机时区的日期串，作为去重 key 的前半段。
 *
 * @returns {string} 'YYYY-MM-DD'
 */
function today() {
  const d = new Date(); const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
/**
 * 本机时区的 'HH:mm'，用于和 '09:00' / '18:00' 做整点比较。
 * 必须用本机时区字符串直接比，不能折算成 UTC：容器已设 TZ=Asia/Shanghai。
 *
 * @returns {string} 'HH:mm'
 */
function hhmm() {
  const d = new Date(); const p = n => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}
/**
 * 当天的幂等闸门：同一 key 只放行一次。
 *
 * @param {string} key 形如 '2026-11-02-am'
 * @returns {boolean} true = 首次调用，可以执行；false = 今天已经执行过
 * @sideeffect 放行时立即登记，因此后续执行失败也不会重试（宁可漏一次，不要重复轰炸群消息）
 *
 * 隐含约束：记录只在内存，进程重启后同一天会再发一次；
 * 且多实例部署时各实例各发一遍。本项目是单进程形态，这两点都可接受，
 * 若要严格全局幂等，需把标记落到 sys_meta 表。
 */
function markOnce(key) {
  if (sent.has(key)) return false
  sent.add(key)
  return true
}

/**
 * 早间任务：统计未闭环工单并推送提醒。
 *
 * 口径：分母是所有 status <> 'done' 的工单（不限定当天，历史挂单也要催），
 * 其中再分「超 24 小时未处理」与「已过 SLA 解决时限」两档。
 * 没有未闭环工单时直接返回，不发「0 单」的空提醒。
 *
 * @returns {Promise<void>}
 * @sideeffect 向所有订阅 overdue 事件的通知配置发消息；推送失败被吞掉，不影响下一次执行
 */
async function overdueTask() {
  const rows = await query(
    `SELECT COUNT(*) AS total,
            SUM(sla_resolve_due IS NOT NULL AND sla_resolve_due < NOW()) AS sla_over,
            SUM(happen_time < DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS over24
     FROM ticket WHERE status <> 'done'`
  )
  const r = rows[0] || {}
  const total = Number(r.total || 0)
  if (!total) return
  await query('SELECT 1')
  broadcast('overdue', '【今日运维待跟进】',
    `未闭环工单：**${total}** 单\n其中超 24 小时：**${Number(r.over24 || 0)}** 单\n超出 SLA 时限：**${Number(r.sla_over || 0)}** 单\n\n请及时在系统「工单记录管理」中处理。`
  ).catch(() => {})
}

/**
 * 晚间任务：推送当日工单小结与日报提交情况。
 *
 * 口径：受理量按 happen_time 落在今天统计，完成量是其中 status='done' 的部分，
 * 与日报的统计口径保持一致；日报人数按 report_date = 今天去重计数。
 *
 * @returns {Promise<void>}
 * @sideeffect 向订阅 report 事件的通知配置发消息
 */
async function eveningTask() {
  const d = today()
  const t = await query(
    `SELECT COUNT(*) AS total, SUM(status='done') AS done FROM ticket WHERE DATE(happen_time) = CURDATE()`
  )
  const rep = await query('SELECT COUNT(*) AS cnt FROM daily_report WHERE report_date = ?', [d])
  const r = t[0] || {}
  broadcast('report', '【今日运维小结】',
    `今日受理：**${Number(r.total || 0)}** 单，已完成：**${Number(r.done || 0)}** 单\n日报已提交：**${Number((rep[0] && rep[0].cnt) || 0)}** 人\n\n下班前记得在系统里生成今日日报。`
  ).catch(() => {})
}

/**
 * 启动定时提醒。只在启动流程中调用一次，重复调用会叠加多个轮询定时器。
 *
 * 执行频率：每 60 秒 tick 一次，精度到分钟，足以命中 09:00 / 18:00 两个整点。
 * 幂等保证：靠 markOnce（当天 + 事件名）去重，所以即使一分钟内多次命中同一时刻，
 * 或容器在 09:00 前后重启后再次 tick，也只会推送一次。
 * 定时器已 unref，不会阻止进程退出。
 *
 * @returns {void}
 * @sideeffect 注册一个永不停止的 interval；tick 内部异常只打日志，不中断轮询
 */
function startScheduler() {
  const tick = async () => {
    const now = hhmm()
    const d = today()
    try {
      if (now === '09:00' && markOnce(d + '-am')) await overdueTask()
      if (now === '18:00' && markOnce(d + '-pm')) await eveningTask()
    } catch (e) {
      console.error('[scheduler]', e.message)
    }
  }
  // 每分钟检查一次（精度足够，开销极小）
  setInterval(tick, 60 * 1000).unref()
  console.log('[scheduler] 定时提醒已启动（09:00 待跟进 / 18:00 今日小结）')
}

module.exports = { startScheduler, overdueTask, eveningTask }
