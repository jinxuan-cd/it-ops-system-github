/**
 * @file backend/src/routes/inspections.js
 * @description 巡检模板与周期配置、执行上报、记录查询、异常转工单
 *
 * 巡检路由 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 机房 / 设备巡检：每日打卡式巡检记录，异常项可一键转工单
const express = require('express')
const router = express.Router()
const { query } = require('../db')
const { ok, fail, asyncHandler, safeJson, todayStr } = require('../utils/helpers')
const { auth, isViewAll, adminOnly } = require('../middleware/auth')
const { applySla } = require('../utils/sla')
const { upload } = require('../middleware/upload')
const { settingGet, settingSet } = require('../utils/seed')

router.use(auth)

// 默认巡检项（设置页未配置时使用）
const DEFAULT_ITEMS = [
  { name: '机房温湿度（拍照记录读数）', need_photo: true, done: false, note: '' },
  { name: 'UPS / 电源指示正常', need_photo: false, done: false, note: '' },
  { name: '服务器运行状态正常（无异响/告警灯）', need_photo: false, done: false, note: '' },
  { name: '网络设备（交换机/路由/防火墙）指示灯正常', need_photo: false, done: false, note: '' },
  { name: '监控与告警平台无未处理告警', need_photo: false, done: false, note: '' },
  { name: '消防设施与门禁正常', need_photo: false, done: false, note: '' }
]

// 默认巡检区域
const DEFAULT_AREAS = ['主机房', '三楼弱电间', '二楼配电间']

// 设置项读写：同时兼容前端传数组和后台存的 JSON 字符串
/**
 * 读设置项并解析成数组：空值、非法 JSON、空数组一律回落默认值，
 * 保证设置页还没配过时巡检也能正常开始。
 *
 * @param {string} key 设置键名
 * @param {Array} fallback 默认值
 * @returns {Promise<Array>}
 */
async function readCfg(key, fallback) {
  try {
    const v = await settingGet(key)
    if (!v) return fallback
    const arr = JSON.parse(v)
    return Array.isArray(arr) && arr.length ? arr : fallback
  } catch { return fallback }
}
async function getAreas() { return readCfg('inspection_areas', DEFAULT_AREAS) }

/**
 * 取巡检项模板并统一成 { name, need_photo }：老数据可能只存了字符串，这里兼容两种形态。
 *
 * @returns {Promise<Array<{name: string, need_photo: boolean}>>}
 */
async function getItems() {
  const items = await readCfg('inspection_items', DEFAULT_ITEMS.map(x => ({ name: x.name, need_photo: !!x.need_photo })))
  return items.map(x => ({ name: typeof x === 'string' ? x : x.name, need_photo: !!(x && x.need_photo) }))
}

// 图片只接受本站上传目录下的地址，防止写入外链
function cleanPhotos(v) {
  if (!Array.isArray(v)) return []
  return v.filter(u => typeof u === 'string' && u.startsWith('/uploads/')).slice(0, 4)
}

/**
 * 巡检项入库前归一：截断超长文本、只保留本站图片、丢掉没有名称的空项。
 * 一条巡检记录的 items 是 JSON，结构不一致会让前端渲染和「异常项」统计全错。
 *
 * @param {Array} items 前端提交的巡检项
 * @returns {Array<object>}
 */
function normalizeItems(items) {
  return (Array.isArray(items) ? items : []).map(x => ({
    name: String(x.name || '').slice(0, 120),
    done: !!x.done,
    note: String(x.note || '').slice(0, 500),
    need_photo: !!x.need_photo,
    photos: cleanPhotos(x.photos)
  })).filter(x => x.name)
}

/**
 * 巡检记录的读范围：默认只看自己做的巡检，管理员/审计员带 all=1 看全员。
 *
 * @param {import('express').Request} req
 * @param {string} alias 表别名
 * @returns {{clause: string, params: number[]}}
 */
function scope(req, alias = '') {
  const pre = alias ? alias + '.' : ''
  if (isViewAll(req.user.role) && req.query.all === '1') return { clause: '', params: [] }
  return { clause: `AND ${pre}user_id = ?`, params: [req.user.user_id] }
}

// 写操作（编辑 / 删除 / 转工单）不受 all=1 限制，否则管理员能看到别人的记录却改不了
/**
 * 巡检记录的写范围：管理员/审计员不限，其他人只能改自己的。不看 all=1。
 *
 * @param {import('express').Request} req
 * @returns {{clause: string, params: number[]}}
 */
function writeScope(req) {
  if (isViewAll(req.user.role)) return { clause: '', params: [] }
  return { clause: 'AND user_id = ?', params: [req.user.user_id] }
}

// 巡检项模板（前端开始巡检时带出）
/**
 * 巡检项模板：开始巡检时带出当前配置的检查项，前端据此渲染勾选清单。
 * 权限：任意已登录用户（只读配置，不改配置）。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/template', asyncHandler(async (req, res) => ok(res, await getItems())))

// 巡检配置：区域 + 巡检项（设置页维护）
/**
 * 读取巡检配置，并把「能否编辑」一并告诉前端（只有 admin 显示保存按钮）。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res { areas, items, can_edit }
 * @returns {Promise<void>}
 */
router.get('/config', asyncHandler(async (req, res) => {
  ok(res, { areas: await getAreas(), items: await getItems(), can_edit: req.user.role === 'admin' })
}))

/**
 * 保存巡检配置。权限：仅管理员（adminOnly）。
 * 区域与巡检项都可单独保存：只传其中一个就只改那一个；去重后不允许为空，
 * 否则「开始巡检」会拿到空清单，页面上什么都勾不了。
 *
 * @param {import('express').Request} req body: areas[] / items[]
 * @param {import('express').Response} res 保存后的完整配置
 * @returns {Promise<void>}
 */
router.put('/config', adminOnly, asyncHandler(async (req, res) => {
  const { areas, items } = req.body
  if (Array.isArray(areas)) {
    const clean = [...new Set(areas.map(a => String(a || '').trim()).filter(Boolean))].slice(0, 40)
    if (!clean.length) return fail(res, '至少保留一个巡检区域')
    await settingSet('inspection_areas', JSON.stringify(clean))
  }
  if (Array.isArray(items)) {
    const clean = items
      .map(x => ({ name: String((x && x.name) || '').trim().slice(0, 120), need_photo: !!(x && x.need_photo) }))
      .filter(x => x.name).slice(0, 80)
    if (!clean.length) return fail(res, '至少保留一个巡检项')
    await settingSet('inspection_items', JSON.stringify(clean))
  }
  ok(res, { areas: await getAreas(), items: await getItems() }, '已保存巡检设置')
}))

// 巡检拍照上传（手机端调用系统相机，桌面端选文件）
/**
 * 巡检现场照片上传：一次最多 9 张，返回路径数组用于回填巡检项 photos。
 * 权限：任意已登录用户。
 *
 * @param {import('express').Request} req multipart 数组字段名 files
 * @param {import('express').Response} res
 * @returns {void}
 */
router.post('/upload', upload.array('files', 9), (req, res) => {
  const urls = (req.files || []).map(f => `/uploads/${f.filename}`)
  ok(res, urls)
})

// 列表
/**
 * 巡检记录列表：按日期区间、结果、关键词过滤，最多 300 条。
 * 权限：默认只看自己的，管理员/审计员带 all=1 看全员。
 * 口径：区间按 insp_date（巡检日期，日期型字段）过滤，所以 end 不需要补时分秒；
 *      异常项由 items 里的 done=false 现算，不单独存字段，避免两处真相不一致。
 *
 * @param {import('express').Request} req query: start / end / result / keyword / all
 * @param {import('express').Response} res 每条附带 item_total / item_done / abnormal_names
 * @returns {Promise<void>}
 */
router.get('/', asyncHandler(async (req, res) => {
  const { start, end, result, keyword } = req.query
  const sc = scope(req, 'i')
  const where = ['1=1']
  const params = []
  if (sc.clause) { where.push(sc.clause.replace(/^AND/, '')); params.push(...sc.params) }
  if (start) { where.push('i.insp_date >= ?'); params.push(start) }
  if (end) { where.push('i.insp_date <= ?'); params.push(end) }
  if (result) { where.push('i.result = ?'); params.push(result) }
  if (keyword) { where.push('(i.area LIKE ? OR i.remark LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`) }
  const rows = await query(
    `SELECT i.*, u.real_name FROM inspection i LEFT JOIN sys_user u ON u.user_id = i.user_id
     WHERE ${where.join(' AND ')} ORDER BY i.insp_date DESC, i.inspection_id DESC LIMIT 300`,
    params
  )
  ok(res, rows.map(r => {
    const items = safeJson(r.items) || []
    return {
      ...r,
      items,
      item_total: items.length,
      item_done: items.filter(x => x.done).length,
      abnormal_names: items.filter(x => !x.done).map(x => x.name)
    }
  }))
}))

// 今日是否已巡检（首页提醒用）
/**
 * 今日打卡状态：只要有一条今天的记录就算已完成，首页据此决定是否弹巡检提醒。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res { done }
 * @returns {Promise<void>}
 */
router.get('/today', asyncHandler(async (req, res) => {
  const rows = await query(
    'SELECT inspection_id FROM inspection WHERE user_id = ? AND insp_date = CURDATE() LIMIT 1',
    [req.user.user_id]
  )
  ok(res, { done: rows.length > 0 })
}))

// 新增
/**
 * 提交一条巡检记录：没传 items 就按当前模板生成（全未勾选的原始态）。
 * 权限：任意已登录用户，记录归属本人。
 * 口径：只要有一项 done=false 就整体判为 abnormal —— 巡检结果看的是「有没有问题」，
 *      不能因为提交时选了 normal 就把异常项洗成正常；缺照片只提示不拦截（现场可能确实拍不了）。
 *
 * @param {import('express').Request} req body: insp_date / area / items[] / result / remark
 * @param {import('express').Response} res { inspection_id, result, missing_photo[] }
 * @returns {Promise<void>}
 */
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body
  const items = Array.isArray(b.items) && b.items.length ? normalizeItems(b.items) : normalizeItems(await getItems())
  const abnormal = items.filter(x => !x.done).length
  // 需要拍照的项（如温湿度）未传图 → 提示补拍，但不阻断（现场可能确实拍不了）
  const missingPhoto = items.filter(x => x.need_photo && !x.photos.length).map(x => x.name)
  const result = b.result === 'abnormal' || abnormal > 0 ? 'abnormal' : 'normal'
  const r = await query(
    `INSERT INTO inspection (user_id, insp_date, area, items, result, remark, ticket_id)
     VALUES (?,?,?,?,?,?,?)`,
    [req.user.user_id, b.insp_date || todayStr(), b.area || (await getAreas())[0], JSON.stringify(items), result, b.remark || null, b.ticket_id || null]
  )
  const msg = result === 'abnormal'
    ? '已记录，存在异常项，建议转工单跟进'
    : (missingPhoto.length ? `巡检已记录，但「${missingPhoto.join('、')}」还没拍照留底` : '巡检已记录，一切正常')
  ok(res, { inspection_id: r.insertId, result, missing_photo: missingPhoto }, msg)
}))

// 更新
/**
 * 编辑巡检记录：只改传入的字段。
 * 权限：writeScope —— 自己做的巡检；管理员/审计员可改全部。
 * 联动：改了 items 却没显式给 result 时，按「是否存在未完成项」重算结果，避免结果与明细矛盾。
 *
 * @param {import('express').Request} req req.params.id 为 inspection_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.put('/:id', asyncHandler(async (req, res) => {
  const sc = writeScope(req)
  const b = req.body
  const sets = []
  const vals = []
  if (b.insp_date !== undefined) { sets.push('insp_date = ?'); vals.push(b.insp_date) }
  if (b.area !== undefined) { sets.push('area = ?'); vals.push(b.area) }
  if (b.items !== undefined) { sets.push('items = ?'); vals.push(JSON.stringify(normalizeItems(b.items))) }
  if (b.remark !== undefined) { sets.push('remark = ?'); vals.push(b.remark) }
  if (b.ticket_id !== undefined) { sets.push('ticket_id = ?'); vals.push(b.ticket_id) }
  if (b.result !== undefined) { sets.push('result = ?'); vals.push(b.result) }
  else if (Array.isArray(b.items)) { sets.push('result = ?'); vals.push(b.items.some(x => !x.done) ? 'abnormal' : 'normal') }
  if (!sets.length) return fail(res, '无更新字段')
  vals.push(req.params.id, ...sc.params)
  const r = await query(`UPDATE inspection SET ${sets.join(', ')} WHERE inspection_id = ? ${sc.clause}`, vals)
  if (!r.affectedRows) return fail(res, '巡检记录不存在或无权限')
  ok(res, null, '已保存')
}))

// 删除
/**
 * 删除巡检记录。权限：writeScope —— 自己做的；管理员/审计员可删全部。
 *
 * @param {import('express').Request} req req.params.id 为 inspection_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const sc = writeScope(req)
  const r = await query(`DELETE FROM inspection WHERE inspection_id = ? ${sc.clause}`, [req.params.id, ...sc.params])
  if (!r.affectedRows) return fail(res, '巡检记录不存在或无权限')
  ok(res, null, '已删除')
}))

// 异常转工单：把异常巡检项汇总成一条工单
/**
 * 异常转工单：把该次巡检里所有未完成项汇总成一张高优先级工单，并回写 ticket_id 关联。
 * 权限：writeScope —— 自己做的巡检；管理员/审计员可转全部。
 * 幂等：已有 ticket_id 直接拒绝，防止同一次巡检点两次生成两张单；
 * 工单发生时间取巡检当天 09:00、状态直接置处理中，因为异常已确认，不需要再进公海。
 *
 * @param {import('express').Request} req req.params.id 为 inspection_id
 * @param {import('express').Response} res { ticket_id }
 * @returns {Promise<void>}
 */
router.post('/:id/to-ticket', asyncHandler(async (req, res) => {
  const sc = writeScope(req)
  const rows = await query(`SELECT * FROM inspection WHERE inspection_id = ? ${sc.clause}`, [req.params.id, ...sc.params])
  if (!rows.length) return fail(res, '巡检记录不存在或无权限')
  const rec = rows[0]
  if (rec.ticket_id) return fail(res, '该巡检已生成过工单')
  const items = safeJson(rec.items) || []
  const bad = items.filter(x => !x.done).map(x => `- ${x.name}${x.note ? '：' + x.note : ''}`).join('\n') || '- 巡检异常'
  const ins = await query(
    `INSERT INTO ticket (user_id, happen_time, dept, service_content, app_system, problem_type, status, priority)
     VALUES (?,?,?,?,?,?,?,?)`,
    [req.user.user_id, `${rec.insp_date} 09:00:00`, '信息部',
     `【巡检异常】${rec.area || '机房'} ${rec.insp_date}\n${bad}`, '机房设备', '硬件问题', 'processing', 'high']
  )
  await query('UPDATE inspection SET ticket_id = ? WHERE inspection_id = ?', [ins.insertId, rec.inspection_id])
  await applySla(ins.insertId).catch(() => {})
  ok(res, { ticket_id: ins.insertId }, '已生成工单')
}))

module.exports = router
