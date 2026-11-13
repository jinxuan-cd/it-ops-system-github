/**
 * @file backend/src/utils/loginGuard.js
 * @description 登录失败次数计数与锁定、图形验证码生成与一次性校验
 *
 * 登录防护 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 登录防护：连续失败计数 → 强制验证码 → 锁定
// 说明：计数保存在内存（Map），进程重启即清零；单实例内网部署足够，
//       多实例部署请改用 Redis 或数据库表。
const CAPTCHA_AFTER = 3          // 连续失败达到 N 次后必须输入验证码
const LOCK_AFTER = 5             // 连续失败达到 N 次后锁定账号
const LOCK_MS = 5 * 60 * 1000    // 锁定时长：5 分钟
const CAPTCHA_TTL = 5 * 60 * 1000 // 验证码有效期：5 分钟

const fails = new Map()     // username(小写) -> { count, lockUntil }
const captchas = new Map()  // captcha_id -> { code, expire }

/**
 * 用户名归一化：去空白 + 转小写，作为内存计数的 key。
 * 必须归一，否则 Admin / admin / " admin" 会被当成三个账号，
 * 攻击者只要变换大小写就能绕过失败计数。
 *
 * @param {string} username
 * @returns {string}
 */
function norm(username) {
  return String(username || '').trim().toLowerCase()
}

// 当前状态：是否锁定 / 是否需要验证码 / 剩余可尝试次数
/**
 * 查询某账号当前的登录防护状态，供登录页决定是否弹出验证码、是否禁用提交。
 *
 * @param {string} username 原始用户名
 * @returns {{count:number, locked:boolean, lockRemain:number, needCaptcha:boolean, remain:number}}
 *          lockRemain 为剩余锁定秒数；remain 为锁定前还能试几次
 * @sideeffect 锁定已过期时会顺手清掉 lockUntil（惰性清理，避免另起定时器）
 */
function status(username) {
  const key = norm(username)
  const rec = fails.get(key)
  const now = Date.now()
  if (!rec) return { count: 0, locked: false, lockRemain: 0, needCaptcha: false, remain: LOCK_AFTER }
  if (rec.lockUntil && rec.lockUntil > now) {
    return {
      count: rec.count,
      locked: true,
      lockRemain: Math.ceil((rec.lockUntil - now) / 1000),
      needCaptcha: true,
      remain: 0
    }
  }
  // 锁定期已过：清掉锁定标记，但仍要求验证码
  if (rec.lockUntil && rec.lockUntil <= now) rec.lockUntil = 0
  return {
    count: rec.count,
    locked: false,
    lockRemain: 0,
    needCaptcha: rec.count >= CAPTCHA_AFTER,
    remain: Math.max(0, LOCK_AFTER - rec.count)
  }
}

// 记录一次失败，返回最新状态（含是否刚刚被锁定）
/**
 * 记一次密码错误。
 *
 * @param {string} username 原始用户名
 * @returns {{count:number, locked:boolean, lockRemain:number, needCaptcha:boolean, remain:number, justLocked:boolean}}
 *          justLocked 表示本次调用刚触发锁定，用于给前端一句「已锁定 5 分钟」的提示
 * @sideeffect 达到 LOCK_AFTER 后写入 lockUntil；计数被压回 CAPTCHA_AFTER，
 *             这样锁定到期后仍需验证码，但不会一错就再次锁定
 */
function onFail(username) {
  const key = norm(username)
  const now = Date.now()
  const rec = fails.get(key) || { count: 0, lockUntil: 0 }
  if (rec.lockUntil && rec.lockUntil <= now) rec.lockUntil = 0
  rec.count += 1
  let justLocked = false
  if (rec.count >= LOCK_AFTER) {
    rec.lockUntil = now + LOCK_MS
    rec.count = CAPTCHA_AFTER // 解锁后仍需验证码
    justLocked = true
  }
  fails.set(key, rec)
  return { ...status(username), justLocked }
}

// 登录成功：清零
/**
 * 登录成功后清空该账号的失败计数与锁定状态。
 *
 * @param {string} username 原始用户名
 * @returns {void}
 */
function onSuccess(username) {
  fails.delete(norm(username))
}

// ---------- 验证码 ----------
const CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' // 去掉易混淆的 0/O/1/I

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

/**
 * 生成指定位数的随机验证码，字符集见 CHARS（已排除易混淆字符）。
 * 用 Math.random 而非加密随机：验证码只防脚本爆破，配合 5 分钟过期与失败锁定已足够，
 * 换成 crypto.randomInt 也可以，但没必要为此引入额外开销。
 *
 * @param {number} [len=4]
 * @returns {string}
 */
function makeCode(len = 4) {
  let s = ''
  for (let i = 0; i < len; i++) s += CHARS[rand(0, CHARS.length - 1)]
  return s
}

/**
 * 把验证码渲染成 SVG 字符串。
 *
 * 用 SVG 而不是 canvas 图片：服务端不需要图形库依赖，体积小，
 * 且能直接 base64 内联成 <img src>，前端不用额外的图片接口。
 * 干扰线/点与字符随机旋转是为了让简单 OCR 失效，强度够用即可——
 * 真正的防线是失败计数与锁定，验证码只是抬高自动化成本。
 *
 * @param {string} code 验证码明文
 * @returns {string} 完整 SVG 文档
 */
function svgOf(code) {
  const w = 110, h = 38
  let body = ''
  // 干扰线
  for (let i = 0; i < 4; i++) {
    const c = `hsl(${rand(190, 265)},55%,${rand(55, 75)}%)`
    body += `<line x1="${rand(0, w)}" y1="${rand(0, h)}" x2="${rand(0, w)}" y2="${rand(0, h)}" stroke="${c}" stroke-width="1.2" />`
  }
  // 干扰点
  for (let i = 0; i < 26; i++) {
    const c = `hsl(${rand(190, 265)},45%,${rand(45, 72)}%)`
    body += `<circle cx="${rand(0, w)}" cy="${rand(0, h)}" r="${rand(1, 2)}" fill="${c}" />`
  }
  // 字符
  for (let i = 0; i < code.length; i++) {
    const x = 14 + i * 23 + rand(-3, 3)
    const y = 27 + rand(-3, 3)
    const rot = rand(-28, 28)
    const c = `hsl(${rand(205, 250)},${rand(50, 70)}%,${rand(28, 42)}%)`
    body += `<text x="${x}" y="${y}" font-family="Verdana,Arial,sans-serif" font-size="${rand(20, 24)}" font-weight="700" fill="${c}" transform="rotate(${rot} ${x} ${y})">${code[i]}</text>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#eef2f9"/>${body}</svg>`
}

// 生成验证码：返回 id + 可直接给 <img src> 的 data URL
/**
 * 新建一个验证码并登记到内存。
 *
 * @returns {{captcha_id:string, image:string}} image 为 data:image/svg+xml 形式，可直接塞 img.src
 * @sideeffect captchas 中新增一条记录，TTL 5 分钟；过期不依赖定时器清理，
 *             校验时会先判过期时间，定时器只负责回收内存
 */
function createCaptcha() {
  const code = makeCode(4)
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  captchas.set(id, { code, expire: Date.now() + CAPTCHA_TTL })
  const svg = svgOf(code)
  return { captcha_id: id, image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` }
}

// 校验并一次性消费（校验后立即失效，防重放）
/**
 * 校验验证码，无论对错都立刻作废该 id。
 *
 * 一次性是关键：否则同一张图可被脚本反复提交，直到猜中为止，
 * 验证码就完全失效了。校验后再调一次必然返回 false，属预期行为。
 *
 * @param {string} id captcha_id
 * @param {string} input 用户输入
 * @returns {boolean} 是否通过（大小写不敏感）
 */
function verifyCaptcha(id, input) {
  if (!id || !input) return false
  const rec = captchas.get(String(id))
  captchas.delete(String(id))
  if (!rec) return false
  if (rec.expire < Date.now()) return false
  return String(input).trim().toUpperCase() === rec.code
}

// 定期清理过期数据，避免内存膨胀
// 失败记录保留到解锁后 30 分钟：过早删除会让「锁定 → 稍等 → 计数归零」变成绕过手段
const timer = setInterval(() => {
  const now = Date.now()
  for (const [k, v] of captchas) if (v.expire < now) captchas.delete(k)
  for (const [k, v] of fails) {
    if (v.count > 0 && (!v.lockUntil || v.lockUntil < now - 30 * 60 * 1000)) fails.delete(k)
  }
}, 10 * 60 * 1000)
// unref：定时器不阻塞进程退出（否则测试和 CLI 脚本会挂住不退）
if (timer.unref) timer.unref()

module.exports = {
  CAPTCHA_AFTER,
  LOCK_AFTER,
  LOCK_MS,
  status,
  onFail,
  onSuccess,
  createCaptcha,
  verifyCaptcha
}
