/**
 * @file backend/src/routes/dictionary.js
 * @description 部门、系统、问题类别等枚举维护，工单录入的可选可写依赖此表
 *
 * 基础字典路由 —— IT 运维工单台账与日报自动管理系统
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
const { auth, adminOnly } = require('../middleware/auth')

router.use(auth)

const TYPES = ['dept', 'app_system', 'problem_type']
const LABELS = { dept: '部门', app_system: '应用系统', problem_type: '问题类别' }

// 获取全部字典（前端下拉）；manage=1 返回含停用项（管理员维护用）
/**
 * 一次性返回三类字典（部门/应用系统/问题类别），给录入页下拉用。
 * 权限：登录即可；manage=1 且是管理员时才带上已停用项，普通用户只看到启用的。
 *
 * @param {import('express').Request} req query.manage=1 管理视角
 * @param {import('express').Response} res { dept[], app_system[], problem_type[] }
 * @returns {Promise<void>}
 */
router.get('/', asyncHandler(async (req, res) => {
  const manage = req.query.manage === '1' && req.user.role === 'admin'
  const result = {}
  for (const t of TYPES) {
    const rows = await query(
      `SELECT dict_id, dict_label, dict_value, sort, is_enable FROM sys_dict
       WHERE dict_type = ? ${manage ? '' : 'AND is_enable = 1'} ORDER BY sort, dict_id`,
      [t]
    )
    result[t] = rows
  }
  ok(res, result)
}))

// 单类型列表
/**
 * 按类型取字典（含已停用项，供设置页维护列表展示）。类型不在白名单直接拒绝，防注入。
 *
 * @param {import('express').Request} req req.params.type 为 dept|app_system|problem_type
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/:type', asyncHandler(async (req, res) => {
  const { type } = req.params
  if (!TYPES.includes(type)) return fail(res, '字典类型错误')
  const rows = await query(
    'SELECT dict_id, dict_label, dict_value, sort, is_enable FROM sys_dict WHERE dict_type = ? ORDER BY sort, dict_id',
    [type]
  )
  ok(res, rows)
}))

// 新增（管理员）
/**
 * 新增字典项。权限：仅管理员（adminOnly）。
 * dict_value 与 dict_label 都存名称：工单表里存的是名称而非编码，改名称等于改历史数据的关联键。
 *
 * @param {import('express').Request} req req.params.type、body: dict_label / sort
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.post('/:type', auth, adminOnly, asyncHandler(async (req, res) => {
  const { type } = req.params
  if (!TYPES.includes(type)) return fail(res, '字典类型错误')
  const { dict_label, sort } = req.body
  if (!dict_label) return fail(res, '名称必填')
  await query(
    'INSERT INTO sys_dict (dict_type, dict_label, dict_value, sort, is_enable) VALUES (?,?,?,?,1)',
    [type, dict_label, dict_label, sort || 0]
  )
  ok(res, null, '新增成功')
}))

// 修改 / 停用（管理员）
/**
 * 修改或停用字典项。权限：仅管理员。
 * 停用优先于删除：停用只是不再出现在新录入的下拉里，历史工单上的旧取值仍能正常显示与统计。
 *
 * @param {import('express').Request} req req.params.type / id，body: dict_label / sort / is_enable
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.put('/:type/:id', auth, adminOnly, asyncHandler(async (req, res) => {
  const { dict_label, sort, is_enable } = req.body
  const sets = [], vals = []
  if (dict_label !== undefined) { sets.push('dict_label = ?'); vals.push(dict_label); sets.push('dict_value = ?'); vals.push(dict_label) }
  if (sort !== undefined) { sets.push('sort = ?'); vals.push(sort) }
  if (is_enable !== undefined) { sets.push('is_enable = ?'); vals.push(is_enable ? 1 : 0) }
  if (!sets.length) return fail(res, '无更新字段')
  vals.push(req.params.id)
  await query(`UPDATE sys_dict SET ${sets.join(', ')} WHERE dict_id = ?`, vals)
  ok(res, null, '更新成功')
}))

// 删除（管理员）
/**
 * 物理删除字典项。权限：仅管理员。删掉后历史工单里的旧取值仍在，
 * 但下拉里不会再出现，所以只建议删「录错且从未被引用」的项，正常下架请用停用。
 *
 * @param {import('express').Request} req req.params.id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.delete('/:type/:id', auth, adminOnly, asyncHandler(async (req, res) => {
  await query('DELETE FROM sys_dict WHERE dict_id = ?', [req.params.id])
  ok(res, null, '删除成功')
}))

module.exports = router
