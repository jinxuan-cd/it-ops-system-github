/**
 * @file backend/src/routes/system.js
 * @description 门户对外地址、自助入口密钥、工作流开关等全局配置
 *
 * 系统设置路由 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 系统公共设置：自助报障入口开关 / 密钥 / FAQ 门户开关 / 公网门户地址
const express = require('express')
const router = express.Router()
const { ok, fail, asyncHandler } = require('../utils/helpers')
const { auth, adminOnly } = require('../middleware/auth')
const { settingGet, settingSet, ensurePublicSettings } = require('../utils/seed')
const { PORTAL_VERSION } = require('../utils/portalVersion')

router.use(auth)

// 公网门户地址规范化：允许填 IP、域名、带端口，可不写协议
//   example.com:8081              -> http://example.com:8081
//   https://it.example.com/       -> https://it.example.com
//   http://1.2.3.4:8081/report    -> http://1.2.3.4:8081   （只保留到端口，路径丢掉）
/**
 * 规范化对外门户地址：只保留「协议 + 主机 + 端口」，路径与参数一律丢掉。
 * 因为二维码是把门户根地址拼上固定路径生成的，带路径的地址会拼出 404。
 *
 * @param {string} raw 用户输入
 * @returns {string} 非法或空返回空串，由调用方决定报错
 */
function normalizeBaseUrl(raw) {
  let s = String(raw || '').trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s
  try {
    const u = new URL(s)
    if (!u.hostname) return ''
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}

// 两个对外端口（门户必须用 PUBLIC_PORT，填成 ADMIN_PORT 扫码会打开后台登录页）
const ADMIN_PORT = String(process.env.ADMIN_PORT || '8080')
const PUBLIC_PORT = String(process.env.PUBLIC_PORT || '8081')

/**
 * 取地址里的端口，没显式写端口就按协议推 80/443，用于识别「填成管理端端口」这个高频错误。
 *
 * @param {string} url
 * @returns {string} 解析失败返回空串
 */
function portOf(url) {
  try {
    const u = new URL(url)
    if (u.port) return u.port
    return u.protocol === 'https:' ? '443' : '80'
  } catch {
    return ''
  }
}

/**
 * 汇总当前对外门户配置，读接口与写接口保存后都用它回显，保证两处字段一致。
 * 唯一返回密钥明文的地方（管理员要看/要分享二维码），因此只挂在管理端路由上。
 *
 * @returns {Promise<object>}
 */
async function readPublicSettings() {
  const ps = await ensurePublicSettings()
  return {
    report_enable: ps.report_enable,
    faq_enable: ps.faq_enable,
    report_key: ps.key,
    // 员工自助门户的公网地址，例如 http://it-report.example.com:8081
    public_base_url: (await settingGet('public_base_url')) || '',
    // 值班 IT 联系方式：最多 2 人，门户上可直接点击拨打
    duty_contacts: ps.duty_contacts || [],
    // 后端认定门户版本，用于核对服务器上的门户是否已更新
    portal_version: PORTAL_VERSION,
    // 两个对外端口，前端据此提示「是不是把管理端端口填成了门户地址」
    admin_port: ADMIN_PORT,
    public_port: PUBLIC_PORT
  }
}

/**
 * 读取自助门户设置（开关、密钥、对外地址、值班电话、门户版本与两个端口）。
 * 权限：任意已登录用户可读，方便录入页展示「报障二维码」与联系方式。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/public-settings', asyncHandler(async (req, res) => {
  ok(res, await readPublicSettings())
}))

// 修改开关；传 rotate=1 可重置入口密钥（旧二维码立即失效）
/**
 * 保存自助门户设置。权限：仅管理员。
 * 只更新 body 里出现的字段；地址填了但解析不出来、或用了管理端端口，直接拒绝保存，
 * 因为这两种情况对外表现都是「员工扫码打不开」，事后排查成本很高。
 *
 * @param {import('express').Request} req body: report_enable / faq_enable / public_base_url / duty_contacts / rotate
 * @param {import('express').Response} res 保存后的完整设置
 * @returns {Promise<void>}
 */
router.put('/public-settings', adminOnly, asyncHandler(async (req, res) => {
  const b = req.body
  if (b.report_enable !== undefined) await settingSet('report_enable', b.report_enable ? '1' : '0')
  if (b.faq_enable !== undefined) await settingSet('faq_enable', b.faq_enable ? '1' : '0')
  if (b.public_base_url !== undefined) {
    const raw = String(b.public_base_url || '').trim()
    const norm = normalizeBaseUrl(raw)
    // 填了但解析不出来，直接报错，避免存进空值后二维码指回内网地址
    if (raw && !norm) return fail(res, '公网门户地址格式不正确，请填写如 http://your-domain.com:8081')
    // 填成管理端端口是最常见的坑：扫码会打开后台登录页，员工以为「报障系统变了」
    if (norm && portOf(norm) === ADMIN_PORT) {
      return fail(res, `这个地址用的是管理端端口 ${ADMIN_PORT}，员工扫码会打开后台登录页。员工门户端口是 ${PUBLIC_PORT}，请改成 http://域名或IP:${PUBLIC_PORT}`)
    }
    await settingSet('public_base_url', norm)
  }
  // 值班 IT 联系方式：最多 2 人，姓名可空，电话必填；只保留数字与 + - 空格
  if (b.duty_contacts !== undefined) {
    const raw = Array.isArray(b.duty_contacts) ? b.duty_contacts : []
    const list = []
    for (const c of raw.slice(0, 2)) {
      const phone = String((c && c.phone) || '').replace(/[^\d+\-\s()]/g, '').trim()
      if (!phone) continue
      list.push({
        name: String((c && c.name) || '').slice(0, 20).trim(),
        phone: phone.slice(0, 30),
        note: String((c && c.note) || '').slice(0, 30).trim()
      })
    }
    await settingSet('duty_contacts', JSON.stringify(list))
  }
  if (b.rotate) {
    const key = require('crypto').randomBytes(9).toString('hex')
    await settingSet('report_key', key)
  }
  ok(res, await readPublicSettings(), '已保存')
}))

// 工单流转设置：服务台开关（可选角色）
//   service_desk_enable = 0：新工单直接通知全部运维，谁抢到谁处理（默认）
//   service_desk_enable = 1：新工单只通知服务台 + 管理员，由服务台派单
/**
 * 读取工单流转开关（是否启用服务台派单模式）。
 * 这个开关直接决定新工单通知谁，前端各处按钮与列表都要跟着变。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res { service_desk_enable }
 * @returns {Promise<void>}
 */
router.get('/workflow-settings', asyncHandler(async (req, res) => {
  ok(res, {
    service_desk_enable: (await settingGet('service_desk_enable')) === '1'
  })
}))

/**
 * 保存工单流转开关。权限：仅管理员。切换后只影响之后新建的工单，存量工单不动。
 *
 * @param {import('express').Request} req body.service_desk_enable
 * @param {import('express').Response} res 保存后的当前值
 * @returns {Promise<void>}
 */
router.put('/workflow-settings', adminOnly, asyncHandler(async (req, res) => {
  const b = req.body
  if (b.service_desk_enable !== undefined) await settingSet('service_desk_enable', b.service_desk_enable ? '1' : '0')
  ok(res, { service_desk_enable: (await settingGet('service_desk_enable')) === '1' }, '已保存')
}))

module.exports = router
