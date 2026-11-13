/**
 * @file backend/src/middleware/auth.js
 * @description JWT 校验、用户信息缓存、管理员与查看全部权限守卫
 *
 * 鉴权中间件 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
const jwt = require('jsonwebtoken')
const { fail } = require('../utils/helpers')
const { query } = require('../db')

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_prod'

// 角色说明：
//   admin    管理员：全部功能 + 账号/字典管理
//   auditor  审计员：只读查看全公司数据（看板、团队分析、工单/知识/项目），不能新增或修改业务数据
//   service  服务台（可选角色）：负责派单，可查看全部工单并指派/转单；不开服务台时由运维自行抢单
//   user     普通运维：只能看自己录的单、指派给自己的单，以及待接单池
const ROLE_VIEW_ALL = ['admin', 'auditor']
const ROLES = ['admin', 'auditor', 'service', 'user']

/**
 * 该角色是否能看全公司数据。
 * 只有 admin / auditor 在名单里；service（服务台）虽然能看到全部工单，
 * 但并不等于「看全部统计」的能力授权，因此没有并入本名单，判断时不要混用。
 *
 * @param {string} role 角色标识
 * @returns {boolean}
 */
function isViewAll(role) { return ROLE_VIEW_ALL.includes(role) }

/**
 * 签发登录 token。
 * 载荷只放 user_id / username / role 三个字段，其余信息一律请求时回查数据库，
 * 避免把可变状态（部门、头像）塞进 token 后长期不更新。
 *
 * @param {{user_id:number, username:string, role:string}} user 用户记录
 * @returns {string} 有效期 12 小时的 JWT
 */
function signToken(user) {
  return jwt.sign(
    { user_id: user.user_id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  )
}

// 鉴权中间件：解析 Bearer Token，挂载 req.user
// 同时回查账号状态（60 秒缓存）：停用账号 / 角色变更不必等 token 过期就生效，
// 否则把某人降级为只读审计员后，他手里的旧 token 12 小时内仍可写数据
const STATUS_TTL = 60 * 1000
const statusCache = new Map() // user_id -> { role, is_enable, at }

/**
 * 清空账号状态缓存。停用账号、改角色、删用户后必须调用，
 * 否则最长 60 秒内仍按旧角色放行。
 *
 * @param {number} [userId] 传则只清该用户，不传则整体清空（如批量导入后）
 * @returns {void}
 */
function clearAuthCache(userId) {
  if (userId) statusCache.delete(Number(userId))
  else statusCache.clear()
}

/**
 * 登录态校验中间件：验签 token，并用数据库里的最新角色覆盖 token 里的角色。
 *
 * @param {import('express').Request} req 需带 `Authorization: Bearer <token>`
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 * @sideeffect 成功时挂载 `req.user = { user_id, username, role }`；失败直接 401/403 响应
 *
 * 注意两处刻意的取舍：
 * 1) 数据库抖动时不阻断请求（沿用 token 内角色），宁可短暂放松也不要全员掉线；
 * 2) 因此本中间件只能保证「身份真实」，不能保证「角色最新」，
 *    真正的权限判定仍由 adminOnly / canViewAll 以及路由内的归属校验兜底。
 */
async function auth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return fail(res, '未登录或 token 缺失', 401, 401)
  let decoded
  try {
    decoded = jwt.verify(token, JWT_SECRET)
  } catch (e) {
    return fail(res, 'token 无效或已过期', 401, 401)
  }
  try {
    const uid = Number(decoded.user_id)
    let c = statusCache.get(uid)
    if (!c || Date.now() - c.at > STATUS_TTL) {
      const rows = await query('SELECT role, is_enable FROM sys_user WHERE user_id = ?', [uid])
      if (!rows.length) return fail(res, '账号不存在或已被删除', 401, 401)
      c = { role: rows[0].role, is_enable: Number(rows[0].is_enable), at: Date.now() }
      statusCache.set(uid, c)
    }
    if (!c.is_enable) return fail(res, '账号已停用，请联系管理员', 403, 403)
    decoded.role = c.role // 以数据库里的最新角色为准
  } catch (e) {
    // 数据库异常时不阻断请求（避免数据库抖动导致全员掉线），沿用 token 里的角色
  }
  req.user = decoded
  next()
}

// 管理员中间件（账号管理 / 字典维护等写操作）
/**
 * 管理员守卫：只放行 admin。必须挂在 auth 之后，
 * 单独使用时 req.user 为空会一律拒绝（默认拒绝优于默认放行）。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function adminOnly(req, res, next) {
  if (req.user && req.user.role === 'admin') return next()
  return fail(res, '需要管理员权限', 403, 403)
}

// 可查看全公司数据（管理员 + 审计员）
/**
 * 「看全员数据」守卫：admin 与 auditor 通过，service 与 user 拒绝。
 * 与 adminOnly 的区别：审计员能看但不能写，写操作由 index.js 的只读闸门另行拦截。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function canViewAll(req, res, next) {
  if (req.user && isViewAll(req.user.role)) return next()
  return fail(res, '需要管理员或审计员权限', 403, 403)
}

module.exports = { signToken, auth, adminOnly, canViewAll, isViewAll, clearAuthCache, JWT_SECRET, ROLES }
