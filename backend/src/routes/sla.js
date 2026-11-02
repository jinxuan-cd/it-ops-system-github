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
  const r = await query(
    'INSERT INTO sla_policy (problem_type, priority, respond_hours, resolve_hours, remark) VALUES (?,?,?,?,?)',
    [b.problem_type || '*', b.priority || null, Number(b.respond_hours) || 4, Number(b.resolve_hours) || 24, b.remark || null]
  )
  ok(res, { policy_id: r.insertId }, '已新增策略')
}))

/**
 * 修改 SLA 策略。权限：仅管理员。空字符串存成 NULL，保持「未设置」的一种表示。
 * 注意：改完只影响之后算出的截止时间，存量工单要调 /recalc 重算。
 *
 * @param {import('express').Request} req req.params.id 为 policy_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.put('/:id', adminOnly, asyncHandler(async (req, res) => {
  const b = req.body
  const sets = []
  const vals = []
  ;['problem_type', 'priority', 'respond_hours', 'resolve_hours', 'remark'].forEach(f => {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); vals.push(b[f] === '' ? null : b[f]) }
  })
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
