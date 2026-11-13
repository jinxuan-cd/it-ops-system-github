/**
 * @file backend/src/routes/sla.js
 * @description 响应/解决时限策略的增删改与历史工单重算
 *
 * SLA 策略路由 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// SLA 时效策略维护
const express = require('express')
const router = express.Router()
const { query } = require('../db')
const { ok, fail, asyncHandler } = require('../utils/helpers')
const { auth, adminOnly } = require('../middleware/auth')
const { backfillSla } = require('../utils/sla')

router.use(auth)

/**
 * SLA 策略列表（响应时限 / 解决时限），按问题类别、策略 ID 排序。
 * 权限：登录即可读，具体谁能改由写接口上的 adminOnly 控制。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res 数值字段转成 Number，避免前端拿到字符串做比较出错
 * @returns {Promise<void>}
 */
router.get('/', asyncHandler(async (req, res) => {
  const rows = await query('SELECT * FROM sla_policy ORDER BY problem_type, policy_id')
  ok(res, rows.map(r => ({
    ...r,
    respond_hours: Number(r.respond_hours),
    resolve_hours: Number(r.resolve_hours)
  })))
}))

/**
 * 把「问题类别 + 优先级」归一成一个比较用的键。
 * NULL 与空串都视为默认类别 `*` / 不限优先级，手工输入带空格也不会漏判。
 *
 * @param {string} problemType
 * @param {string} priority
 * @returns {string}
 */
function normKey(problemType, priority) {
  const t = String(problemType || '*').trim() || '*'
  const p = String(priority || '').trim()
  return `${t}|${p}`
}

/**
 * 判重：同一个「问题类别 + 优先级」只允许存在一条策略。
 *
 * 允许重复会造成「新配的不生效」：pickPolicy 按 policy_id 顺序取第一条命中的，
 * 管理员改的那条若排在后面就完全用不上 —— 页面上明明配了 4 小时，实际仍按旧那条算。
 *
 * @param {string} problemType 待保存的问题类别
 * @param {string|null} priority 待保存的优先级
 * @param {number} [selfId] 编辑时排除自身
 * @returns {Promise<object|null>} 冲突的已有策略行，无冲突返回 null
 */
async function findDuplicate(problemType, priority, selfId) {
  const rows = await query('SELECT policy_id, problem_type, priority FROM sla_policy WHERE policy_id <> ?', [selfId || 0])
  const key = normKey(problemType, priority)
  return rows.find(r => normKey(r.problem_type, r.priority) === key) || null
}

/**
 * 把页面传来的小时数转成合法正数，空值/非法值退回默认值。
 * 不能写成 `Number(v) || 4`：那样把「响应 0 小时（立即响应）」静默改成 4 小时。
 *
 * @param {*} v 原始值
 * @param {number} dft 默认值
 * @returns {number}
 */
function hoursOr(v, dft) {
  if (v === undefined || v === null || v === '') return dft
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : dft
}

/**
 * 文本字段归一：null/undefined 一律当空串。
 * 不能直接 String(v)——前端把 remark: null 原样提交上来会被存成字符串 "null"。
 *
 * @param {*} v
 * @returns {string}
 */
function txt(v) {
  return v === null || v === undefined ? '' : String(v).trim()
}

/**
 * 新增 SLA 策略。权限：仅管理员。
 * 问题类别不填记为 *（通配），响应默认 4 小时、解决默认 24 小时，
 * 策略生效还要点一次 /recalc 才回填到存量工单。
 *
 * @param {import('express').Request} req body: problem_type / priority / respond_hours / resolve_hours / remark
 * @param {import('express').Response} res { policy_id }
 * @returns {Promise<void>}
 */
router.post('/', adminOnly, asyncHandler(async (req, res) => {
  const b = req.body
  const problemType = txt(b.problem_type) || '*'
  const priority = txt(b.priority) || null
  if (await findDuplicate(problemType, priority)) {
    return fail(res, '已存在相同「问题类别 + 优先级」的策略，请直接编辑那一条')
  }
  const r = await query(
    'INSERT INTO sla_policy (problem_type, priority, respond_hours, resolve_hours, remark) VALUES (?,?,?,?,?)',
    [problemType, priority, hoursOr(b.respond_hours, 4), hoursOr(b.resolve_hours, 24), txt(b.remark) || null]
  )
  ok(res, { policy_id: r.insertId }, '已新增策略')
}))

/**
 * 修改 SLA 策略。权限：仅管理员。空字符串存成 NULL，保持「未设置」的一种表示。
 * 注意：改完只影响之后算出的截止时间，存量工单要调 /recalc 重算。
 *
 * 保存前先判重：把类别/优先级改成与另一条相同，会让其中一条永远命中不到。
 *
 * @param {import('express').Request} req req.params.id 为 policy_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.put('/:id', adminOnly, asyncHandler(async (req, res) => {
  const b = req.body
  const cur = await query('SELECT * FROM sla_policy WHERE policy_id = ?', [req.params.id])
  if (!cur.length) return fail(res, '策略不存在')

  // 未传的字段按原值参与判重，避免只改时限却被判成「改成别的类别」
  const effType = b.problem_type !== undefined ? (txt(b.problem_type) || '*') : cur[0].problem_type
  const effPri = b.priority !== undefined ? (txt(b.priority) || null) : cur[0].priority
  // 只有「类别/优先级」真的被改动才判重：
  // 老库里若已存在重复行，只改时限时不该被拦住，否则那两条永远改不动
  const keyChanged = normKey(effType, effPri) !== normKey(cur[0].problem_type, cur[0].priority)
  if (keyChanged && (await findDuplicate(effType, effPri, req.params.id))) {
    return fail(res, '已存在相同「问题类别 + 优先级」的策略，请直接编辑那一条')
  }

  const sets = []
  const vals = []
  if (b.problem_type !== undefined) { sets.push('problem_type = ?'); vals.push(effType) }
  if (b.priority !== undefined) { sets.push('priority = ?'); vals.push(effPri) }
  if (b.remark !== undefined) { sets.push('remark = ?'); vals.push(txt(b.remark) || null) }
  if (b.respond_hours !== undefined) { sets.push('respond_hours = ?'); vals.push(hoursOr(b.respond_hours, Number(cur[0].respond_hours))) }
  if (b.resolve_hours !== undefined) { sets.push('resolve_hours = ?'); vals.push(hoursOr(b.resolve_hours, Number(cur[0].resolve_hours))) }
  if (!sets.length) return fail(res, '无更新字段')
  vals.push(req.params.id)
  const r = await query(`UPDATE sla_policy SET ${sets.join(', ')} WHERE policy_id = ?`, vals)
  if (!r.affectedRows) return fail(res, '策略不存在')
  ok(res, null, '已保存')
}))

/**
 * 删除 SLA 策略。权限：仅管理员。删掉后该类别会落到通配策略（*）上，仍需 /recalc 才生效。
 *
 * @param {import('express').Request} req req.params.id 为 policy_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.delete('/:id', adminOnly, asyncHandler(async (req, res) => {
  const r = await query('DELETE FROM sla_policy WHERE policy_id = ?', [req.params.id])
  if (!r.affectedRows) return fail(res, '策略不存在')
  ok(res, null, '已删除')
}))

// 改完策略后重算全部工单的 SLA 截止时间
/**
 * 按当前策略重算全部工单的 SLA 截止时间。权限：仅管理员。
 * 先整列置 NULL 再回填，是因为截止时间是「策略 + 工单字段」算出来的派生值，
 * 不先清空的话旧策略留下的值会和新策略混在一起，超期统计就会打架。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res { updated }
 * @returns {Promise<void>}
 */
router.post('/recalc', adminOnly, asyncHandler(async (req, res) => {
  await query('UPDATE ticket SET sla_respond_due = NULL, sla_resolve_due = NULL WHERE happen_time IS NOT NULL')
  const n = await backfillSla()
  ok(res, { updated: n }, `已按当前策略重算 ${n} 条工单的时效`)
}))

module.exports = router
