// 免登录公开接口：员工扫码报障、查询进度、满意度评价、常见问题自助门户
// 安全措施：入口密钥校验 + 单 IP 频率限制 + 只暴露必要字段（不含内部处理细节与人名）
const express = require('express')
const fs = require('fs')
const path = require('path')
const router = express.Router()
const { query } = require('../db')
const { ok, fail, asyncHandler, safeJson } = require('../utils/helpers')
const { ensurePublicSettings } = require('../utils/seed')
const { applySla } = require('../utils/sla')
const { broadcast } = require('../utils/notifier')
const { dispatchTicket } = require('../utils/dispatch')
const { imageUpload, uploadDir } = require('../middleware/upload')

// ---- 简易频率限制（内存，重启清零，够用）----
const HITS = new Map()
function rateLimit(key, max = 12, windowMs = 3600 * 1000) {
  const now = Date.now()
  const rec = HITS.get(key) || { n: 0, reset: now + windowMs }
  if (now > rec.reset) { rec.n = 0; rec.reset = now + windowMs }
  rec.n += 1
  HITS.set(key, rec)
  return rec.n <= max
}
function clientIp(req) {
  return ((req.headers['x-forwarded-for'] || req.socket.remoteAddress || '') + '').split(',')[0].trim()
}
// 每小时清理一次过期计数，避免内存增长
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of HITS) if (now > v.reset) HITS.delete(k)
}, 600000).unref()

function nowStr() {
  const d = new Date(); const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
function onlyDigits(s) { return String(s || '').replace(/\D/g, '') }

// 生成报障单号：R + yyyymmdd + 4 位随机
async function nextReportNo() {
  const d = new Date(); const p = n => String(n).padStart(2, '0')
  for (let i = 0; i < 8; i++) {
    const no = `R${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${String(Math.floor(Math.random() * 9000) + 1000)}`
    const rows = await query('SELECT ticket_id FROM ticket WHERE report_no = ?', [no])
    if (!rows.length) return no
  }
  return `R${Date.now()}`
}

// 公开配置：前端据此决定页面是否可用
router.get('/config', asyncHandler(async (req, res) => {
  const ps = await ensurePublicSettings()
  ok(res, {
    report_enable: ps.report_enable,
    faq_enable: ps.faq_enable,
    has_key: !!ps.key,
    key_ok: req.query.k ? req.query.k === ps.key : false,
    // 值班 IT 联系方式（1~2 人），门户渲染成可点击拨打的按钮
    duty_contacts: ps.duty_contacts || []
  })
}))

// 报障表单可选项（部门 / 应用系统 / 问题类别）
router.get('/options', asyncHandler(async (req, res) => {
  const rows = await query(
    'SELECT dict_type, dict_label FROM sys_dict WHERE is_enable = 1 ORDER BY dict_type, sort, dict_id'
  )
  const out = { dept: [], app_system: [], problem_type: [] }
  rows.forEach(r => { if (out[r.dict_type]) out[r.dict_type].push(r.dict_label) })
  ok(res, out)
}))

// ---- 报障截图上传（可选）：只收图片，单张 ≤ 8MB，最多 3 张 ----
router.post('/upload', (req, res, next) => {
  ;(async () => {
    const ps = await ensurePublicSettings()
    if (!ps.report_enable) return fail(res, '自助报障入口暂未开放，请联系 IT')
    if (!req.query.k || req.query.k !== ps.key) return fail(res, '入口校验失败，请重新扫描二维码')
    if (!rateLimit('upload:' + clientIp(req), 40)) return fail(res, '上传过于频繁，请稍后再试')
    imageUpload.array('files', 3)(req, res, (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? '图片过大，单张上限 8MB' : (err.message || '上传失败')
        return fail(res, msg)
      }
      const files = req.files || []
      if (!files.length) return fail(res, '没有收到图片')
      ok(res, files.map(f => '/uploads/' + f.filename), '上传成功')
    })
  })().catch(next)
})

// ---- 扫码报障提交 ----
router.post('/report', asyncHandler(async (req, res) => {
  const ps = await ensurePublicSettings()
  if (!ps.report_enable) return fail(res, '自助报障入口暂未开放，请联系 IT')
  if (!req.body.k || req.body.k !== ps.key) return fail(res, '报障入口校验失败，请重新扫描二维码')
  if (!rateLimit('report:' + clientIp(req), 12)) return fail(res, '提交过于频繁，请稍后再试')

  const b = req.body
  if (!b.content || String(b.content).trim().length < 4) return fail(res, '请简单描述遇到的问题（至少 4 个字）')
  if (!b.contact) return fail(res, '请填写您的姓名，便于我们联系您')
  const phone = onlyDigits(b.phone)
  if (phone && phone.length < 5) return fail(res, '手机号格式不正确')

  const no = await nextReportNo()
  const priority = ['urgent', 'high', 'normal', 'low'].includes(b.priority) ? b.priority : 'normal'
  // 故障截图（可选）：只接受本系统上传目录下「真实存在」的图片，最多 3 张。
  // 只靠正则能被塞进不存在的路径（前端会裂图），所以再查一次磁盘。
  const attachments = (Array.isArray(b.attachment) ? b.attachment : [])
    .map(u => String(u).trim())
    .filter(u => /^\/uploads\/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|gif|bmp|heic)$/i.test(u))
    .filter(u => {
      try { return fs.existsSync(path.join(uploadDir, path.basename(u))) } catch (e) { return false }
    })
    .slice(0, 3)
  // 员工报障进来的单先落「待接单」：等着运维接单（或服务台派单），不再需要管理员手工指派
  const r = await query(
    `INSERT INTO ticket (user_id, happen_time, contact, dept, service_content, app_system, problem_type,
       status, priority, source, report_no, reporter_phone, attachment)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [0, nowStr(), String(b.contact).slice(0, 50), b.dept || null, String(b.content).slice(0, 2000),
     b.app_system || null, b.problem_type || '其他', 'pending', priority, 'qr', no, phone || null,
     attachments.length ? JSON.stringify(attachments) : null]
  )
  await applySla(r.insertId).catch(() => {})

  // 生成待办 + 实时推送到运维浏览器（未开服务台：全部运维抢单；开了服务台：只推服务台派单）
  const row = await query('SELECT * FROM ticket WHERE ticket_id = ?', [r.insertId])
  if (row.length) await dispatchTicket(row[0]).catch(() => {})

  // 通知 IT（企业内部群）
  broadcast('report', '【新报障】' + (b.app_system || '未填系统'),
    `报障人：${b.contact}${b.dept ? '（' + b.dept + '）' : ''}\n问题：${String(b.content).slice(0, 200)}\n单号：${no}${attachments.length ? `\n故障截图：${attachments.length} 张` : ''}\n时间：${nowStr()}`
  ).catch(() => {})

  ok(res, { report_no: no }, `报障已提交，单号 ${no}，请保留以便查询进度`)
}))

// ---- 进度查询（单号 + 手机号后 4 位）----
router.post('/track', asyncHandler(async (req, res) => {
  if (!rateLimit('track:' + clientIp(req), 60)) return fail(res, '查询过于频繁，请稍后再试')
  const no = String(req.body.report_no || '').trim().toUpperCase()
  const phone = onlyDigits(req.body.phone)
  if (!no) return fail(res, '请填写报障单号')
  const rows = await query(
    `SELECT ticket_id, report_no, service_content, app_system, problem_type, status,
            happen_time, finish_time, handle_desc, satisfy_score, priority, contact
     FROM ticket WHERE report_no = ?`, [no]
  )
  if (!rows.length) return fail(res, '未找到该单号，请核对后再试')
  const t = rows[0]
  // 报障时留了手机号的，必须校验后 4 位（单号规则可枚举，只用单号就能看别人的报障内容）
  {
    const full = await query('SELECT reporter_phone FROM ticket WHERE ticket_id = ?', [t.ticket_id])
    const stored = onlyDigits(full[0] && full[0].reporter_phone)
    if (stored && (!phone || stored.slice(-4) !== phone.slice(-4))) {
      return fail(res, '请填写报障时预留的手机号后 4 位')
    }
  }
  delete t.ticket_id_placeholder
  ok(res, {
    report_no: t.report_no,
    service_content: t.service_content,
    app_system: t.app_system,
    problem_type: t.problem_type,
    status: t.status,
    happen_time: t.happen_time,
    finish_time: t.finish_time,
    // 只给「处理结果」，不暴露内部沟通与处理人名
    result: t.status === 'done' ? (t.handle_desc || '已完成处理') : '',
    satisfy_score: t.satisfy_score,
    can_satisfy: t.status === 'done' && !t.satisfy_score
  })
}))

// ---- 满意度评价（1-5 星）----
router.post('/satisfy', asyncHandler(async (req, res) => {
  if (!rateLimit('satisfy:' + clientIp(req), 30)) return fail(res, '操作过于频繁，请稍后再试')
  const no = String(req.body.report_no || '').trim().toUpperCase()
  const score = Number(req.body.score)
  if (!no) return fail(res, '缺少报障单号')
  if (!(score >= 1 && score <= 5)) return fail(res, '请选择 1-5 星评分')
  const rows = await query('SELECT ticket_id, status, satisfy_score, reporter_phone FROM ticket WHERE report_no = ?', [no])
  if (!rows.length) return fail(res, '未找到该单号')
  const t = rows[0]
  if (t.status !== 'done') return fail(res, '该工单还在处理中，完成后才能评价')
  if (t.satisfy_score) return fail(res, '该工单已评价过，感谢反馈')
  const phone = onlyDigits(req.body.phone)
  const stored = onlyDigits(t.reporter_phone)
  if (stored && (!phone || stored.slice(-4) !== phone.slice(-4))) {
    return fail(res, '请填写报障时预留的手机号后 4 位')
  }

  await query(
    'UPDATE ticket SET satisfy_score = ?, satisfy_comment = ?, satisfy_time = ? WHERE ticket_id = ?',
    [score, String(req.body.comment || '').slice(0, 500) || null, nowStr(), t.ticket_id]
  )
  ok(res, null, '感谢您的评价！')
}))

// ---- 常见问题自助门户（公开知识）----
router.get('/faq', asyncHandler(async (req, res) => {
  const ps = await ensurePublicSettings()
  if (!ps.faq_enable) return ok(res, { enable: false, list: [], total: 0 })
  // 入口密钥校验：与扫码报障共用同一个 key，避免门户被外部随意翻看
  if (req.query.k !== ps.key) return ok(res, { enable: true, need_key: true, list: [], total: 0 })
  const kw = String(req.query.keyword || '').trim()
  const where = ['is_public = 1']
  const params = []
  if (kw) {
    where.push('(problem_summary LIKE ? OR solution LIKE ? OR keyword LIKE ? OR app_system LIKE ? OR problem_type LIKE ?)')
    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`)
  }
  const rows = await query(
    `SELECT kb_id, app_system, problem_type, problem_summary, keyword, faq_hits
     FROM knowledge WHERE ${where.join(' AND ')} ORDER BY faq_hits DESC, kb_id DESC LIMIT 100`,
    params
  )
  ok(res, { enable: true, list: rows, total: rows.length })
}))

router.get('/faq/:id', asyncHandler(async (req, res) => {
  const ps = await ensurePublicSettings()
  if (!ps.faq_enable) return fail(res, '自助门户未开放')
  if (req.query.k !== ps.key) return fail(res, '入口校验失败，请通过内部链接或二维码访问')
  const rows = await query(
    'SELECT kb_id, app_system, problem_type, problem_summary, solution, keyword, attachment FROM knowledge WHERE kb_id = ? AND is_public = 1',
    [req.params.id]
  )
  if (!rows.length) return fail(res, '该问题不存在或未公开')
  await query('UPDATE knowledge SET faq_hits = faq_hits + 1 WHERE kb_id = ?', [req.params.id]).catch(() => {})
  ok(res, { ...rows[0], attachment: safeJson(rows[0].attachment) || [] })
}))

module.exports = router
