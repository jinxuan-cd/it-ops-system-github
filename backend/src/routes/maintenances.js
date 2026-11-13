/**
 * @file backend/src/routes/maintenances.js
 * @description 服务器维护台账：计划 → 实施 → 结果三段式记录，支持现场照片上传留档
 *
 * 服务器维护台账路由 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-11-04
 */
// 服务器维护台账：每次维护从「计划」到「实施」到「结果」一条记录管到底，
// 照片随单留档，日后排查同类问题时可直接调取当时的现场情况
const express = require('express')
const router = express.Router()
const { query } = require('../db')
const { ok, fail, asyncHandler } = require('../utils/helpers')
const { auth, isViewAll } = require('../middleware/auth')
const { upload } = require('../middleware/upload')

router.use(auth)

// 维护类型与状态枚举：前后端共用同一组取值，改这里必须同步前端下拉
const TYPES = ['例行巡检', '系统升级', '补丁修复', '硬件更换', '故障处理', '备份恢复']
const STATES = ['成功', '部分成功', '失败']

/**
 * 台账的读范围：默认只看自己登记的，管理员/审计员带 all=1 才看全员。
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

/**
 * 写范围：管理员/审计员不限，其他人只能改自己的记录。与读范围解耦，
 * 避免出现「列表能看到别人的记录、点编辑却提示无权限」。
 *
 * @param {import('express').Request} req
 * @returns {{clause: string, params: number[]}}
 */
function writeScope(req) {
  if (isViewAll(req.user.role)) return { clause: '', params: [] }
  return { clause: 'AND user_id = ?', params: [req.user.user_id] }
}

/**
 * 照片地址归一：只接受本站上传目录下的地址，防止写入外链；
 * 最多 9 张，与上传接口 upload.array('files', 9) 的上限一致。
 *
 * @param {*} v 前端提交的照片数组
 * @returns {string[]} 归一后的地址数组
 */
function cleanPhotos(v) {
  if (!Array.isArray(v)) return []
  return v.filter(u => typeof u === 'string' && u.startsWith('/uploads/')).slice(0, 9)
}

/**
 * 维护状态自动推导：没有实施内容按 planned，有实施但没结果按 processing，
 * 有结果按 done。前端只传三个段落内容，状态由后端统一算，避免两边口径不一致。
 *
 * @param {object} d 归一后的字段
 * @returns {string} planned / processing / done
 */
function statusOf(d) {
  if (d.result_state) return 'done'
  if (d.exec_content) return 'processing'
  return 'planned'
}

/**
 * 台账列表（服务端分页）：关键词、类型、状态、结果、日期区间过滤。
 * 权限：默认只看自己登记的，管理员/审计员带 all=1 看全员。
 * 分页参数 page 从 1 起，pageSize 默认 10、上限 100，防止一次性拖全表。
 *
 * @param {import('express').Request} req query: page / pageSize / keyword / maint_type / maint_status / result_state / start / end / all
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/', asyncHandler(async (req, res) => {
  const { keyword, maint_type, maint_status, result_state, start, end } = req.query
  const sc = scope(req, 'm')
  const where = ['1=1']
  const params = []
  if (sc.clause) { where.push(sc.clause.replace(/^AND/, '')); params.push(...sc.params) }
  if (maint_type) { where.push('m.maint_type = ?'); params.push(maint_type) }
  if (maint_status) { where.push('m.maint_status = ?'); params.push(maint_status) }
  if (result_state) { where.push('m.result_state = ?'); params.push(result_state) }
  if (start) { where.push('m.plan_date >= ?'); params.push(start) }
  if (end) { where.push('m.plan_date <= ?'); params.push(end) }
  if (keyword) {
    where.push('(m.server_name LIKE ? OR m.plan_content LIKE ? OR m.exec_content LIKE ? OR m.result_content LIKE ? OR m.remark LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }
  const cond = where.join(' AND ')

  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10))

  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM server_maintenance m WHERE ${cond}`, params)
  const rows = await query(
    `SELECT m.*, u.real_name FROM server_maintenance m LEFT JOIN sys_user u ON u.user_id = m.user_id
     WHERE ${cond} ORDER BY COALESCE(m.plan_date, m.create_time) DESC, m.maint_id DESC
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params
  )
  // photos 存的是 JSON 字符串，列表直接解析好，前端不用再逐行 JSON.parse
  rows.forEach(r => {
    try { r.photos = r.photos ? JSON.parse(r.photos) : [] } catch { r.photos = [] }
  })
  ok(res, { rows, total, page, pageSize })
}))

/**
 * 维护类型枚举：前端新增/筛选下拉直接取，避免两边各写一份导致漂移。
 */
router.get('/meta', (req, res) => ok(res, { types: TYPES, states: STATES }))

/**
 * 现场照片上传：multipart 字段名 files，单次最多 9 张。
 * 权限：任意已登录用户（照片是公共上传目录，地址在保存时统一校验）。
 */
router.post('/upload', upload.array('files', 9), (req, res) => {
  const urls = (req.files || []).map(f => `/uploads/${f.filename}`)
  ok(res, urls)
})

/**
 * 新增台账记录。计划内容与服务器名必填；实施/结果可后续编辑补录，
 * 维护状态由后端按「有没有实施、有没有结果」自动推导。
 *
 * @param {import('express').Request} req body: server_name / maint_type / plan_content / exec_content / result_content / result_state / plan_date / exec_date / photos / remark
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.post('/', asyncHandler(async (req, res) => {
  const d = {
    server_name: String(req.body.server_name || '').trim().slice(0, 120),
    maint_type: TYPES.includes(req.body.maint_type) ? req.body.maint_type : '例行巡检',
    plan_content: String(req.body.plan_content || '').slice(0, 3000),
    exec_content: String(req.body.exec_content || '').slice(0, 5000),
    result_content: String(req.body.result_content || '').slice(0, 5000),
    result_state: STATES.includes(req.body.result_state) ? req.body.result_state : '',
    plan_date: req.body.plan_date || null,
    exec_date: req.body.exec_date || null,
    photos: JSON.stringify(cleanPhotos(req.body.photos)),
    remark: String(req.body.remark || '').slice(0, 300)
  }
  if (!d.server_name) return fail(res, '服务器名称必填')
  if (!d.plan_content) return fail(res, '维护计划必填')
  const status = statusOf(d)
  const result = await query(
    `INSERT INTO server_maintenance
     (user_id, server_name, maint_type, plan_content, exec_content, result_content, result_state, maint_status, plan_date, exec_date, photos, remark)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [req.user.user_id, d.server_name, d.maint_type, d.plan_content, d.exec_content, d.result_content,
     d.result_state, status, d.plan_date, d.exec_date, d.photos, d.remark]
  )
  ok(res, { maint_id: result.insertId, maint_status: status }, '创建成功')
}))

/**
 * 编辑台账记录（补录实施过程、维护结果、上传照片等）。
 * 权限：只能改自己的记录，管理员/审计员不限。
 *
 * @param {import('express').Request} req req.params.id 为 maint_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.put('/:id', asyncHandler(async (req, res) => {
  const rows = await query('SELECT * FROM server_maintenance WHERE maint_id = ?', [req.params.id])
  if (!rows.length) return fail(res, '记录不存在')
  const old = rows[0]
  const ws = writeScope(req)
  if (ws.clause && old.user_id !== req.user.user_id) return fail(res, '无权限修改该记录')

  const d = {
    server_name: req.body.server_name !== undefined ? String(req.body.server_name).trim().slice(0, 120) : old.server_name,
    maint_type: req.body.maint_type !== undefined ? (TYPES.includes(req.body.maint_type) ? req.body.maint_type : old.maint_type) : old.maint_type,
    plan_content: req.body.plan_content !== undefined ? String(req.body.plan_content || '').slice(0, 3000) : old.plan_content,
    exec_content: req.body.exec_content !== undefined ? String(req.body.exec_content || '').slice(0, 5000) : old.exec_content,
    result_content: req.body.result_content !== undefined ? String(req.body.result_content || '').slice(0, 5000) : old.result_content,
    result_state: req.body.result_state !== undefined ? (STATES.includes(req.body.result_state) ? req.body.result_state : '') : old.result_state,
    plan_date: req.body.plan_date !== undefined ? (req.body.plan_date || null) : old.plan_date,
    exec_date: req.body.exec_date !== undefined ? (req.body.exec_date || null) : old.exec_date,
    photos: req.body.photos !== undefined ? JSON.stringify(cleanPhotos(req.body.photos)) : old.photos,
    remark: req.body.remark !== undefined ? String(req.body.remark || '').slice(0, 300) : old.remark
  }
  if (!d.server_name) return fail(res, '服务器名称必填')
  const status = statusOf(d)
  await query(
    `UPDATE server_maintenance SET
     server_name=?, maint_type=?, plan_content=?, exec_content=?, result_content=?, result_state=?, maint_status=?, plan_date=?, exec_date=?, photos=?, remark=?
     WHERE maint_id = ?`,
    [d.server_name, d.maint_type, d.plan_content, d.exec_content, d.result_content, d.result_state,
     status, d.plan_date, d.exec_date, d.photos, d.remark, req.params.id]
  )
  ok(res, { maint_status: status }, '更新成功')
}))

/**
 * 删除台账记录（含照片地址，仅删记录本身；上传目录的文件保留，避免其它记录引用同图被误删）。
 * 权限：只能删自己的记录，管理员/审计员不限。
 *
 * @param {import('express').Request} req req.params.id 为 maint_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const ws = writeScope(req)
  const sql = ws.clause
    ? `DELETE FROM server_maintenance WHERE maint_id = ? ${ws.clause}`
    : 'DELETE FROM server_maintenance WHERE maint_id = ?'
  const params = [req.params.id, ...ws.params]
  const result = await query(sql, params)
  if (result.affectedRows === 0) return fail(res, '记录不存在或无权限')
  ok(res, null, '删除成功')
}))

module.exports = router
