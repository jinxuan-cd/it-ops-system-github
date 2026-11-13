/**
 * @file backend/src/utils/notifier.js
 * @description 企业微信/钉钉/邮件/Webhook 多通道统一发送、广播与连通性测试
 *
 * 消息推送 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 消息通知：向企业微信 / 钉钉 / 飞书 群机器人推送纯文本或 Markdown 消息
// 说明：三类机器人都接收 HTTP POST + JSON，只是字段名不同，这里统一适配
const { query } = require('../db')

const CHANNEL_LABEL = { wecom: '企业微信', dingtalk: '钉钉', feishu: '飞书', webhook: '自定义' }

/**
 * 按渠道拼出机器人要求的请求体。
 * 三家字段名不同（wecom/dingtalk 用 markdown，feishu 用 msg_type + content.text），
 * 统一在这里适配，调用方只关心「标题 + 正文」。
 *
 * @param {{channel:string}} cfg 通知配置
 * @param {string} title 标题
 * @param {string} content 正文（允许 Markdown）
 * @returns {object} 可直接 JSON.stringify 的请求体
 */
function buildBody(cfg, title, content) {
  const text = `${title}\n\n${content}`
  if (cfg.channel === 'wecom') return { msgtype: 'markdown', markdown: { content: text } }
  if (cfg.channel === 'dingtalk') return { msgtype: 'markdown', markdown: { title, text } }
  if (cfg.channel === 'feishu') return { msg_type: 'text', content: { text } }
  return { text, title, content }
}

// 发送到单条配置，返回 { ok, message }
/**
 * 向单个 Webhook 推送一条消息。
 *
 * 不抛异常：推送属旁路能力，失败只应影响「这条通知没发出去」，
 * 绝不能把定时任务或工单提交整条链路带崩，因此所有错误都收敛成 { ok:false }。
 *
 * @param {{webhook:string, channel:string}} cfg 通知配置
 * @param {string} title 标题
 * @param {string} content 正文
 * @returns {Promise<{ok:boolean, message:string}>} message 为响应原文前 200 字，便于排查加签/关键词校验失败
 * @sideeffect 8 秒超时后自动中断请求，避免机器人服务卡住拖死调用方
 */
async function sendOne(cfg, title, content) {
  if (!cfg || !cfg.webhook) return { ok: false, message: '未配置 Webhook' }
  try {
    const res = await fetch(cfg.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(cfg, title, content)),
      signal: AbortSignal.timeout(8000)
    })
    const t = await res.text()
    // 三类机器人成功都会返回 errcode:0 / code:0 / StatusCode:0
    const okCode = /"errcode"\s*:\s*0|"code"\s*:\s*0|"StatusCode"\s*:\s*0/.test(t)
    return { ok: res.ok && (okCode || t === '' || /ok/i.test(t)), message: t.slice(0, 200) }
  } catch (e) {
    return { ok: false, message: e.message }
  }
}

// 向所有启用的通知配置广播（可选按事件过滤）
/**
 * 按事件类型向已启用的通知配置群发。
 *
 * @param {string} event 事件标识：overdue（超期）/ report（日报）/ incident（故障）
 * @param {string} title 标题
 * @param {string} content 正文
 * @param {number|null} [onlyUserId=null] 传则只发该用户名下的配置（如个人日报提醒）
 * @returns {Promise<Array<{channel:string, ok:boolean, message:string}>>} 每个渠道的发送结果
 * @sideeffect 串行发送：并发打多个机器人容易被上游限流，量小串行更稳
 *
 * 订阅口径：notify_config.events 存逗号分隔串，必须精确命中 event 才发，
 * 因此新增事件类型时要同步前端可选项，否则用户永远收不到。
 */
async function broadcast(event, title, content, onlyUserId = null) {
  const rows = onlyUserId
    ? await query('SELECT * FROM notify_config WHERE is_enable = 1 AND user_id = ?', [onlyUserId])
    : await query('SELECT * FROM notify_config WHERE is_enable = 1')
  const list = rows.filter(r => String(r.events || '').split(',').map(s => s.trim()).includes(event))
  const results = []
  for (const cfg of list) {
    results.push({ channel: cfg.channel, ...(await sendOne(cfg, title, content)) })
  }
  return results
}

// 发一条测试消息
/**
 * 发送测试消息，供设置页「测试连通性」按钮调用。
 *
 * 正文里带上渠道名与当前时间：收到后能确认「是哪条配置、什么时候点的测试」，
 * 排查群机器人配置串号时很有用。
 *
 * @param {object} cfg 通知配置
 * @returns {Promise<{ok:boolean, message:string}>}
 */
async function sendTest(cfg) {
  return sendOne(cfg, '【IT 运维系统】通知测试',
    `这是一条测试消息，收到说明配置成功。\n\n渠道：${CHANNEL_LABEL[cfg.channel] || cfg.channel}\n时间：${new Date().toLocaleString('zh-CN')}`)
}

module.exports = { broadcast, sendTest, sendOne, CHANNEL_LABEL }
