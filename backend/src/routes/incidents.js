/**
 * @file backend/src/routes/incidents.js
 * @description 故障事件登记、详情、统计与维护
 *
 * 故障事件路由 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 故障管理（事件管理）：记录大范围故障（断网、服务器宕机、核心业务中断等）
// 与工单的区别：工单是「一对一的服务请求」，故障是「一对多的业务影响」，需要原因分析和复盘
const express = require('express')
const router = express.Router()
const { query } = require('../db')
const { ok, fail, asyncHandler } = require('../utils/helpers')
const { auth, isViewAll } = require('../middleware/auth')
const { broadcast } = require('../utils/notifier')

router.use(auth)

/**
 * 故障的读范围：默认只看自己登记的事件，管理员/审计员带 all=1 才看全员。
 * alias 用于带 JOIN 的查询，避免 user_id 列名歧义。
 *
 * @param {import('express').Request} req
 * @param {string} alias 表别名，如 'i'
 * @returns {{clause: string, params: number[]}}
 */
function scope(req, alias = '') {
  const pre = alias ? alias + '.' : ''
  if (isViewAll(req.user.role) && req.query.all === '1') return { clause: '', params: [] }
  return { clause: `AND ${pre}user_id = ?`, params: [req.user.user_id] }
}

// 写操作：管理员直接拥有全部权限，不再依赖前端传 all=1（否则会出现「不存在或无权限」）
/**
 * 故障的写范围：管理员/审计员不限，其他人只能改自己登记的记录。不看 all=1。
 *
 * @param {import('express').Request} req
 * @param {string} alias 表别名
 * @returns {{clause: string, params: number[]}}
 */
function writeScope(req, alias = '') {
  const pre = alias ? alias + '.' : ''
  if (isViewAll(req.user.role)) return { clause: '', params: [] }
  return { clause: `AND ${pre}user_id = ?`, params: [req.user.user_id] }
}

function nowStr() {
  const d = new Date(); const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 生成故障编号 F+yyyymmdd+3 位流水，按当天已有最大编号 +1，保证同日连续好排查。
 *
 * @returns {Promise<string>}
 */
async function nextNo() {
  const d = new Date(); const p = n => String(n).padStart(2, '0')
  const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
  const rows = await query('SELECT incident_no FROM incident WHERE incident_no LIKE ? ORDER BY incident_id DESC LIMIT 1', [`F${day}%`])
  const seq = rows.length ? Number(String(rows[0].incident_no).slice(-3)) + 1 : 1
  return `F${day}${String(seq).padStart(3, '0')}`
}

// 列表
/**
 * 故障列表：按发生时间区间、等级、状态、关键词过滤，最多 500 条。
 * 权限：默认只看自己登记的，管理员/审计员带 all=1 看全员。
 * 口径：区间按 start_time（故障发生）过滤，end 补 23:59:59；
 *      响应时长 = accept_time - start_time，处置时长 = finish_time - start_time，
 *      两者都在 JS 里现算并用 Math.max(0,…) 兜住负值（时区错乱时不至于显示「-30 分钟」）。
 *
 * @param {import('express').Request} req query: start / end / level / status / keyword / all
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/', asyncHandler(async (req, res) => {
  const { start, end, level, status, keyword } = req.query
  const sc = scope(req, 'i')
  const where = ['1=1']
  const params = []
  if (sc.clause) { where.push(sc.clause.replace(/^AND/, '')); params.push(...sc.params) }
  if (start) { where.push('i.start_time >= ?'); params.push(start) }
  if (end) { where.push('i.start_time <= ?'); params.push(end + ' 23:59:59') }
  if (level) { where.push('i.level = ?'); params.push(level) }
  if (status) { where.push('i.status = ?'); params.push(status) }
  if (keyword) {
    where.push('(i.title LIKE ? OR i.cause LIKE ? OR i.affected_systems LIKE ? OR i.scope LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }
  const rows = await query(
    `SELECT i.*, u.real_name FROM incident i LEFT JOIN sys_user u ON u.user_id = i.user_id
     WHERE ${where.join(' AND ')} ORDER BY i.start_time DESC, i.incident_id DESC LIMIT 500`,
    params
  )
  // 附加时长：响应时长（接单-发生）、处置时长（恢复-发生）
  ok(res, rows.map(r => ({
    ...r,
    respond_minutes: r.start_time && r.accept_time ? Math.max(0, Math.round((new Date(r.accept_time.replace(' ', 'T')) - new Date(r.start_time.replace(' ', 'T'))) / 60000)) : null,
    duration_minutes: r.start_time && r.finish_time ? Math.max(0, Math.round((new Date(r.finish_time.replace(' ', 'T')) - new Date(r.start_time.replace(' ', 'T'))) / 60000)) : null
  })))
}))

// 统计（看板/分析用）：没有故障数据时返回 count=0，前端据此决定是否展示
/**
 * 故障统计：总量、进行中、P1~P4 分布、平均恢复时长、近 6 个月按月数量。
 * 权限：登录即可，范围受 scope 限制。
 * 口径：均按 start_time 归期；平均时长只算起止都齐全且结束晚于开始的记录；
 *      monthly 固定回看近 6 个自然月，且只在 start_time 落在所选区间内时才有值。
 *
 * @param {import('express').Request} req query: start / end / all
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const { start, end } = req.query
  const sc = scope(req)
  const where = ['1=1']
  const params = []
  if (sc.clause) { where.push(sc.clause.replace(/^AND/, '')); params.push(...sc.params) }
  if (start) { where.push('start_time >= ?'); params.push(start) }
  if (end) { where.push('start_time <= ?'); params.push(end + ' 23:59:59') }
  const w = where.join(' AND ')

  const base = await query(
    `SELECT COUNT(*) AS total,
            SUM(status = 'ongoing') AS ongoing,
            SUM(level = 'P1') AS p1, SUM(level = 'P2') AS p2, SUM(level = 'P3') AS p3, SUM(level = 'P4') AS p4,
            ROUND(AVG(CASE WHEN start_time IS NOT NULL AND finish_time IS NOT NULL AND finish_time >= start_time
                           THEN TIMESTAMPDIFF(MINUTE, start_time, finish_time) END) / 60, 1) AS avg_hours
     FROM incident WHERE ${w}`, params
  )
  const b = base[0] || {}
  const byLevel = await query(
    `SELECT level AS name, COUNT(*) AS value FROM incident WHERE ${w} GROUP BY level ORDER BY level`, params
  )
  const monthly = await query(
    `SELECT DATE_FORMAT(start_time, '%Y-%m') AS month, COUNT(*) AS cnt
     FROM incident WHERE ${w} AND start_time >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
     GROUP BY month ORDER BY month`, params
  )
  ok(res, {
    total: Number(b.total || 0),
    ongoing: Number(b.ongoing || 0),
    p1: Number(b.p1 || 0), p2: Number(b.p2 || 0), p3: Number(b.p3 || 0), p4: Number(b.p4 || 0),
    avg_hours: Number(b.avg_hours || 0),
    byLevel: byLevel.map(x => ({ name: x.name, value: Number(x.value) })),
    monthly: monthly.map(x => ({ month: x.month, count: Number(x.cnt) }))
  })
}))

// 详情
/**
 * 故障详情（含登记人姓名），复盘页用。
 * 权限：自己登记的；管理员/审计员带 all=1 可看全部。
 *
 * @param {import('express').Request} req req.params.id 为 incident_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/:id', asyncHandler(async (req, res) => {
  // 注意：这里 JOIN 了 sys_user，user_id 必须带表别名，否则 where 里列名歧义会 500
  const sc = scope(req, 'i')
  const rows = await query(
    `SELECT i.*, u.real_name FROM incident i LEFT JOIN sys_user u ON u.user_id = i.user_id
     WHERE i.incident_id = ? ${sc.clause}`,
    [req.params.id, ...sc.params]
  )
  if (!rows.length) return fail(res, '故障记录不存在')
  ok(res, rows[0])
}))

// 新增
/**
 * 登记故障：自动生成编号，缺发生时间按当前时间补，标了已恢复就一定有恢复时间。
 * 权限：任意已登录用户，登记人记为本人。
 * 口径：恢复时间早于发生时间的按发生时间纠正，否则平均恢复时长会被算成负数；
 *      P1/P2 才推送企业微信，低级故障推送反而成为噪音。
 *
 * @param {import('express').Request} req body: title / level / scope / affected_systems / start_time / accept_time / finish_time / cause / process / review
 * @param {import('express').Response} res { incident_id, incident_no }
 * @returns {Promise<void>}
 */
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body
  if (!b.title) return fail(res, '请填写故障标题')
  const no = await nextNo()
  const startTime = b.start_time || nowStr()
  let status = b.finish_time ? 'resolved' : (b.status === 'resolved' ? 'resolved' : 'ongoing')
  let finishTime = b.finish_time || null
  // 与编辑接口同一条规则：标了已恢复就必须有恢复时间；恢复时间不能早于发生时间
  if (status === 'resolved' && !finishTime) finishTime = nowStr()
  if (finishTime && String(finishTime) < String(startTime)) finishTime = startTime
  const result = await query(
    `INSERT INTO incident (user_id, incident_no, title, level, scope, affected_systems,
       start_time, accept_time, finish_time, cause, process, review, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [req.user.user_id, no, b.title, b.level || 'P3', b.scope || null, b.affected_systems || null,
     startTime, b.accept_time || null, finishTime,
     b.cause || null, b.process || null, b.review || null, status]
  )
  // 新故障立即推送（P1/P2 才推，避免噪音）
  if (['P1', 'P2'].includes(b.level)) {
    broadcast('incident', `【${b.level} 故障】${b.title}`,
      `影响范围：${b.scope || '待确认'}\n受影响系统：${b.affected_systems || '待确认'}\n发生时间：${b.start_time || nowStr()}`
    ).catch(() => {})
  }
  ok(res, { incident_id: result.insertId, incident_no: no }, '故障已登记')
}))

// 更新
// 时间与状态必须联动，避免脏数据：
//   1) 填了恢复时间 → 自动标记已恢复
//   2) 把恢复时间删掉 → 说明其实还没恢复（点错了），状态必须回退成「未恢复」
//   3) 明确改成未恢复 → 同步清空恢复时间
//   4) 恢复时间早于发生时间 → 按发生时间纠正
/**
 * 编辑故障：先取值做时间/状态纠正，再用纠正后的值重建 SET 列表。
 * 权限：writeScope —— 自己登记的；管理员/审计员可改全部。
 *
 * @param {import('express').Request} req req.params.id 为 incident_id
 * @param {import('express').Response} res { status, finish_time }
 * @returns {Promise<void>}
 */
router.put('/:id', asyncHandler(async (req, res) => {
  const sc = writeScope(req)
  const b = req.body
  const editable = ['title', 'level', 'scope', 'affected_systems', 'start_time', 'accept_time', 'finish_time', 'cause', 'process', 'review', 'status']
  // 只判断「有没有要改的字段」，真正的 SET 在下面用纠正后的值重建
  const touched = editable.filter(f => b[f] !== undefined)
  if (!touched.length) return fail(res, '无更新字段')

  const old = await query(`SELECT start_time, finish_time, status FROM incident WHERE incident_id = ? ${sc.clause}`, [req.params.id, ...sc.params])
  if (!old.length) return fail(res, '故障记录不存在或无权限')
  const cur = old[0]

  const clearFinish = b.finish_time !== undefined && (b.finish_time === '' || b.finish_time === null)
  const startTime = b.start_time !== undefined ? (b.start_time || null) : cur.start_time
  let finishTime = b.finish_time !== undefined ? (b.finish_time || null) : cur.finish_time
  if (finishTime && startTime && String(finishTime) < String(startTime)) finishTime = startTime
  let status = b.status !== undefined ? b.status : cur.status

  if (clearFinish) {
    // 恢复时间被删掉 → 状态回退为未恢复
    status = 'ongoing'
  } else if (finishTime && status === 'ongoing' && b.status === undefined) {
    status = 'resolved'
  } else if (status === 'ongoing' && b.status !== undefined) {
    finishTime = null
  } else if (status === 'resolved' && !finishTime) {
    // 标了已恢复却没给时间 → 用当前时间兜底，否则统计里会出现「已恢复但无恢复时间」
    finishTime = nowStr()
  }

  // 统一用纠正后的值覆盖（finish_time / status 都在 sets 里，需重建一次）
  const kept = []
  const keptVals = []
  editable.forEach(f => {
    if (f === 'finish_time' || f === 'status') return
    if (b[f] !== undefined) { kept.push(`${f} = ?`); keptVals.push(b[f] === '' ? null : b[f]) }
  })
  kept.push('finish_time = ?', 'status = ?')
  keptVals.push(finishTime, status, req.params.id, ...sc.params)
  const r = await query(`UPDATE incident SET ${kept.join(', ')} WHERE incident_id = ? ${sc.clause}`, keptVals)
  if (!r.affectedRows) return fail(res, '故障记录不存在或无权限')
  ok(res, { status, finish_time: finishTime }, '已保存')
}))

// 删除
/**
 * 删除故障记录。权限：writeScope —— 自己登记的；管理员/审计员可删全部。
 *
 * @param {import('express').Request} req req.params.id 为 incident_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const sc = writeScope(req)
  const r = await query(`DELETE FROM incident WHERE incident_id = ? ${sc.clause}`, [req.params.id, ...sc.params])
  if (!r.affectedRows) return fail(res, '故障记录不存在或无权限')
  ok(res, null, '已删除')
}))

module.exports = router
