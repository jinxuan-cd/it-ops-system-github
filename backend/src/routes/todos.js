/**
 * @file backend/src/routes/todos.js
 * @description 个人待办增删改查、今日待办视图
 *
 * 待办路由 —— IT 运维工单台账与日报自动管理系统
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

/**
 * 取本地日期串 YYYY-MM-DD，待办按自然日归集，必须用本地时区而不是 UTC。
 *
 * @returns {string}
 */
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 本周一 ~ 本周日
/**
 * 算本周的日期区间，周一为一周起点（默认 getDay() 周日是 0，故 day||7）。
 *
 * @returns {[string, string]} [周一, 周日]，均为 YYYY-MM-DD
 */
function weekRange() {
  const d = new Date()
  const day = d.getDay() || 7
  const monday = new Date(d)
  monday.setDate(d.getDate() - day + 1)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fmt = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  return [fmt(monday), fmt(sunday)]
}

// 列表（Tab：today / week / all / done；前三者只显示未完成，done 显示已完成）
/**
 * 待办列表，按 Tab 分流：today 只看计划日期是今天的、week 看本周区间、all 看全部未完成、done 看已完成。
 * 权限：只能看自己的待办（恒按 user_id 过滤，不接收前端传用户）。
 * 口径：前三个 Tab 只出未完成项，已完成的只在 done 里出现，避免勾完不消失。
 *
 * @param {import('express').Request} req query.tab
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/', asyncHandler(async (req, res) => {
  const { tab } = req.query
  let where = 'user_id = ?'
  const params = [req.user.user_id]
  const t = todayStr()
  if (tab === 'done') {
    where += ' AND is_finish = 1'
  } else {
    where += ' AND is_finish = 0'
    if (tab === 'today') {
      where += ' AND plan_date = ?'
      params.push(t)
    } else if (tab === 'week') {
      const [s, e] = weekRange()
      where += ' AND plan_date BETWEEN ? AND ?'
      params.push(s, e)
    }
  }
  const rows = await query(
    `SELECT * FROM todo WHERE ${where} ORDER BY plan_date ASC, todo_id DESC`,
    params
  )
  ok(res, rows)
}))

// 当日未完成（供浮动面板 / 看板）
/**
 * 今日未完成待办，右下角浮动面板与看板共用。
 * 权限：只看自己的；与列表接口分开是为了让看板少传参数、失败也不拖累主看板。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/pending/today', asyncHandler(async (req, res) => {
  const t = todayStr()
  const rows = await query(
    'SELECT * FROM todo WHERE user_id = ? AND plan_date = ? AND is_finish = 0 ORDER BY todo_id DESC',
    [req.user.user_id, t]
  )
  ok(res, rows)
}))

// 新增
/**
 * 新建待办。权限：任意已登录用户，归属本人。
 * source 区分来源：manual=手动、daily_report=日报明日计划拆出来的、ticket=工单提醒，
 * 日报重构待办时靠它精确删旧数据，不会误删手动建的。
 *
 * @param {import('express').Request} req body: todo_title / todo_detail / plan_date / source / ticket_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.post('/', asyncHandler(async (req, res) => {
  const { todo_title, todo_detail, plan_date, source, ticket_id } = req.body
  if (!todo_title) return fail(res, '待办标题必填')
  await query(
    'INSERT INTO todo (user_id, todo_title, todo_detail, plan_date, source, ticket_id) VALUES (?,?,?,?,?,?)',
    [req.user.user_id, todo_title, todo_detail || '', plan_date || null, source || 'manual', ticket_id || null]
  )
  ok(res, null, '创建成功')
}))

// 更新（含勾选完成、编辑）
/**
 * 编辑待办或勾选完成，只改传入字段。权限：只能改自己的（WHERE 带 user_id）。
 *
 * @param {import('express').Request} req req.params.id 为 todo_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.put('/:id', asyncHandler(async (req, res) => {
  const { todo_title, todo_detail, plan_date, is_finish } = req.body
  const sets = [], vals = []
  if (todo_title !== undefined) { sets.push('todo_title = ?'); vals.push(todo_title) }
  if (todo_detail !== undefined) { sets.push('todo_detail = ?'); vals.push(todo_detail) }
  if (plan_date !== undefined) { sets.push('plan_date = ?'); vals.push(plan_date) }
  if (is_finish !== undefined) { sets.push('is_finish = ?'); vals.push(is_finish ? 1 : 0) }
  if (!sets.length) return fail(res, '无更新字段')
  vals.push(req.params.id, req.user.user_id)
  const result = await query('UPDATE todo SET ' + sets.join(', ') + ' WHERE todo_id = ? AND user_id = ?', vals)
  if (result.affectedRows === 0) return fail(res, '待办不存在或无权限')
  ok(res, null, '更新成功')
}))

// 删除
/**
 * 删除待办。权限：只能删自己的。
 *
 * @param {import('express').Request} req req.params.id 为 todo_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await query('DELETE FROM todo WHERE todo_id = ? AND user_id = ?', [req.params.id, req.user.user_id])
  if (result.affectedRows === 0) return fail(res, '待办不存在或无权限')
  ok(res, null, '删除成功')
}))

module.exports = router
