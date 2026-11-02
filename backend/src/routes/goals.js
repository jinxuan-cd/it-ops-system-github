/**
 * @file backend/src/routes/goals.js
 * @description 个人月度目标的设定、调整与完成度统计
 *
 * 月度目标路由 —— IT 运维工单台账与日报自动管理系统
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
const { ok, fail, asyncHandler } = require('../utils/helpers')
const { auth } = require('../middleware/auth')

router.use(auth)

// 按月份查询（done=1 已完成 / 否则未完成）
/**
 * 月度目标列表：按月份取，并按完成状态二分（done=1 取已完成，否则只取未完成）。
 * 权限：只能看自己的目标，user_id 恒取当前登录人。
 *
 * @param {import('express').Request} req query.month（YYYY-MM，不传则跨月全取）、query.done
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/', asyncHandler(async (req, res) => {
  const { month, done } = req.query
  let where = 'user_id = ?'
  const params = [req.user.user_id]
  if (month) { where += ' AND goal_month = ?'; params.push(month) }
  where += (done === '1' ? ' AND is_finish = 1' : ' AND is_finish = 0')
  const rows = await query(
    `SELECT * FROM month_goal WHERE ${where} ORDER BY goal_id DESC`, params
  )
  ok(res, rows)
}))

// 新增
/**
 * 新增月度目标。权限：任意已登录用户，归属本人。
 * weight_score 是权重分，用于月底按权重算完成质量；不填按 0 处理。
 *
 * @param {import('express').Request} req body: goal_month / goal_content / weight_score
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.post('/', asyncHandler(async (req, res) => {
  const { goal_month, goal_content, weight_score } = req.body
  if (!goal_month || !goal_content) return fail(res, '月份和目标内容必填')
  await query(
    'INSERT INTO month_goal (user_id, goal_month, goal_content, weight_score) VALUES (?,?,?,?)',
    [req.user.user_id, goal_month, goal_content, weight_score || 0]
  )
  ok(res, null, '创建成功')
}))

// 更新（含勾选完成；勾选时自动记录完成月份，取消时清空）
/**
 * 编辑目标或勾选完成。权限：只能改自己的目标。
 * 勾选完成时写入 finish_month（当前年月），取消勾选时清空 —— 这样即使目标设在上个月、
 * 本月才完成，也能按实际完成月份统计，而不是一律算回目标设定的那个月。
 *
 * @param {import('express').Request} req req.params.id 为 goal_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.put('/:id', asyncHandler(async (req, res) => {
  const { goal_content, weight_score, is_finish } = req.body
  const sets = [], vals = []
  if (goal_content !== undefined) { sets.push('goal_content = ?'); vals.push(goal_content) }
  if (weight_score !== undefined) { sets.push('weight_score = ?'); vals.push(weight_score) }
  if (is_finish !== undefined) {
    sets.push('is_finish = ?'); vals.push(is_finish ? 1 : 0)
    const now = new Date()
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    sets.push('finish_month = ?'); vals.push(is_finish ? ym : null)
  }
  if (!sets.length) return fail(res, '无更新字段')
  vals.push(req.params.id, req.user.user_id)
  const result = await query('UPDATE month_goal SET ' + sets.join(', ') + ' WHERE goal_id = ? AND user_id = ?', vals)
  if (result.affectedRows === 0) return fail(res, '目标不存在或无权限')
  ok(res, null, '更新成功')
}))

// 删除
/**
 * 删除月度目标。权限：只能删自己的目标。
 *
 * @param {import('express').Request} req req.params.id 为 goal_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await query('DELETE FROM month_goal WHERE goal_id = ? AND user_id = ?', [req.params.id, req.user.user_id])
  if (result.affectedRows === 0) return fail(res, '目标不存在或无权限')
  ok(res, null, '删除成功')
}))

module.exports = router
