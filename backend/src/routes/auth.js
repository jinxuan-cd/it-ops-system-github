/**
 * @file backend/src/routes/auth.js
 * @description 图形验证码、账号密码校验、JWT 签发、个人信息读取与修改密码
 *
 * 登录认证路由 —— IT 运维工单台账与日报自动管理系统
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
const { signToken, auth } = require('../middleware/auth')
const guard = require('../utils/loginGuard')

// 登录验证码（公开接口）：连续输错 3 次后前端会显示并要求填写
/**
 * 生成图形验证码，返回 id 与图片，前端连续输错后才展示。
 * 免登录：这是登录前就要用的接口，不能要求 Token。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/captcha', asyncHandler(async (req, res) => {
  const c = guard.createCaptcha()
  ok(res, c)
}))

// 登录
/**
 * 账号密码登录，返回 JWT 与脱敏后的用户信息。
 * 免登录接口，但受 loginGuard 保护：失败 N 次后强制验证码，再失败即锁定若干分钟；
 * 验证码输错同样计入失败次数，防止用「乱填验证码」绕开计数。
 * 账号不存在时也跑一次 bcrypt 比对，抹平响应时间差，避免被探测出哪些账号存在。
 *
 * @param {import('express').Request} req body: username / password / captcha_id / captcha_code
 * @param {import('express').Response} res data 含 token、user，或 needCaptcha/locked/remain 提示
 * @returns {Promise<void>}
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password, captcha_id, captcha_code } = req.body
  if (!username || !password) return res.json({ code: 1, message: '账号和密码必填', data: null })

  // 1) 是否已被锁定
  const st = guard.status(username)
  if (st.locked) {
    const min = Math.ceil(st.lockRemain / 60)
    return res.json({
      code: 1,
      message: `密码连续输错 ${guard.LOCK_AFTER} 次，账号已锁定，请 ${min} 分钟后再试`,
      data: { locked: true, lockRemain: st.lockRemain, needCaptcha: true }
    })
  }

  // 2) 失败次数达到阈值后，必须先通过验证码
  if (st.needCaptcha) {
    if (!captcha_id || !captcha_code) {
      return res.json({ code: 1, message: '为保障账号安全，请输入验证码', data: { needCaptcha: true, remain: st.remain } })
    }
    if (!guard.verifyCaptcha(captcha_id, captcha_code)) {
      const s = guard.onFail(username) // 验证码错误同样计入失败，防绕过
      return res.json({
        code: 1,
        message: s.locked
          ? `验证码错误，且已连续失败 ${guard.LOCK_AFTER} 次，账号锁定 5 分钟`
          : '验证码错误或已过期，请刷新后重新输入',
        data: { needCaptcha: true, locked: !!s.locked, lockRemain: s.lockRemain, remain: s.remain }
      })
    }
  }

  // 3) 校验账号密码
  const rows = await query('SELECT * FROM sys_user WHERE username = ?', [username])
  const user = rows[0]
  // 账号不存在时也做一次 bcrypt 比对，避免通过响应时间判断账号是否存在
  const hash = user ? user.password : '$2a$10$CwTycUXWue0Thq9StjUM0uJ8DrsdOSTPKPLpUhQGeKFuVXKpW7fpi'
  const match = await bcrypt.compare(String(password), hash)

  if (!user || !match) {
    const s = guard.onFail(username)
    let message = '账号或密码错误'
    if (s.justLocked) message = `密码连续输错 ${guard.LOCK_AFTER} 次，账号已锁定 5 分钟`
    else if (s.locked) message = `账号已锁定，请 ${Math.ceil(s.lockRemain / 60)} 分钟后再试`
    else if (s.needCaptcha) message = `账号或密码错误，再错 ${s.remain} 次将锁定账号，请输入验证码`
    else message = `账号或密码错误，还可尝试 ${s.remain} 次`
    return res.json({
      code: 1,
      message,
      data: { needCaptcha: s.needCaptcha, locked: !!s.locked, lockRemain: s.lockRemain, remain: s.remain }
    })
  }

  if (!user.is_enable) return res.json({ code: 1, message: '账号已停用，请联系管理员', data: null })

  // 登录成功：清零失败计数
  guard.onSuccess(username)
  const token = signToken(user)
  const { password: _p, ...safe } = user
  ok(res, { token, user: safe })
}))

// 当前登录人
/**
 * 取当前登录人信息，刷新页面时用它恢复前端登录态。权限：登录用户本人。
 *
 * @param {import('express').Request} req req.user 由 auth 中间件解析 JWT 注入
 * @param {import('express').Response} res 用户信息，账号已被删除时返回 null
 * @returns {Promise<void>}
 */
router.get('/me', auth, asyncHandler(async (req, res) => {
  const rows = await query(
    'SELECT user_id, username, real_name, role, is_enable, create_time FROM sys_user WHERE user_id = ?',
    [req.user.user_id]
  )
  ok(res, rows[0] || null)
}))

// 修改个人信息（仅本人，可改 real_name）
/**
 * 修改自己的显示名。权限：登录用户，只能改自己（user_id 取自 Token，不接收前端传入）。
 * 只能改 real_name：角色、启用状态属于管理员权限，个人中心不得越权修改。
 *
 * @param {import('express').Request} req body.real_name
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.put('/me', auth, asyncHandler(async (req, res) => {
  const { real_name } = req.body
  if (real_name === undefined) return fail(res, '无更新字段')
  await query('UPDATE sys_user SET real_name = ? WHERE user_id = ?', [real_name || '', req.user.user_id])
  const rows = await query(
    'SELECT user_id, username, real_name, role, is_enable, create_time FROM sys_user WHERE user_id = ?',
    [req.user.user_id]
  )
  ok(res, rows[0], '个人信息已更新')
}))

// 修改密码（本人，需校验旧密码）
/**
 * 修改自己的登录密码。权限：登录用户本人，必须先验证旧密码（防止拿到未锁屏终端就能改密码）。
 * 密码用 bcrypt 存哈希，新密码至少 6 位；改完提示重新登录，旧 Token 到期自然失效。
 *
 * @param {import('express').Request} req body: old_password / new_password
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.put('/password', auth, asyncHandler(async (req, res) => {
  const { old_password, new_password } = req.body
  if (!old_password || !new_password) return fail(res, '旧密码和新密码必填')
  if (String(new_password).length < 6) return fail(res, '新密码至少 6 位')
  const rows = await query('SELECT * FROM sys_user WHERE user_id = ?', [req.user.user_id])
  if (!rows.length) return fail(res, '账号不存在')
  const match = await bcrypt.compare(old_password, rows[0].password)
  if (!match) return fail(res, '原密码不正确')
  await query('UPDATE sys_user SET password = ? WHERE user_id = ?', [await bcrypt.hash(new_password, 10), req.user.user_id])
  ok(res, null, '密码已修改，请重新登录')
}))

module.exports = router
