/**
 * @file backend/src/utils/license.js
 * @description 授权验证与账号上限控制。
 *
 * 授权码由作者的生成器项目用 RSA 私钥签名、AES 加密后下发，这里只负责：
 *   1) 验签 + 解密，确认不是伪造的；
 *   2) 读取已激活的授权，计算「当前各角色账号上限」；
 *   3) 在创建 / 变更用户角色时，按上限拦截并给出清晰提示。
 *
 * 没有激活任何授权时（免费版），内置上限 FREE_LIMITS = 管理员1 / 运维2 / 服务台0 / 审计0。
 * 授权过期也自动回落到免费版。
 */

const crypto = require('crypto')
const { PUBLIC_KEY_PEM, AES_KEY_B64 } = require('../config/licenseKeys')
const { settingGet, settingSet } = require('./seed')

// 免费版内置上限：未授权只允许 1 管理员 + 2 运维，服务台 / 审计员在免费版不可用
const FREE_LIMITS = { admin: 1, user: 2, service: 0, auditor: 0 }
const ROLES = ['admin', 'user', 'service', 'auditor']
const SETTING_KEY = 'license'

/**
 * 验证授权码字符串，返回解析后的载荷。任何校验不过都抛错（调用方捕获后回给用户）。
 * @param {string} code
 * @returns {{ver:number,customer:string,issued:string,exp:string|null,limits:Object,note:string}}
 */
function verifyLicense(code) {
  if (!code || typeof code !== 'string' || !code.includes('.')) {
    throw new Error('授权码格式不正确')
  }
  const [blob, sign] = code.split('.')
  if (!blob || !sign) throw new Error('授权码格式不正确')

  // 1) 验签：只有作者私钥能签出可通过公钥验证的串
  const ok = crypto.createVerify('RSA-SHA256').update(blob).verify(PUBLIC_KEY_PEM, sign, 'base64url')
  if (!ok) throw new Error('授权码签名校验失败（可能是伪造或被篡改）')

  // 2) 解密载荷：iv(12) + authTag(16) + ciphertext
  let buf
  try { buf = Buffer.from(blob, 'base64url') } catch (e) { throw new Error('授权码内容无法解析') }
  if (buf.length < 28) throw new Error('授权码内容长度异常')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct = buf.subarray(28)
  let json
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(AES_KEY_B64, 'base64'), iv)
    decipher.setAuthTag(tag)
    json = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch (e) {
    throw new Error('授权码解密失败')
  }

  let p
  try { p = JSON.parse(json) } catch (e) { throw new Error('授权码载荷解析失败') }
  if (!p || typeof p.limits !== 'object') throw new Error('授权码缺少账号上限信息')

  // 规整载荷，缺省角色按 0
  const limits = {}
  for (const r of ROLES) limits[r] = Math.max(0, Math.floor(Number(p.limits[r]) || 0))
  return {
    ver: p.ver || 1,
    customer: String(p.customer || '').slice(0, 100),
    issued: p.issued || '',
    exp: p.exp ? String(p.exp).slice(0, 10) : null,
    limits,
    note: String(p.note || '').slice(0, 200)
  }
}

/** 读取已存储（已激活）的授权载荷；没有则返回 null */
async function getStoredLicense() {
  const raw = await settingGet(SETTING_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) } catch (e) { return null }
}

/** 保存激活的授权载荷（覆盖式） */
async function storeLicense(payload) {
  await settingSet(SETTING_KEY, JSON.stringify(payload))
}

/** 撤销授权：删除已激活记录，回到免费版 */
async function clearLicense() {
  await settingSet(SETTING_KEY, '')
}

/** 授权是否处于有效期内 */
function isExpired(payload) {
  if (!payload || !payload.exp) return false
  const exp = new Date(payload.exp + 'T23:59:59')
  return exp.getTime() < Date.now()
}

/**
 * 计算当前生效的各角色账号上限。
 * 已激活且未过期 → 用授权上限；否则 → 免费版上限。
 * @returns {Promise<{limits:Object, source:'license'|'free', expired:boolean, payload:Object|null}>}
 */
async function effectiveLimits() {
  const payload = await getStoredLicense()
  if (!payload) return { limits: { ...FREE_LIMITS }, source: 'free', expired: false, payload: null }
  if (isExpired(payload)) {
    return { limits: { ...FREE_LIMITS }, source: 'free', expired: true, payload }
  }
  const limits = {}
  for (const r of ROLES) limits[r] = Math.max(0, Math.floor(Number(payload.limits[r]) || 0))
  return { limits, source: 'license', expired: false, payload }
}

/**
 * 用于前端展示的授权状态。
 */
async function licenseStatus() {
  const payload = await getStoredLicense()
  const eff = await effectiveLimits()
  if (!payload) {
    return { activated: false, expired: false, freeLimits: FREE_LIMITS, limits: FREE_LIMITS, customer: '', issued: '', exp: null, note: '' }
  }
  return {
    activated: !eff.expired,
    expired: eff.expired,
    freeLimits: FREE_LIMITS,
    limits: eff.limits,
    customer: payload.customer || '',
    issued: payload.issued || '',
    exp: payload.exp || null,
    note: payload.note || ''
  }
}

/**
 * 校验「把某个角色的用户数 +1（或变更到该角色）」是否超过当前上限。
 * @param {string} role 目标角色
 * @param {Function} query db.query
 * @param {number} [excludeUserId] 变更角色时排除自己（自己不算新增）
 * @returns {Promise<{ok:boolean, limit:number, current:number, msg:string}>}
 */
async function checkRoleCount(role, query, excludeUserId) {
  const norm = ROLES.includes(role) ? role : 'user'
  const eff = await effectiveLimits()
  const limit = eff.limits[norm]
  const params = [norm]
  let sql = 'SELECT COUNT(*) AS n FROM sys_user WHERE role = ? AND is_enable = 1'
  if (excludeUserId) { sql += ' AND user_id <> ?'; params.push(excludeUserId) }
  const rows = await query(sql, params)
  const current = rows[0] ? Number(rows[0].n) : 0
  const ok = current < limit
  const msg = ok ? '' : `当前授权仅允许 ${limit} 个「${roleLabel(norm)}」账号，已用完。如需增加，请向作者获取新的授权码。`
  return { ok, limit, current, msg }
}

function roleLabel(r) {
  return r === 'admin' ? '管理员' : r === 'auditor' ? '审计员' : r === 'service' ? '服务台' : '运维工程师'
}

module.exports = {
  FREE_LIMITS,
  ROLES,
  verifyLicense,
  getStoredLicense,
  storeLicense,
  clearLicense,
  isExpired,
  effectiveLimits,
  licenseStatus,
  checkRoleCount,
  roleLabel
}
