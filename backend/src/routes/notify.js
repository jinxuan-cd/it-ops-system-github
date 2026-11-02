/**
 * @file backend/src/routes/notify.js
 * @description 各消息通道的参数配置与测试发送
 *
 * 通知渠道路由 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 消息通知配置（企微 / 钉钉 / 飞书 群机器人）
const express = require('express')
const router = express.Router()
const { query } = require('../db')
const { ok, fail, asyncHandler } = require('../utils/helpers')
const { auth, adminOnly } = require('../middleware/auth')
const { sendTest } = require('../utils/notifier')

router.use(auth)

/**
 * 读取通知渠道配置（企微/钉钉/飞书群机器人）。
 * 权限：登录可读，但只读得到自己名下那份；没配过则回一套默认值 + configured=false。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/config', asyncHandler(async (req, res) => {
  const rows = await query('SELECT * FROM notify_config WHERE user_id = ?', [req.user.user_id])
  if (!rows.length) return ok(res, { channel: 'wecom', webhook: '', secret: '', events: 'overdue,report,incident', is_enable: 1, configured: false })
  const r = rows[0]
  ok(res, {
    config_id: r.config_id,
    channel: r.channel,
    webhook: r.webhook,
    secret: r.secret || '',
    events: r.events || '',
    is_enable: Number(r.is_enable),
    configured: true
  })
}))

/**
 * 保存通知配置。权限：仅管理员（群里就一个机器人，配多了会重复播报）。
 * 一个账号一条记录，存在即覆盖；events 决定订阅哪几类消息（overdue 超期、report 报障、incident 故障）。
 *
 * @param {import('express').Request} req body: channel / webhook / secret / events / is_enable
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.put('/config', adminOnly, asyncHandler(async (req, res) => {
  const b = req.body
  if (!b.webhook) return fail(res, '请填写机器人 Webhook 地址')
  await query(
    `INSERT INTO notify_config (user_id, channel, webhook, secret, events, is_enable)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE channel = ?, webhook = ?, secret = ?, events = ?, is_enable = ?`,
    [req.user.user_id, b.channel || 'wecom', b.webhook, b.secret || null, b.events || 'overdue,report,incident', b.is_enable ? 1 : 0,
     b.channel || 'wecom', b.webhook, b.secret || null, b.events || 'overdue,report,incident', b.is_enable ? 1 : 0]
  )
  ok(res, null, '已保存通知配置')
}))

/**
 * 测试发送：用请求里的临时配置发一条测试消息，不写库。
 * 权限：仅管理员。用来验证 Webhook 是否填对、机器人在不在群里，省得真出故障时才发现发不出去。
 *
 * @param {import('express').Request} req body: channel / webhook / secret
 * @param {import('express').Response} res 失败时把上游返回的错误原文带上，便于判断是地址错还是密钥错
 * @returns {Promise<void>}
 */
router.post('/test', adminOnly, asyncHandler(async (req, res) => {
  const b = req.body
  const cfg = { channel: b.channel || 'wecom', webhook: b.webhook, secret: b.secret }
  if (!cfg.webhook) return fail(res, '请先填写 Webhook 地址')
  const r = await sendTest(cfg)
  if (!r.ok) return fail(res, `发送失败：${r.message || '请检查地址是否正确'}`)
  ok(res, null, '测试消息已发送，请查看群消息')
}))

module.exports = router
