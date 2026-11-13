/**
 * @file backend/src/routes/users.js
 * @description 运维人员账号、角色与状态维护
 *
 * 人员管理路由 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const { query } = require('../db')
const { ok, fail, asyncHandler } = require('../utils/helpers')
const { auth, adminOnly, clearAuthCache, ROLES } = require('../middleware/auth')
const { checkRoleCount } = require('../utils/license')

// 角色白名单校验：admin（管理员）/ auditor（审计员，只读全公司）/ service（服务台，派单）/ user（运维工程师）
/**
 * 角色白名单校验：非法值一律回落 user，避免前端传错把账号搞成「无角色」而什么都点不开。
 *
 * @param {string} r
 * @returns {string}
 */
function normRole(r) { return ROLES.includes(r) ? r : 'user' }

// 仅管理员可访问用户管理
router.use(auth, adminOnly)

// 当前还有几个可用的管理员（防止把自己降权/停用/删掉后再也进不了后台）
/**
 * 统计其余可用管理员数量（排除指定账号），用于「至少保留一个管理员」的守门判断。
 *
 * @param {number|null} excludeId 要排除的账号 ID
 * @returns {Promise<number>}
 */
async function activeAdminCount(excludeId = null) {
  const rows = excludeId
    ? await query("SELECT COUNT(*) AS n FROM sys_user WHERE role = 'admin' AND is_enable = 1 AND user_id <> ?", [excludeId])
    : await query("SELECT COUNT(*) AS n FROM sys_user WHERE role = 'admin' AND is_enable = 1")
  return Number((rows[0] && rows[0].n) || 0)
}

// 列表
/**
 * 人员列表。权限：仅管理员（router.use 已统一拦截）。
 * 只返回展示字段，密码哈希永不出库到接口。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/', asyncHandler(async (req, res) => {
  const rows = await query(
    'SELECT user_id, username, real_name, role, is_enable, create_time FROM sys_user ORDER BY user_id'
  )
  ok(res, rows)
}))

// 新增
/**
 * 新建人员账号。权限：仅管理员。
 * 密码 bcrypt 存哈希、至少 6 位；账号名唯一，重复直接拒绝；新账号默认启用。
 *
 * @param {import('express').Request} req body: username / password / real_name / role
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.post('/', asyncHandler(async (req, res) => {
  const { username, password, real_name, role } = req.body
  if (!username || !password) return fail(res, '账号和密码必填')
  if (String(password).length < 6) return fail(res, '密码至少 6 位')
  const exists = await query('SELECT 1 FROM sys_user WHERE username = ?', [username])
  if (exists.length) return fail(res, '账号已存在')

  // 授权上限：免费版仅 1 管理员 + 2 运维；激活授权码后按授权上限放开
  const r = normRole(role)
  const chk = await checkRoleCount(r, query)
  if (!chk.ok) return fail(res, chk.msg)

  const hash = await bcrypt.hash(password, 10)
  await query(
    'INSERT INTO sys_user (username, password, real_name, role, is_enable) VALUES (?,?,?,?,1)',
    [username, hash, real_name || '', normRole(role)]
  )
  ok(res, null, '创建成功')
}))

// 修改（含启用/停用、改密码）
/**
 * 修改人员信息：显示名、角色、启用状态、重置密码，只改传入的字段。
 * 权限：仅管理员。
 * 保底规则：任何会让「可用管理员」归零的操作（降级/停用最后一个管理员）一律拒绝，
 *          否则会把自己锁在系统外面，只能改库才能救回来；
 *          改完立刻清掉该账号的权限缓存，让新角色马上生效而不是等 60 秒。
 *
 * @param {import('express').Request} req req.params.id 为目标账号，body 可含 real_name / role / is_enable / password
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const { real_name, role, is_enable, password } = req.body
  const sets = []
  const params = []

  const target = await query('SELECT role, is_enable FROM sys_user WHERE user_id = ?', [id])
  if (!target.length) return fail(res, '账号不存在')
  const curRole = target[0].role
  const curEnabled = Number(target[0].is_enable) === 1

  // 保护最后一个可用管理员：不能降级、不能停用
  const willDropAdmin = (role !== undefined && normRole(role) !== 'admin') || (is_enable !== undefined && !is_enable)
  if (willDropAdmin && curRole === 'admin') {
    if (await activeAdminCount(id) === 0) return fail(res, '这是最后一个可用管理员账号，不能降级或停用，请先新增一个管理员')
  }

  // 授权上限：变更角色 / 启用账号会净增目标角色的可用名额，需校验上限（排除自己）
  const newRole = role !== undefined ? normRole(role) : curRole
  const willEnable = is_enable !== undefined ? !!is_enable : curEnabled
  if (willEnable && (newRole !== curRole || !curEnabled)) {
    const chk = await checkRoleCount(newRole, query, id)
    if (!chk.ok) return fail(res, chk.msg)
  }

  if (real_name !== undefined) { sets.push('real_name = ?'); params.push(real_name) }
  if (role !== undefined) { sets.push('role = ?'); params.push(normRole(role)) }
  if (is_enable !== undefined) { sets.push('is_enable = ?'); params.push(is_enable ? 1 : 0) }
  if (password) {
    if (String(password).length < 6) return fail(res, '密码至少 6 位')
    sets.push('password = ?'); params.push(await bcrypt.hash(password, 10))
  }
  if (!sets.length) return fail(res, '无更新字段')
  params.push(id)
  await query(`UPDATE sys_user SET ${sets.join(', ')} WHERE user_id = ?`, params)
  // 角色/启用状态立即生效（清掉 60 秒的账号状态缓存）
  clearAuthCache(id)
  ok(res, null, '更新成功')
}))

// 删除
/**
 * 删除人员账号。权限：仅管理员，且不能删自己、不能删掉最后一个可用管理员。
 * 口径：历史工单与知识库属于业务痕迹，一律保留，只把「指派人」解绑，
 *      这样历史统计里不会出现指向已删除账号的空处理人。
 *
 * @param {import('express').Request} req req.params.id 为 user_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  // 不允许删除自己
  if (id === Number(req.user.user_id)) return fail(res, '不能删除当前登录账号')
  const target = await query('SELECT role FROM sys_user WHERE user_id = ?', [id])
  if (!target.length) return fail(res, '账号不存在')
  if (target[0].role === 'admin' && await activeAdminCount(id) === 0) {
    return fail(res, '系统至少要保留一个可用的管理员账号')
  }

  // 该账号名下的工单/知识库等数据保留（便于追溯），仅解除归属，避免统计出现空人名
  await query('UPDATE ticket SET assignee_id = NULL, assign_time = NULL WHERE assignee_id = ?', [id]).catch(() => {})
  await query('DELETE FROM user_ai_config WHERE user_id = ?', [id]).catch(() => {})
  await query('DELETE FROM todo WHERE user_id = ?', [id]).catch(() => {})
  await query('DELETE FROM sys_user WHERE user_id = ?', [id])
  clearAuthCache(id)
  ok(res, null, '删除成功（其历史工单与知识库仍保留）')
}))

module.exports = router
