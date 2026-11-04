/**
 * @file backend/src/routes/tickets.js
 * @description 工单录入与检索、抢单/派单/释放、完成、批量操作、Excel 导入导出
 *
 * 工单主流程路由 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
const express = require('express')
const router = express.Router()
const fs = require('fs')
const ExcelJS = require('exceljs')
const { query } = require('../db')
const { ok, fail, asyncHandler, safeJson } = require('../utils/helpers')
const { auth, adminOnly, isViewAll } = require('../middleware/auth')
const { upload } = require('../middleware/upload')
const { applySla, slaStateOf, backfillSla, loadPolicies, pickPolicy } = require('../utils/sla')
const { broadcast } = require('../utils/notifier')
const { dispatchTicket, closeTicketTodos } = require('../utils/dispatch')
const rt = require('../utils/realtime')

// 日期字段：空字符串一律存 NULL，避免 MySQL 严格模式报错
const DATE_FIELDS = ['happen_time', 'finish_time']
function normDate(v) { return v === '' || v == null ? null : v }
// 非法日期串（如 2026/13/01）会让 MySQL 严格模式直接 1292 报错 → 500，
// 统一按「未填写」处理，交给 normalizeTimes 兜底
function safeDate(v) {
  const s = normDate(v)
  if (!s) return null
  const t = String(s).trim()
  return /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(t) ? t : null
}

// 本地时间字符串（后端容器已设 TZ=Asia/Shanghai）
function nowStr() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 时间字段校验与纠正（保证数据有效性，避免出现「完成时间早于发生时间」的脏数据）：
//   1) 完成时间早于发生时间 → 说明录入/导入有误，按发生时间纠正
//   2) 状态已完成但没有完成时间 → 用发生时间补全
//   3) 有完成时间但没给状态 → 视为已完成
/**
 * 时间与状态的互相兜底，录单、编辑、导入、完成四条链路都走这里，保证口径统一。
 *
 * @param {{happen_time?: string|null, finish_time?: string|null, status?: string|null}} o
 * @returns {{happen_time: string|null, finish_time: string|null, status: string|null}}
 */
function normalizeTimes(o) {
  const h = o.happen_time || null
  let f = o.finish_time || null
  let st = o.status || null
  if (h && f && String(f) < String(h)) f = h
  // 标记完成但没填完成时间 → 用当前时间兜底（不能用发生时间，否则时长永远是 0）
  if (st === 'done' && !f) f = nowStr()
  // 有完成时间但没给状态 → 视为已完成
  if (f && !st) st = 'done'
  return { happen_time: h, finish_time: f, status: st }
}

// 数据隔离：
//   admin / 审计员：可以看全公司（列表需带 all=1）
//   服务台（service）：负责派单，可以看全部工单
//   普通运维：自己录的单 + 指派给自己的单
// 写操作（指派/接单/删除/编辑）：管理员与服务台不受 all=1 限制，避免「工单不存在或无权限」
function canSeeAll(req) {
  return isViewAll(req.user.role) || req.user.role === 'service'
}

/**
 * 生成带 t. 前缀的数据隔离条件，供带 JOIN 的查询使用。
 * 返回 { clause: '', params: [] } 表示不限制（管理员带 all=1 或服务台）。
 *
 * @param {import('express').Request} req
 * @returns {{clause: string, params: number[]}}
 */
function scope(req) {
  if (canSeeAll(req) && (req.user.role === 'service' || req.query.all === '1')) return { clause: '', params: [] }
  return { clause: 'AND (t.user_id = ? OR t.assignee_id = ?)', params: [req.user.user_id, req.user.user_id] }
}

// 不带表别名前缀（用于未取别名的 UPDATE / DELETE / SELECT）
/**
 * 同 scope()，但不带别名前缀，用于单表 UPDATE / DELETE。
 * 与 scope() 的差别：这里不看 all=1，写操作只要角色够就放行，避免「工单不存在或无权限」。
 *
 * @param {import('express').Request} req
 * @returns {{clause: string, params: number[]}}
 */
function scopePlain(req) {
  if (canSeeAll(req)) return { clause: '', params: [] }
  return { clause: 'AND (user_id = ? OR assignee_id = ?)', params: [req.user.user_id, req.user.user_id] }
}

router.use(auth)

// 附件上传（多文件）
/**
 * 接收工单附件并返回相对路径数组，前端把数组 JSON 化后写进 ticket.attachment。
 * 权限：任意已登录用户（录单、处理、补传凭证共用这一个入口）。
 *
 * @param {import('express').Request} req multer 数组字段名为 files
 * @param {import('express').Response} res
 * @returns {void}
 */
router.post('/upload', upload.array('files', 10), (req, res) => {
  const urls = (req.files || []).map(f => `/uploads/${f.filename}`)
  ok(res, urls)
})

// 列表（多条件筛选）
/**
 * 工单列表：支持关键词、状态、类别、部门、优先级、时间范围、SLA 超期、待接单池等过滤。
 * 权限：登录即可访问，可见范围由 scope() 决定；管理员/审计员需带 all=1 才看全员，
 *      服务台天然看全部；pool=1 不受归属限制（公海单所有人都要能看见才能抢）。
 * 分页：传 page_size 才分页（上限 200），否则返回全量数组，兼容待办面板与报表的老调用。
 * 时间口径：按 happen_time（发生时间）过滤，end 补 23:59:59，避免当天下午的单被漏掉。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/', asyncHandler(async (req, res) => {
  const { start, end, dept, app_system, problem_type, status, keyword, all, user_id,
    priority, assignee_id, source, sla, mine } = req.query
  // 服务端分页：传 page_size 才分页（保持旧调用仍返回数组）
  const pageSize = Math.min(Math.max(Number(req.query.page_size) || 0, 0), 200)
  const page = Math.max(Number(req.query.page) || 1, 1)
  // 待接单池：不限归属，所有运维都能看到没人接的单
  const pool = req.query.pool === '1'
  const sc = pool ? { clause: '', params: [] } : scope(req)
  const where = ['1=1']
  const params = []

  if (pool) where.push("t.status = 'pending' AND t.assignee_id IS NULL")

  // 管理员/审计员 all=1 时 clause 为空，不能拼进 WHERE（否则 SQL 语法错误）
  if (sc.clause) {
    where.push(sc.clause.replace(/^AND/, ''))
    params.push(...sc.params)
  }
  // 按处理人筛选（管理员/审计员看板下钻用；普通用户受 scope 限制，只能是自己）
  if (user_id) { where.push('t.user_id = ?'); params.push(Number(user_id)) }
  // 只看指派给我的
  if (mine === '1') { where.push('t.assignee_id = ?'); params.push(req.user.user_id) }
  if (assignee_id) { where.push('t.assignee_id = ?'); params.push(Number(assignee_id)) }
  if (priority) { where.push('t.priority = ?'); params.push(priority) }
  if (source) { where.push('t.source = ?'); params.push(source) }
  if (start) { where.push('t.happen_time >= ?'); params.push(start) }
  if (end) { where.push('t.happen_time <= ?'); params.push(end + ' 23:59:59') }
  if (dept) { where.push('t.dept = ?'); params.push(dept) }
  if (app_system) { where.push('t.app_system = ?'); params.push(app_system) }
  if (problem_type) { where.push('t.problem_type = ?'); params.push(problem_type) }
  if (status) { where.push('t.status = ?'); params.push(status) }
  if (sla === 'overdue') {
    where.push("(t.status <> 'done' AND t.sla_resolve_due IS NOT NULL AND t.sla_resolve_due < NOW())")
  }
  if (keyword) {
    where.push('(t.service_content LIKE ? OR t.handle_desc LIKE ? OR t.contact LIKE ? OR t.report_no LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const base = `FROM ticket t
     LEFT JOIN sys_user u ON u.user_id = t.user_id
     LEFT JOIN sys_user a ON a.user_id = t.assignee_id
     WHERE ${where.join(' AND ')}`

  // 不分页：老调用（待办面板、报表统计）仍拿全量数组
  if (!pageSize) {
    const rows = await query(
      `SELECT t.*, u.real_name, a.real_name AS assignee_name ${base}
       ORDER BY t.happen_time DESC, t.ticket_id DESC`,
      params
    )
    rows.forEach(r => {
      r.attachment = safeJson(r.attachment) || []
      Object.assign(r, slaStateOf(r))
    })
    return ok(res, rows)
  }

  // 分页：先算总数，再只取当前页，避免一次性把上千条打到前端
  const cnt = await query(`SELECT COUNT(*) AS total ${base}`, params)
  const total = Number((cnt[0] || {}).total || 0)
  const offset = (page - 1) * pageSize
  const rows = await query(
    `SELECT t.*, u.real_name, a.real_name AS assignee_name ${base}
     ORDER BY t.happen_time DESC, t.ticket_id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )
  rows.forEach(r => {
    r.attachment = safeJson(r.attachment) || []
    Object.assign(r, slaStateOf(r))
  })
  ok(res, { list: rows, total, page, page_size: pageSize })
}))

// 可指派的工程师列表（任何登录用户都可读，用于工单指派下拉）
/**
 * 可指派工程师名单：只返回启用账号，并排除审计员（只读角色，派给他也处理不了）。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/staff', asyncHandler(async (req, res) => {
  const rows = await query(
    "SELECT user_id, username, real_name, role FROM sys_user WHERE is_enable = 1 AND role <> 'auditor' ORDER BY role, user_id"
  )
  ok(res, rows)
}))

// 待接单池（右下角接单弹窗 / 工单页「待接单」筛选共用）
/**
 * 公海工单池：所有未指派且状态为待接单的工单，按 紧急→高→普通→低、再按发生时间正序（先来先办）。
 * 只取 50 条：这是给弹窗用的实时提醒列表，不是台账全量。
 * 权限：任意已登录用户，不受工单归属隔离限制。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/pool', asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT t.*, u.real_name FROM ticket t LEFT JOIN sys_user u ON u.user_id = t.user_id
     WHERE t.status = 'pending' AND t.assignee_id IS NULL
     ORDER BY FIELD(t.priority,'urgent','high','normal','low'), t.happen_time ASC, t.ticket_id ASC
     LIMIT 50`
  )
  rows.forEach(r => {
    r.attachment = safeJson(r.attachment) || []
    Object.assign(r, slaStateOf(r))
  })
  ok(res, rows)
}))

// 详情（待接单的工单所有运维都能看，否则点待办会提示无权限）
/**
 * 工单详情：带上报人与处理人姓名，并按 SLA 截止时间算出当前超期状态。
 * 权限：管理员/审计员/服务台可看全部；其他人只能看「自己报的 + 派给自己的 + 还未接单的公海单」，
 *      审计员只读，因此不给它开公海单的例外。
 *
 * @param {import('express').Request} req req.params.id 为工单号
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT t.*, u.real_name, a.real_name AS assignee_name FROM ticket t
     LEFT JOIN sys_user u ON u.user_id = t.user_id
     LEFT JOIN sys_user a ON a.user_id = t.assignee_id
     WHERE t.ticket_id = ?`, [req.params.id]
  )
  if (!rows.length) return fail(res, '工单不存在')
  const t = rows[0]
  const uid = Number(req.user.user_id)
  const allowed = canSeeAll(req) ||
    Number(t.user_id) === uid || Number(t.assignee_id) === uid ||
    (t.status === 'pending' && req.user.role !== 'auditor')
  if (!allowed) return fail(res, '工单不存在或无权限')
  t.attachment = safeJson(t.attachment) || []
  Object.assign(t, slaStateOf(t))
  // 附上命中的策略原文：用户看到「已超时」时能立刻知道是按哪条时限算的
  // （例如紧急类单独配了 2h 响应，光看应响应时间点看不出是策略差异引起的）
  try {
    const pol = pickPolicy(await loadPolicies(), t.problem_type, t.priority)
    t.sla_policy = {
      problem_type: pol.problem_type || '*',
      priority: pol.priority || '',
      respond_hours: Number(pol.respond_hours),
      resolve_hours: Number(pol.resolve_hours)
    }
  } catch { /* 策略表读取失败不影响详情展示 */ }
  ok(res, t)
}))

// 创建
/**
 * 新建工单：录单人自动成为 user_id，可顺手指派给自己（assign_me）或直接投公海（pool）。
 * 权限：任意已登录用户。
 * 口径提醒：user_id 是「报障人/录单人」而不是「处理人」，扫码报障走 publicApi 时 user_id 会是 0，
 *          所以统计归属一律用 COALESCE(assignee_id, NULLIF(user_id,0))，别直接拿 user_id 分组。
 *
 * @param {import('express').Request} req body 可含 happen_time/finish_time/status/priority/attachment/pool/assign_me
 * @param {import('express').Response} res 返回 { ticket_id, notified }
 * @returns {Promise<void>}
 */
router.post('/', asyncHandler(async (req, res) => {
  const b = { ...req.body }
  // 先做时间有效性纠正，再落库
  const fixed = normalizeTimes({
    happen_time: safeDate(b.happen_time),
    finish_time: safeDate(b.finish_time),
    status: b.status
  })
  if (b.happen_time !== undefined) b.happen_time = fixed.happen_time
  // 注意：只传 {status:'done'} 时也要把兜底出来的完成时间写进去，
  // 否则会造出「已完成但没有完成时间」的脏数据（时长统计与完成率会失真）
  if (b.finish_time !== undefined || fixed.finish_time) b.finish_time = fixed.finish_time
  if (fixed.status) b.status = fixed.status
  if (!b.status) b.status = 'processing'

  // 投入「待接单池」：由所有运维抢单，不指定负责人，状态记为待接单
  const toPool = req.body.pool === true && !b.assignee_id && !req.body.assign_me
  if (toPool) {
    b.status = 'pending'
    b.finish_time = null
  }

  const fields = ['happen_time', 'contact', 'dept', 'service_content', 'app_system', 'problem_type', 'finish_time', 'handle_desc', 'status', 'sync_kb', 'priority', 'assignee_id']
  const cols = ['user_id'], vals = [req.user.user_id]
  fields.forEach(f => {
    if (b[f] !== undefined) { cols.push(f); vals.push(DATE_FIELDS.includes(f) ? normDate(b[f]) : b[f]) }
  })
  // 录单时直接指派给自己（方便「我录的我负责」）
  // 注意：assignee_id 可能已由上面 fields 写入，重复 push 会触发 "Column 'assignee_id' specified twice"
  if (req.body.assign_me) {
    if (b.assignee_id === undefined) { cols.push('assignee_id'); vals.push(req.user.user_id) }
    cols.push('assign_time', 'respond_time')
    vals.push(nowStr(), nowStr())
  }
  if (b.attachment) { cols.push('attachment'); vals.push(JSON.stringify(b.attachment)) }

  const sql = `INSERT INTO ticket (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  const result = await query(sql, vals)
  // 计算 SLA 截止时间
  await applySla(result.insertId).catch(() => {})

  // 待接单池：立刻生成待办并实时推送到所有运维（右下角弹出接单提示）
  let notified = 0
  if (toPool) {
    const row = await query('SELECT * FROM ticket WHERE ticket_id = ?', [result.insertId])
    if (row.length) {
      const r = await dispatchTicket(row[0]).catch(() => ({ notified: 0 }))
      notified = r.notified || 0
    }
  }
  ok(res, { ticket_id: result.insertId, notified }, toPool ? '已投入待接单池，已通知运维接单' : '创建成功')
}))

// 更新
/**
 * 编辑工单：只更新 body 里出现的字段，其余保持原值。
 * 权限：自己报的或派给自己的单；管理员/审计员/服务台可改全部。
 * 时间联动：改成处理中/待接单会清空完成时间，清空完成时间会把状态回退到处理中，
 *          改了发生时间/问题类别/优先级会重算 SLA 截止时间。
 *
 * @param {import('express').Request} req req.params.id 为工单号
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.put('/:id', asyncHandler(async (req, res) => {
  const sc = scopePlain(req)
  const b = { ...req.body }

  // 明确要求改回「处理中 / 待接单」→ 同步清空完成时间，避免出现「处理中却有完成时间」的矛盾数据
  if (req.body.status === 'processing' || req.body.status === 'pending') b.finish_time = null

  // 把「完成时间」删掉 = 其实还没做完（点错了恢复），状态要跟着回退，不能还挂着已完成
  const clearFinish = req.body.finish_time !== undefined && normDate(req.body.finish_time) === null
  if (clearFinish && req.body.status === undefined) b.status = 'processing'

  // 只在同时涉及时间/状态时纠正；先取原值，避免单改一个字段被误判
  if (b.happen_time !== undefined || b.finish_time !== undefined || b.status !== undefined) {
    const old = await query(`SELECT happen_time, finish_time, status FROM ticket WHERE ticket_id = ? ${sc.clause}`, [req.params.id, ...sc.params])
    if (!old.length) return fail(res, '工单不存在或无权限')
    const fixed = normalizeTimes({
      happen_time: b.happen_time !== undefined ? safeDate(b.happen_time) : safeDate(old[0].happen_time),
      finish_time: b.finish_time !== undefined ? safeDate(b.finish_time) : safeDate(old[0].finish_time),
      status: b.status !== undefined ? b.status : old[0].status
    })
    b.happen_time = fixed.happen_time
    b.finish_time = fixed.finish_time
    if (fixed.status) b.status = fixed.status
  }

  const sets = []
  const vals = []
  const editable = ['happen_time', 'contact', 'dept', 'service_content', 'app_system', 'problem_type', 'finish_time', 'handle_desc', 'status', 'sync_kb', 'priority']
  editable.forEach(f => {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); vals.push(DATE_FIELDS.includes(f) ? normDate(b[f]) : b[f]) }
  })
  if (b.attachment !== undefined) { sets.push('attachment = ?'); vals.push(JSON.stringify(b.attachment)) }
  if (!sets.length) return fail(res, '无更新字段')

  vals.push(req.params.id, ...sc.params)
  const result = await query(`UPDATE ticket SET ${sets.join(', ')} WHERE ticket_id = ? ${sc.clause}`, vals)
  if (result.affectedRows === 0) return fail(res, '工单不存在或无权限')
  // 发生时间 / 问题类别 / 优先级变了，SLA 截止时间要跟着重算
  if (b.happen_time !== undefined || b.problem_type !== undefined || b.priority !== undefined) {
    await applySla(req.params.id).catch(() => {})
  }
  ok(res, null, '更新成功')
}))

// 指派 / 转派 / 派单：把工单交给指定工程师
//   服务台派单：待接单 → 处理中
//   运维转单：处理中 → 换负责人（原负责人看不到，由新负责人继续）
/**
 * 指派/转派/服务台派单：把工单挂到指定工程师名下，首次指派同时写 respond_time。
 * 权限：管理员/审计员/服务台可派任何单；普通运维只能转自己名下的单。
 * 副作用：关掉其他运维的接单提醒待办、广播工单变更、给被指派人单独推一条提醒。
 *
 * @param {import('express').Request} req body.assignee_id 目标工程师 ID
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.post('/:id/assign', asyncHandler(async (req, res) => {
  const sc = scopePlain(req)
  const rows = await query(`SELECT * FROM ticket WHERE ticket_id = ? ${sc.clause}`, [req.params.id, ...sc.params])
  if (!rows.length) return fail(res, '工单不存在或无权限')
  const t = rows[0]
  const assigneeId = Number(req.body.assignee_id)
  if (!assigneeId) return fail(res, '请选择要指派的工程师')
  const u = await query('SELECT user_id, real_name, username FROM sys_user WHERE user_id = ? AND is_enable = 1', [assigneeId])
  if (!u.length) return fail(res, '该用户不存在或已停用')

  const t2 = nowStr()
  // 首次指派即视为「已响应」，用于 SLA 响应达成率；待接单状态同时推进为处理中
  const respondTime = t.respond_time || t2
  await query(
    `UPDATE ticket SET assignee_id = ?, assign_time = ?, respond_time = ?,
       status = CASE WHEN status = 'pending' THEN 'processing' ELSE status END
     WHERE ticket_id = ?`,
    [assigneeId, t2, respondTime, req.params.id]
  )
  // 已派出去的单，别人的接单提醒一起关掉
  await closeTicketTodos(req.params.id).catch(() => {})

  const assignee = u[0]
  const isTransfer = !!t.assignee_id && Number(t.assignee_id) !== assigneeId
  const tip = isTransfer ? '转单' : '派单'
  broadcast('overdue', `【工单${tip}】` + (t.service_content || '').slice(0, 40),
    `指派给：${assignee.real_name || assignee.username}\n问题：${(t.service_content || '').slice(0, 120)}\n报障人：${t.contact || '—'}\n时间：${t2}`
  ).catch(() => {})

  // 实时同步：接单池里的其他人立即把这张单移除；被指派人收到提醒
  const payload = {
    ticket_id: Number(req.params.id),
    service_content: t.service_content || '',
    assignee_id: assigneeId,
    assignee_name: assignee.real_name || assignee.username,
    operator: req.user.username,
    transfer: isTransfer
  }
  rt.broadcast('ticket:taken', payload)
  rt.send([assigneeId], 'ticket:mine', payload)

  ok(res, { assignee_id: assigneeId, assignee_name: assignee.real_name }, `已${tip}给 ${assignee.real_name || assignee.username}`)
}))

// 接取工单（抢单）：数据库原子更新，只有第一个人能接走，后面的人会收到「已被接取」
/**
 * 抢单：把公海里的待接单工单挂到自己名下，并把状态推进到处理中。
 * 权限：除审计员（只读）外的已登录用户；重复接自己的单按成功处理，避免误报。
 * 并发：靠 WHERE assignee_id IS NULL AND status='pending' 做乐观锁，affectedRows=0 即被抢先。
 *
 * @param {import('express').Request} req req.params.id 为工单号
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.post('/:id/claim', asyncHandler(async (req, res) => {
  if (req.user.role === 'auditor') return fail(res, '审计员为只读账号，不能接单', 1, 403)
  const rows = await query('SELECT * FROM ticket WHERE ticket_id = ?', [req.params.id])
  if (!rows.length) return fail(res, '工单不存在')
  const t = rows[0]

  if (Number(t.assignee_id) === Number(req.user.user_id)) {
    return ok(res, { ticket_id: Number(t.ticket_id), mine: true }, '这张工单已经是你的了')
  }
  if (t.assignee_id) return fail(res, '该工单已被他人接取，请刷新列表')
  if (t.status !== 'pending') return fail(res, '该工单已被接取或已完成，请刷新列表')

  const t2 = nowStr()
  const r = await query(
    `UPDATE ticket SET assignee_id = ?, assign_time = ?, respond_time = COALESCE(respond_time, ?), status = 'processing'
     WHERE ticket_id = ? AND assignee_id IS NULL AND status = 'pending'`,
    [req.user.user_id, t2, t2, req.params.id]
  )
  // affectedRows=0 说明在这一瞬间被别人抢先了
  if (!r.affectedRows) return fail(res, '手慢了，这张工单刚被别人接取')

  await closeTicketTodos(req.params.id).catch(() => {})

  const me = await query('SELECT real_name, username FROM sys_user WHERE user_id = ?', [req.user.user_id])
  const myName = (me[0] && (me[0].real_name || me[0].username)) || req.user.username
  const payload = {
    ticket_id: Number(req.params.id),
    service_content: t.service_content || '',
    assignee_id: Number(req.user.user_id),
    assignee_name: myName
  }
  rt.broadcast('ticket:taken', payload)
  ok(res, { ticket_id: Number(req.params.id), assignee_name: myName }, `接单成功，这张工单由你负责`)
}))

// 退回待接单池：接错了 / 忙不过来又没人可转时，把单放回池子重新分配
/**
 * 退回公海：清掉负责人与指派时间，状态回到待接单，并重新给全员发接单提醒。
 * 权限：自己名下的单；管理员/审计员/服务台可退全部。已完成的单不允许退回。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res 返回重新通知到的人数
 * @returns {Promise<void>}
 */
router.post('/:id/release', asyncHandler(async (req, res) => {
  const sc = scopePlain(req)
  const rows = await query(`SELECT * FROM ticket WHERE ticket_id = ? ${sc.clause}`, [req.params.id, ...sc.params])
  if (!rows.length) return fail(res, '工单不存在或无权限')
  if (rows[0].status === 'done') return fail(res, '已完成的工单不能退回')

  await query(
    `UPDATE ticket SET assignee_id = NULL, assign_time = NULL, status = 'pending' WHERE ticket_id = ?`,
    [req.params.id]
  )
  await closeTicketTodos(req.params.id).catch(() => {})
  const r = await dispatchTicket(rows[0]).catch(() => ({ notified: 0 }))
  rt.broadcast('ticket:released', { ticket_id: Number(req.params.id) })
  ok(res, { notified: r.notified || 0 }, '已退回待接单池，并重新通知运维')
}))

// 标记完成 + 同步知识库
/**
 * 完成工单：写完成时间与处理说明，按需把处理方案同步进知识库。
 * 权限：自己名下的单；管理员/审计员/服务台可完成全部。
 * 口径：finish_time 是「完成量」的唯一依据，缺它会让时长统计、完成率、月度环比全部失真，
 *      因此这里一定会兜出一个完成时间；respond_time 若为空也顺手补上，保证响应达成率可算。
 *
 * @param {import('express').Request} req body 可含 finish_time/handle_desc/sync_kb/solution
 * @param {import('express').Response} res 返回 { ticket_id, kb_id }
 * @returns {Promise<void>}
 */
router.post('/:id/complete', asyncHandler(async (req, res) => {
  const sc = scopePlain(req)
  const { finish_time, handle_desc, sync_kb, app_system, problem_type, service_content, solution } = req.body
  const ticketId = req.params.id

  const rows = await query(`SELECT * FROM ticket WHERE ticket_id = ? ${sc.clause}`, [ticketId, ...sc.params])
  if (!rows.length) return fail(res, '工单不存在或无权限')
  const ticket = rows[0]

  // 与编辑接口同一条规则：完成时间不能早于发生时间、非法日期按当前时间兜底
  const nf = normalizeTimes({ happen_time: ticket.happen_time, finish_time: safeDate(finish_time), status: 'done' })
  const finishAt = nf.finish_time || nowStr()

  await query(
    `UPDATE ticket SET status = 'done', finish_time = ?, handle_desc = ?,
       respond_time = COALESCE(respond_time, ?) WHERE ticket_id = ?`,
    [finishAt, handle_desc ?? ticket.handle_desc, ticket.respond_time || nowStr(), ticketId]
  )
  // 完成后关掉相关待办提醒，并实时同步给其他运维
  await closeTicketTodos(ticketId).catch(() => {})
  rt.broadcast('ticket:done', { ticket_id: Number(ticketId) })

  let kbId = null
  const doSync = sync_kb === true || ticket.sync_kb === 1
  if (doSync) {
    const summary = service_content || ticket.service_content || ''
    const sol = solution || handle_desc || ticket.handle_desc || ''
    const ins = await query(
      `INSERT INTO knowledge (user_id, app_system, problem_type, problem_summary, solution, keyword, source_ticket_id)
       VALUES (?,?,?,?,?,?,?)`,
      [ticket.user_id, app_system || ticket.app_system, problem_type || ticket.problem_type, summary, sol, summary, ticketId]
    )
    kbId = ins.insertId
    await query('UPDATE ticket SET sync_kb = 1 WHERE ticket_id = ?', [ticketId])
  }

  ok(res, { ticket_id: Number(ticketId), kb_id: kbId }, '已标记完成' + (kbId ? '，并同步知识库' : ''))
}))

// ============ 批量操作 ============
// 解析 id 列表（支持数组或逗号串），单次上限 1000 条，防止误操作和长事务
/**
 * 把 ids 归一成去重后的正整数数组，单次最多 1000 条，防止一次误传全表拖死数据库。
 *
 * @param {number[]|string} v 数组或以逗号分隔的字符串
 * @returns {number[]}
 */
function idList(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(',')
  return [...new Set(arr.map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 1000)
}
function placeholders(n) { return Array(n).fill('?').join(',') }

// 批量删除（普通用户仅能删自己的，管理员/审计员看全部时受 all=1 控制）
/**
 * 批量删除工单，并连带清掉这些工单产生的接单提醒待办（否则待办里留死链点不开）。
 * 权限：受 scopePlain 限制，普通用户只能删自己报的或派给自己的。
 *
 * @param {import('express').Request} req body.ids 支持数组或逗号串
 * @param {import('express').Response} res 返回 deleted 实际删除条数
 * @returns {Promise<void>}
 */
router.post('/batch-delete', asyncHandler(async (req, res) => {
  const ids = idList(req.body.ids)
  if (!ids.length) return fail(res, '请先选择工单')
  const sc = scopePlain(req)
  const result = await query(
    `DELETE FROM ticket WHERE ticket_id IN (${placeholders(ids.length)}) ${sc.clause}`,
    [...ids, ...sc.params]
  )
  // 顺带清掉这些工单的接单提醒待办，避免待办里留下点不开的死链
  await query(`DELETE FROM todo WHERE ticket_id IN (${placeholders(ids.length)})`, ids).catch(() => {})
  ok(res, { deleted: result.affectedRows }, `已删除 ${result.affectedRows} 条工单`)
}))

// 批量标记完成
/**
 * 批量完成：完成时间取「发生时间与当前时间的较晚者」，保证不出现完成早于发生的脏数据。
 * 权限：受 scopePlain 限制。
 *
 * @param {import('express').Request} req body.ids
 * @param {import('express').Response} res 返回 updated 条数
 * @returns {Promise<void>}
 */
router.post('/batch-complete', asyncHandler(async (req, res) => {
  const ids = idList(req.body.ids)
  if (!ids.length) return fail(res, '请先选择工单')
  const sc = scopePlain(req)
  const t = nowStr()
  // 完成时间取「发生时间与当前时间的较晚者」，保证不出现完成早于发生的脏数据
  const result = await query(
    `UPDATE ticket
     SET status = 'done',
         finish_time = CASE
           WHEN happen_time IS NULL THEN ?
           WHEN happen_time > ? THEN happen_time
           ELSE ?
         END
     WHERE ticket_id IN (${placeholders(ids.length)}) ${sc.clause}`,
    [t, t, t, ...ids, ...sc.params]
  )
  ok(res, { updated: result.affectedRows }, `已标记完成 ${result.affectedRows} 条工单`)
}))

// 批量改状态（处理中 / 已完成）
/**
 * 批量改状态：done 时补完成时间，processing 时清空完成时间，保持「状态与完成时间一致」。
 * 权限：受 scopePlain 限制。
 *
 * @param {import('express').Request} req body.ids、body.status（非 done 一律按处理中）
 * @param {import('express').Response} res 返回 updated 条数
 * @returns {Promise<void>}
 */
router.post('/batch-status', asyncHandler(async (req, res) => {
  const ids = idList(req.body.ids)
  const status = req.body.status === 'done' ? 'done' : 'processing'
  if (!ids.length) return fail(res, '请先选择工单')
  const sc = scopePlain(req)
  const t = nowStr()
  const sql = status === 'done'
    ? `UPDATE ticket SET status='done', finish_time = CASE WHEN happen_time IS NULL THEN ? WHEN happen_time > ? THEN happen_time ELSE ? END
       WHERE ticket_id IN (${placeholders(ids.length)}) ${sc.clause}`
    : `UPDATE ticket SET status='processing', finish_time = NULL WHERE ticket_id IN (${placeholders(ids.length)}) ${sc.clause}`
  const params = status === 'done'
    ? [t, t, t, ...ids, ...sc.params]
    : [...ids, ...sc.params]
  const result = await query(sql, params)
  ok(res, { updated: result.affectedRows }, `已更新 ${result.affectedRows} 条工单`)
}))

// 删除
/**
 * 删除单条工单，并清掉它的接单提醒待办。
 * 权限：自己报的或派给自己的单；管理员/审计员/服务台可删全部。
 *
 * @param {import('express').Request} req req.params.id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const sc = scopePlain(req)
  const result = await query(`DELETE FROM ticket WHERE ticket_id = ? ${sc.clause}`, [req.params.id, ...sc.params])
  if (result.affectedRows === 0) return fail(res, '工单不存在或无权限')
  // 顺带清掉这条工单的接单提醒待办
  await query('DELETE FROM todo WHERE ticket_id = ?', [req.params.id]).catch(() => {})
  ok(res, null, '删除成功')
}))

// Excel 导出（与原表格式对齐；传 ids 时只导出选中行）
// 数据范围与筛选条件必须与列表页完全一致：否则会出现「列表 3 条、导出上千条」
/**
 * 导出工单 Excel：列与原纸质台账对齐，传 ids 时只导出勾选行。
 * 权限：与列表接口同一套 scope 规则，导不出自己看不到的单。
 * 口径：筛选同样按 happen_time，end 补 23:59:59；状态列中 pending 显示「待接单」。
 *
 * @param {import('express').Request} req 支持与列表一致的查询参数 + ids
 * @param {import('express').Response} res 直接写出 xlsx 流
 * @returns {Promise<void>}
 */
router.get('/export/excel', asyncHandler(async (req, res) => {
  const { start, end, dept, app_system, problem_type, status, keyword, priority, mine } = req.query
  const pool = req.query.pool === '1'
  // scope() 带 t. 前缀，配合下面的 JOIN 使用（原来用 scopePlain 会因 user_id 歧义直接 500）
  const sc = pool ? { clause: '', params: [] } : scope(req)
  const where = ['1=1']
  const params = []
  if (pool) where.push("t.status = 'pending' AND t.assignee_id IS NULL")
  if (sc.clause) {
    where.push(sc.clause.replace(/^AND/, ''))
    params.push(...sc.params)
  }
  if (mine === '1') { where.push('t.assignee_id = ?'); params.push(req.user.user_id) }
  const ids = idList(req.query.ids)
  if (ids.length) {
    where.push(`t.ticket_id IN (${placeholders(ids.length)})`)
    params.push(...ids)
  }
  if (priority) { where.push('t.priority = ?'); params.push(priority) }
  if (start) { where.push('t.happen_time >= ?'); params.push(start) }
  if (end) { where.push('t.happen_time <= ?'); params.push(end + ' 23:59:59') }
  if (dept) { where.push('t.dept = ?'); params.push(dept) }
  if (app_system) { where.push('t.app_system = ?'); params.push(app_system) }
  if (problem_type) { where.push('t.problem_type = ?'); params.push(problem_type) }
  if (status) { where.push('t.status = ?'); params.push(status) }
  if (keyword) {
    where.push('(t.service_content LIKE ? OR t.handle_desc LIKE ? OR t.contact LIKE ? OR t.report_no LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const rows = await query(
    `SELECT t.*, u.real_name FROM ticket t LEFT JOIN sys_user u ON u.user_id = t.user_id
     WHERE ${where.join(' AND ')} ORDER BY t.happen_time DESC`,
    params
  )

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('运维工单')
  ws.columns = [
    { header: '时间', key: 'happen_time', width: 20 },
    { header: '联系人', key: 'contact', width: 12 },
    { header: '部门', key: 'dept', width: 14 },
    { header: '运维服务内容', key: 'service_content', width: 40 },
    { header: '应用系统', key: 'app_system', width: 16 },
    { header: '问题类别', key: 'problem_type', width: 14 },
    { header: '完成时间', key: 'finish_time', width: 20 },
    { header: '处理说明', key: 'handle_desc', width: 50 },
    { header: '状态', key: 'status_text', width: 10 },
    { header: '处理人', key: 'real_name', width: 12 }
  ]
  rows.forEach(r => {
    ws.addRow({
      happen_time: r.happen_time || '',
      contact: r.contact || '',
      dept: r.dept || '',
      service_content: r.service_content || '',
      app_system: r.app_system || '',
      problem_type: r.problem_type || '',
      finish_time: r.finish_time || '',
      handle_desc: r.handle_desc || '',
      status_text: r.status === 'done' ? '已完成' : (r.status === 'pending' ? '待接单' : '处理中'),
      real_name: r.real_name || ''
    })
  })
  // 表头加粗 + 冻结首行，便于翻阅
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="it_tickets.xlsx"')
  await wb.xlsx.write(res)
  res.end()
}))

// Excel 导入历史工单（兼容表头：具体时间/时间、联系人、部门、运维服务内容、应用系统、问题类别、服务完成时间/完成时间、处理说明）
const IMPORT_HEADER_MAP = {
  '具体时间': 'happen_time', '时间': 'happen_time', '发生时间': 'happen_time',
  '联系人': 'contact',
  '部门': 'dept',
  '运维服务内容': 'service_content', '服务内容': 'service_content',
  '应用系统': 'app_system',
  '问题类别': 'problem_type',
  '服务完成时间': 'finish_time', '完成时间': 'finish_time',
  '处理说明': 'handle_desc'
}
// 单元格转字符串（跳过富文本/公式对象取 text/result）
function cellText(v) {
  if (v == null || v === '') return ''
  if (typeof v === 'object') {
    if (v.text !== undefined) return String(v.text).trim()
    if (v.result !== undefined) return String(v.result).trim()
    return ''
  }
  return String(v).trim()
}
// Excel 日期转 'YYYY-MM-DD HH:mm:ss'（ExcelJS 的 Date 以 UTC 承载墙钟时间）
/**
 * 统一成 MySQL 可接受的日期串，顺带把「2026年10月29日」这类中文写法纠正过来。
 *
 * @param {Date|string|number|null} v 单元格原始值
 * @returns {string|null} 无法识别时返回 null，交给上层按未填写处理
 */
function toDateTimeStr(v) {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v)) {
    const p = n => String(n).padStart(2, '0')
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())} ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}:${p(v.getUTCSeconds())}`
  }
  let s = String(v).trim().replace(/[年月]/g, '-').replace(/日/g, ' ').replace(/\//g, '-').replace(/时/g, ' ').replace(/\s+/g, ' ')
  return s || null
}

/**
 * 从 Excel 批量导入历史工单：按表头名认列，容忍中文日期写法，逐行校验后回写结果。
 * 权限：任意已登录用户，导入的工单 user_id 记为当前用户。
 * 口径：有完成时间即视为已完成，完成早于发生的按发生时间纠正并计入 corrected 供前端提示；
 *      导入结束后统一 backfillSla() 补算 SLA，避免历史数据没有截止时间而统计不出超期。
 *
 * @param {import('express').Request} req multipart 单文件字段名为 file，仅支持 .xlsx
 * @param {import('express').Response} res 返回 { inserted, failed[], corrected[] }
 * @returns {Promise<void>}
 */
router.post('/import/excel', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return fail(res, '请选择要导入的 xlsx 文件')
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(fs.readFileSync(req.file.path))
  } catch (e) {
    fs.unlink(req.file.path, () => {})
    return fail(res, '文件解析失败，请确认是 .xlsx 格式（旧 .xls 请先另存为 .xlsx）')
  }
  fs.unlink(req.file.path, () => {})
  const ws = wb.worksheets[0]
  if (!ws || ws.rowCount < 2) return fail(res, 'Excel 中没有可导入的数据行')

  // 解析表头列 -> 字段映射
  const colMap = {}
  ws.getRow(1).eachCell((cell, col) => {
    const key = cellText(cell.value).replace(/\s+/g, '')
    if (IMPORT_HEADER_MAP[key]) colMap[col] = IMPORT_HEADER_MAP[key]
  })
  if (!Object.keys(colMap).length) {
    return fail(res, '未识别到表头，请使用原表格列：具体时间 / 联系人 / 部门 / 运维服务内容 / 应用系统 / 问题类别 / 服务完成时间 / 处理说明')
  }

  const inserted = []
  const failed = []
  const corrected = []
  const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const rec = {}
    for (const [col, field] of Object.entries(colMap)) {
      const raw = row.getCell(Number(col)).value
      rec[field] = (field === 'happen_time' || field === 'finish_time') ? toDateTimeStr(raw) : cellText(raw)
    }
    if (!rec.happen_time && !rec.service_content) continue // 跳过空行
    if (!rec.happen_time) { failed.push({ row: r, reason: '缺少「具体时间」' }); continue }
    if (!DATE_RE.test(rec.happen_time)) { failed.push({ row: r, reason: `「具体时间」格式无法识别：${rec.happen_time}` }); continue }
    if (rec.finish_time && !DATE_RE.test(rec.finish_time)) {
      failed.push({ row: r, reason: `「完成时间」格式无法识别：${rec.finish_time}` })
      continue
    }
    // 时间有效性纠正：完成早于发生的按发生时间处理，并记录下来提示用户
    const fixed = normalizeTimes({
      happen_time: rec.happen_time,
      finish_time: rec.finish_time,
      status: rec.finish_time ? 'done' : 'processing'
    })
    if (rec.finish_time && fixed.finish_time !== rec.finish_time) {
      corrected.push({ row: r, from: rec.finish_time, to: fixed.finish_time })
    }
    try {
      await query(
        `INSERT INTO ticket (user_id, happen_time, contact, dept, service_content, app_system, problem_type, finish_time, handle_desc, status)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [req.user.user_id, fixed.happen_time, rec.contact, rec.dept, rec.service_content,
         rec.app_system, rec.problem_type, fixed.finish_time, rec.handle_desc,
         fixed.status]
      )
      inserted.push(r)
    } catch (e) {
      failed.push({ row: r, reason: e.message })
    }
  }
  // 导入的工单统一补算 SLA 截止时间
  await backfillSla().catch(() => {})
  ok(res, { inserted: inserted.length, failed, corrected },
    `导入完成：成功 ${inserted.length} 条` +
    (corrected.length ? `，其中 ${corrected.length} 条「完成时间早于发生时间」已按发生时间纠正` : '') +
    (failed.length ? `，失败 ${failed.length} 条` : ''))
}))

module.exports = router
