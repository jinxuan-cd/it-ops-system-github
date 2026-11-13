/**
 * @file backend/src/routes/projects.js
 * @description 项目信息与责任人维护
 *
 * 项目档案路由 —— IT 运维工单台账与日报自动管理系统
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
 * 取本地日期串（项目日期都是纯日期，不涉及时间，用本地时区避免跨时区差一天）。
 *
 * @returns {string}
 */
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---- 阶段处理：stages 存 JSON 数组 [{ name, done }] ----
/**
 * 归一化阶段数组：兼容前端传数组和库里存的 JSON 字符串，丢掉没名字的脏项。
 *
 * @param {Array|string} v
 * @returns {Array<{name: string, done: boolean}>}
 */
function normalizeStages(v) {
  let arr = v
  if (typeof v === 'string') {
    try { arr = JSON.parse(v) } catch (e) { arr = [] }
  }
  if (!Array.isArray(arr)) return []
  return arr
    .filter(s => s && typeof s === 'object' && String(s.name || '').trim())
    .map(s => ({ name: String(s.name).trim(), done: !!s.done }))
}

/**
 * 算进度：有阶段就按「已完成阶段数 / 总阶段数」算，没阶段才用调用方传的百分比。
 * 口径以阶段为准，是因为阶段是用户实际勾的，手填百分比往往忘记同步。
 *
 * @param {Array<{done: boolean}>} stages
 * @param {number} fallback 手填的百分比
 * @returns {number} 0~100 的整数
 */
function deriveProgress(stages, fallback) {
  if (Array.isArray(stages) && stages.length) {
    const done = stages.filter(s => s.done).length
    return Math.round((done / stages.length) * 100)
  }
  return Math.max(0, Math.min(100, Number(fallback) || 0))
}

/**
 * 取当前所处阶段：第一个未完成的阶段；全部完成则显示最后一个阶段名。
 *
 * @param {Array<{name: string, done: boolean}>} stages
 * @returns {string} 无阶段时返回空串
 */
function currentStageName(stages) {
  if (!Array.isArray(stages) || !stages.length) return ''
  const idx = stages.findIndex(s => !s.done)
  return idx === -1 ? stages[stages.length - 1].name : stages[idx].name
}

// 列表：?status=active/done/paused；?due=1 返回「周期已到仍未完成」的项目
/**
 * 项目列表：可按状态过滤，due=1 只回「已过计划结束日但仍未完成」的项目（首页到期提醒用）。
 * 权限：只看自己负责的项目（恒定按 user_id 过滤，不接收前端传用户）。
 * 排序：有结束日的按日期升序（快到期的靠前），没填结束日的排最后。
 *
 * @param {import('express').Request} req query.status / query.due
 * @param {import('express').Response} res 每条附带 stages、按阶段重算的 progress、当前阶段与阶段计数
 * @returns {Promise<void>}
 */
router.get('/', asyncHandler(async (req, res) => {
  const { status, due } = req.query
  let where = 'user_id = ?'
  const params = [req.user.user_id]
  if (status) { where += ' AND status = ?'; params.push(status) }
  if (due === '1') {
    where += " AND status = 'active' AND end_date IS NOT NULL AND end_date < ?"
    params.push(todayStr())
  }
  const rows = await query(`SELECT * FROM project WHERE ${where} ORDER BY end_date IS NULL, end_date ASC, project_id DESC`, params)
  rows.forEach(r => {
    r.stages = normalizeStages(r.stages)
    r.progress = deriveProgress(r.stages, r.progress)
    r.current_stage = currentStageName(r.stages)
    r.stage_done = r.stages.filter(s => s.done).length
    r.stage_total = r.stages.length
  })
  ok(res, rows)
}))

// 新增
/**
 * 新建项目。权限：任意已登录用户，负责人记为本人。
 * 进度优先由阶段推导，没填阶段才用传入的百分比；默认状态 active。
 *
 * @param {import('express').Request} req body: project_name / project_desc / start_date / end_date / progress / status / stages
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.post('/', asyncHandler(async (req, res) => {
  const { project_name, project_desc, start_date, end_date, progress, status, stages } = req.body
  if (!project_name) return fail(res, '项目名称必填')
  const st = normalizeStages(stages)
  const prog = deriveProgress(st, progress)
  await query(
    `INSERT INTO project (user_id, project_name, project_desc, stages, start_date, end_date, progress, status)
     VALUES (?,?,?,?,?,?,?,?)`,
    [req.user.user_id, project_name, project_desc || '', JSON.stringify(st), start_date || null, end_date || null,
     prog, status || 'active']
  )
  ok(res, null, '创建成功')
}))

// 更新
/**
 * 编辑项目：只改传入字段。权限：只能改自己负责的项目（WHERE 里带 user_id，管理员也不例外）。
 * 联动：改了阶段且没显式给 progress 时，按阶段完成比例回写进度，避免两处数字打架。
 *
 * @param {import('express').Request} req req.params.id 为 project_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.put('/:id', asyncHandler(async (req, res) => {
  const b = req.body
  const sets = [], vals = []
  const editable = ['project_name', 'project_desc', 'start_date', 'end_date', 'progress', 'status']
  editable.forEach(f => {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); vals.push(f === 'progress' ? (Number(b[f]) || 0) : b[f]) }
  })
  // 阶段：保存 JSON，并按完成比例自动回写 progress（除非调用方显式传了 progress）
  if (b.stages !== undefined) {
    const st = normalizeStages(b.stages)
    sets.push('stages = ?'); vals.push(JSON.stringify(st))
    if (b.progress === undefined) {
      sets.push('progress = ?'); vals.push(deriveProgress(st, 0))
    }
  }
  if (!sets.length) return fail(res, '无更新字段')
  vals.push(req.params.id, req.user.user_id)
  const result = await query(`UPDATE project SET ${sets.join(', ')} WHERE project_id = ? AND user_id = ?`, vals)
  if (result.affectedRows === 0) return fail(res, '项目不存在或无权限')
  ok(res, null, '更新成功')
}))

// 删除
/**
 * 删除项目。权限：只能删自己负责的项目。
 *
 * @param {import('express').Request} req req.params.id 为 project_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await query('DELETE FROM project WHERE project_id = ? AND user_id = ?', [req.params.id, req.user.user_id])
  if (result.affectedRows === 0) return fail(res, '项目不存在或无权限')
  ok(res, null, '删除成功')
}))

module.exports = router
