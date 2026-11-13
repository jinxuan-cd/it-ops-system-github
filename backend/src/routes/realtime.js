/**
 * @file backend/src/routes/realtime.js
 * @description SSE 事件流端点与在线人数查询
 *
 * 实时推送路由 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 实时消息通道（SSE）：/api/realtime/stream?token=xxx
// 说明：浏览器的 EventSource 不能自定义请求头，所以 token 走查询参数
const express = require('express')
const jwt = require('jsonwebtoken')
const router = express.Router()
const { JWT_SECRET } = require('../middleware/auth')
const rt = require('../utils/realtime')

/**
 * SSE 长连接端点：前端订阅后，工单被接走/完成、新报障等事件会即时推过来。
 * 鉴权：EventSource 不能自定义请求头，token 只能走查询参数，这里手动验签，失败返回 401。
 * 注意：这是长连接，不能套 asyncHandler，连接要一直挂着直到客户端断开。
 *
 * @param {import('express').Request} req query.token 为 JWT
 * @param {import('express').Response} res
 * @returns {void}
 */
router.get('/stream', (req, res) => {
  const token = String(req.query.token || '')
  if (!token) return res.status(401).json({ code: 1, message: '缺少 token' })
  let user
  try {
    user = jwt.verify(token, JWT_SECRET)
  } catch (e) {
    return res.status(401).json({ code: 1, message: 'token 无效或已过期' })
  }
  rt.subscribe(req, res, user)
})

// 在线连接数（运维排查用）
/**
 * 当前 SSE 在线连接数，用来排查「为什么收不到实时提醒」，也是「谁在线」的粗略口径
 *（同一人开多个标签页会算多条连接）。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res { online }
 * @returns {void}
 */
router.get('/online', (req, res) => res.json({ code: 0, message: 'ok', data: { online: rt.count() } }))

module.exports = router
