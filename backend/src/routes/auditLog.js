/**
 * @file backend/src/routes/auditLog.js
 * @description 操作日志查询、操作人清单与行为汇总
 *
 * 审计日志路由 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 操作审计日志查询（管理员 / 审计员只读）
const express = require('express')
const router = express.Router()
const { query } = require('../db')
const { ok, asyncHandler } = require('../utils/helpers')
const { auth, canViewAll } = require('../middleware/auth')

router.use(auth, canViewAll)

/**
 * 操作日志列表：按时间区间、操作人、请求方法、路径、关键词过滤，按时间倒序。
 * 权限：管理员 / 审计员（router.use 已统一拦截）。
 * 口径：区间按 create_time，end 补 23:59:59；limit 夹在 1~1000，防止一次拉全表。
 *
 * @param {import('express').Request} req query: start / end / username / method / path / keyword / limit
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/', asyncHandler(async (req, res) => {
  const { start, end, keyword, username, method, path, limit } = req.query
  const where = ['1=1']
  const params = []
  if (start) { where.push('create_time >= ?'); params.push(start) }
  if (end) { where.push('create_time <= ?'); params.push(end + ' 23:59:59') }
  if (username) { where.push('username = ?'); params.push(username) }
  if (method) { where.push('method = ?'); params.push(method) }
  if (path) { where.push('path LIKE ?'); params.push(`%${path}%`) }
  if (keyword) {
    where.push('(action LIKE ? OR target LIKE ? OR detail LIKE ? OR ip LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }
  const n = Math.min(Math.max(parseInt(limit, 10) || 300, 1), 1000)
  const rows = await query(
    `SELECT * FROM audit_log WHERE ${where.join(' AND ')} ORDER BY log_id DESC LIMIT ${n}`,
    params
  )
  ok(res, rows)
}))

// 操作人下拉
/**
 * 操作人候选清单：按日志条数倒序取前 50 个，供筛选下拉使用。
 * 取自日志表而不是用户表，因为离职账号的历史操作仍要能筛出来。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res [{ username, count }]
 * @returns {Promise<void>}
 */
router.get('/users', asyncHandler(async (req, res) => {
  const rows = await query(
    'SELECT username, COUNT(*) AS cnt FROM audit_log GROUP BY username ORDER BY cnt DESC LIMIT 50'
  )
  ok(res, rows.map(r => ({ username: r.username, count: Number(r.cnt) })))
}))

// 概览：近 7 天每天的操作数 + 高频动作
/**
 * 审计概览：近 7 天每日操作量、近 30 天高频动作 TOP8、日志总量。
 * 权限：管理员 / 审计员。
 * 口径：daily 与 top 的时间窗不同（7 天 vs 30 天），前者看活跃度、后者看行为特征；
 *      daily 只返回有操作的日期，缺日期由前端按需补齐。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res { daily, top, total }
 * @returns {Promise<void>}
 */
router.get('/summary', asyncHandler(async (req, res) => {
  const daily = await query(
    `SELECT DATE_FORMAT(create_time, '%Y-%m-%d') AS d, COUNT(*) AS c
     FROM audit_log WHERE create_time >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
     GROUP BY d ORDER BY d`
  )
  const top = await query(
    `SELECT action, COUNT(*) AS c FROM audit_log
     WHERE create_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY action ORDER BY c DESC LIMIT 8`
  )
  const total = await query('SELECT COUNT(*) AS c FROM audit_log')
  ok(res, {
    daily: daily.map(r => ({ date: r.d, count: Number(r.c) })),
    top: top.map(r => ({ action: r.action, count: Number(r.c) })),
    total: Number(total[0].c || 0)
  })
}))

module.exports = router
