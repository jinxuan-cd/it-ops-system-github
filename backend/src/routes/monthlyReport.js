/**
 * @file backend/src/routes/monthlyReport.js
 * @description 按月生成月报、历史查询、团队月报查阅
 *
 * 月报路由 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
const express = require('express')
const router = express.Router()
const { query } = require('../db')
const { ok, fail, asyncHandler } = require('../utils/helpers')
const { auth, canViewAll } = require('../middleware/auth')
const ai = require('../utils/ai')
const { toPlain } = require('../utils/text')

router.use(auth)

// ---------------- 统计聚合 ----------------
/**
 * 收集某员工某月的全部事实材料：工单量、类别/系统分布、目标完成、在办项目、当月日报摘录。
 * 口径：工单按 happen_time 归月（当月受理），完成数与平均时长也只在这批工单里取，
 *      所以「上月报、本月完成」的单不计入本月月报 —— 月报看的是「本月受理的活干成什么样」。
 * 项目只要「在办」或「本月结束 / 本月更新过」就带上，避免月报漏掉跨月项目。
 *
 * @param {number} userId 员工 ID
 * @param {string} month 形如 2026-10
 * @returns {Promise<{ticket: object, byType: object[], bySystem: object[], goal: object, projects: object[], dailyReports: object[]}>}
 */
async function buildStats(userId, month) {
  const ticket = await query(
    `SELECT COUNT(*) AS total,
            SUM(status='done') AS done_cnt,
            ROUND(AVG(CASE WHEN status='done' AND finish_time IS NOT NULL AND happen_time IS NOT NULL
                      AND finish_time > happen_time
                      THEN TIMESTAMPDIFF(MINUTE, COALESCE(respond_time, happen_time), finish_time) END)/60, 1) AS avg_hours
     FROM ticket WHERE user_id = ? AND DATE_FORMAT(happen_time,'%Y-%m') = ?`,
    [userId, month]
  )
  const byType = await query(
    `SELECT problem_type AS name, COUNT(*) AS value FROM ticket
     WHERE user_id = ? AND DATE_FORMAT(happen_time,'%Y-%m') = ? AND problem_type IS NOT NULL
     GROUP BY problem_type ORDER BY value DESC LIMIT 10`,
    [userId, month]
  )
  const bySystem = await query(
    `SELECT app_system AS name, COUNT(*) AS value FROM ticket
     WHERE user_id = ? AND DATE_FORMAT(happen_time,'%Y-%m') = ? AND app_system IS NOT NULL
     GROUP BY app_system ORDER BY value DESC LIMIT 10`,
    [userId, month]
  )
  const goal = await query(
    `SELECT COUNT(*) AS total, SUM(is_finish=1) AS done FROM month_goal
     WHERE user_id = ? AND goal_month = ?`,
    [userId, month]
  )
  const projects = await query(
    `SELECT project_name, project_desc, progress, status, start_date, end_date FROM project
     WHERE user_id = ? AND (status = 'active' OR DATE_FORMAT(end_date,'%Y-%m') = ? OR DATE_FORMAT(update_time,'%Y-%m') = ?)
     ORDER BY status='active' DESC, end_date IS NULL, end_date ASC`,
    [userId, month, month]
  )
  const dailyReports = await query(
    `SELECT report_date, today_work, need_help FROM daily_report
     WHERE user_id = ? AND DATE_FORMAT(report_date,'%Y-%m') = ? ORDER BY report_date ASC`,
    [userId, month]
  )
  return {
    ticket: ticket[0] || {},
    byType,
    bySystem,
    goal: goal[0] || {},
    projects,
    dailyReports
  }
}

// 无 AI 时的规则兜底文本
/**
 * 规则版月报：固定四段（概览/项目/目标/问题），AI 不可用时保证月报功能照常可用。
 * 数据全部来自 buildStats，不额外查库，保证两种生成方式口径一致。
 *
 * @param {string} month
 * @param {object} s buildStats 的返回值
 * @returns {string} 纯文本
 */
function buildFallbackText(month, s) {
  const t = s.ticket || {}
  const g = s.goal || {}
  const lines = []
  lines.push(`一、本月工作概览`)
  lines.push(`本月共处理运维工单 ${t.total || 0} 单，其中已完成 ${t.done_cnt || 0} 单，平均处理时长约 ${t.avg_hours || 0} 小时。`)
  if ((s.byType || []).length) {
    const top3 = s.byType.slice(0, 3).map(x => `${x.name}（${x.value} 单）`).join('、')
    lines.push(`问题主要集中在：${top3}。`)
  }
  lines.push('')
  lines.push(`二、重点项目进展`)
  if (s.projects.length) {
    s.projects.forEach(p => {
      lines.push(`- ${p.project_name}：进度 ${p.progress || 0}%（${p.status === 'done' ? '已完成' : '进行中'}，计划结束 ${p.end_date || '待定'}）`)
    })
  } else {
    lines.push('本月无在办项目。')
  }
  lines.push('')
  lines.push(`三、月度目标完成情况`)
  lines.push(`目标完成 ${g.done || 0} / ${g.total || 0} 项。`)
  lines.push('')
  lines.push(`四、问题与建议`)
  if ((s.dailyReports || []).some(d => d.need_help)) {
    s.dailyReports.filter(d => d.need_help).forEach(d => lines.push(`- ${d.report_date}：${d.need_help}`))
  } else {
    lines.push('本月无需协调事项。')
  }
  return lines.join('\n')
}

// AI 生成向上汇报风格的月度报告
/**
 * 让模型把统计事实写成五段式月报（概览/成果/项目/问题/建议）。
 * 明确要求纯文本与固定标题，是为了能直接粘进 OA、也便于年底按标题汇总成年度报告。
 *
 * @param {string} month
 * @param {object} s buildStats 的返回值
 * @param {{baseURL: string, apiKey: string, model: string}} cfg 本人 AI 配置
 * @returns {Promise<string>} 模型返回的原始文本（调用方再统一清成纯文本）
 */
async function aiMonthlyReport(month, s, cfg) {
  const fact = []
  const t = s.ticket || {}
  fact.push(`【统计数据】`)
  fact.push(`工单总量 ${t.total || 0}，已完成 ${t.done_cnt || 0}，平均处理时长 ${t.avg_hours || 0} 小时`)
  fact.push(`问题类别分布：${(s.byType || []).map(x => `${x.name}${x.value}单`).join('、') || '无'}`)
  fact.push(`应用系统分布：${(s.bySystem || []).map(x => `${x.name}${x.value}单`).join('、') || '无'}`)
  fact.push(`月度目标完成：${(s.goal || {}).done || 0}/${(s.goal || {}).total || 0}`)
  if (s.projects.length) {
    fact.push(`【项目情况】`)
    s.projects.forEach(p => fact.push(`- ${p.project_name}：进度${p.progress || 0}%，状态${p.status === 'done' ? '已完成' : '进行中'}，计划结束${p.end_date || '待定'}`))
  }
  if (s.dailyReports.length) {
    fact.push(`【当月日报摘录】`)
    s.dailyReports.forEach(d => fact.push(`- ${d.report_date}：${(d.today_work || '').replace(/\n/g, '；').slice(0, 150)}`))
  }

  const prompt = `你是 IT 运维团队的汇报助手。请根据以下原始材料，为「${month}」撰写一份月度工作总结报告，用于向上级汇报，并方便年底汇总成年度报告。
要求：
1. 向上汇报风格，不要流水账：按主题归类合并，突出成果、数据与价值（保障了什么、优化了什么、解决了什么）；
2. 结构固定为五个部分，使用以下标题（标题单独一行，不加 # 号）：
一、本月工作概览
二、重点工作与成果
三、项目进展
四、问题与改进
五、下月工作建议
3. 引用数据要忠于材料，不编造；日报摘录可归纳提炼；
4. 篇幅适中，分点表达；
5. 【格式硬要求】只输出纯文本：禁止任何 Markdown 标记，不要出现 ** 、## 、- 开头的列表、\` 、> 、表格竖线；分点请用「1. 」「2. 」或「· 」开头。

原始材料：
${fact.join('\n')}`

  return ai.chat([
    { role: 'system', content: '你是一名严谨的 IT 运维汇报撰写助手，输出必须是纯文本，禁止使用 Markdown 语法。' },
    { role: 'user', content: prompt }
  ], { baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model, maxTokens: 2500 })
}

// 生成（或重新生成）某月报告并入库
/**
 * 生成月报主流程：取数 → 有 AI 用 AI → 没有或失败用规则兜底 → 清成纯文本 → 按月 upsert 入库。
 * 幂等：同一人同一月只有一条（report_month + user_id 唯一），重新生成即覆盖，不会堆重复记录。
 *
 * @param {number} userId
 * @param {string} month 形如 2026-10
 * @param {{useAi?: boolean}} options useAi=false 时强制走规则版（定时任务与重算用）
 * @returns {Promise<{content: string, stats: object, ai_used: boolean}>}
 */
async function generateMonthReport(userId, month, { useAi = true } = {}) {
  const stats = await buildStats(userId, month)
  let content = ''
  let aiUsed = false
  if (useAi) {
    const cfg = await ai.loadUserConfig(userId)
    if (cfg) {
      try {
        content = await aiMonthlyReport(month, stats, cfg)
        aiUsed = true
      } catch (e) {
        if (!e.noConfig) console.error('[monthlyReport] AI 生成失败，降级为规则汇总：', e.message)
      }
    }
  }
  if (!content) content = buildFallbackText(month, stats)
  // 月报同样是纯文本交付（复制到 OA / 邮件 / 年度汇总），统一去掉 Markdown 符号
  content = toPlain(content)

  await query(
    `INSERT INTO monthly_report (user_id, report_month, content) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE content = VALUES(content)`,
    [userId, month, content]
  )
  return { content, stats, ai_used: aiUsed }
}

// ---------------- 路由 ----------------
// 生成/重新生成
/**
 * 生成指定月份的月报（本人）。
 * 权限：登录用户，只能生成自己的；month 必须是 YYYY-MM，防止拼出非法月份把数据算空。
 *
 * @param {import('express').Request} req body.month
 * @param {import('express').Response} res { content, stats, ai_used }
 * @returns {Promise<void>}
 */
router.post('/generate', asyncHandler(async (req, res) => {
  const month = (req.body.month || '').trim()
  if (!/^\d{4}-\d{2}$/.test(month)) return fail(res, '月份格式应为 YYYY-MM')
  const data = await generateMonthReport(req.user.user_id, month)
  ok(res, { content: data.content, stats: data.stats, ai_used: data.ai_used }, data.ai_used ? 'AI 月度报告已生成' : '月度报告已生成（规则汇总，可在 .env 配置 AI 后获得 AI 版）')
}))

// 获取已存报告
/**
 * 读取已生成的月报，没生成过返回 null（前端据此显示「去生成」按钮）。
 * 权限：仅本人。
 *
 * @param {import('express').Request} req query.month
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/', asyncHandler(async (req, res) => {
  const month = (req.query.month || '').trim()
  if (!/^\d{4}-\d{2}$/.test(month)) return fail(res, '月份格式应为 YYYY-MM')
  const rows = await query(
    'SELECT report_id, report_month, content, update_time FROM monthly_report WHERE user_id = ? AND report_month = ?',
    [req.user.user_id, month]
  )
  const r = rows[0]
  ok(res, r ? { ...r, content: toPlain(r.content) } : null)
}))

// 历史列表
/**
 * 我的月报历史：按月份倒序最多 36 条（三年），只取正文前 80 字做预览，避免列表接口传大文本。
 * 权限：仅本人。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/history', asyncHandler(async (req, res) => {
  const rows = await query(
    'SELECT report_id, report_month, LEFT(content, 80) AS preview, update_time FROM monthly_report WHERE user_id = ? ORDER BY report_month DESC LIMIT 36',
    [req.user.user_id]
  )
  ok(res, rows)
}))

// ---------------- 月底自动生成（供 index.js 定时调用） ----------------
/**
 * 判断今天是否本月最后一天（用「明天是否换月」判断，比写死 28/30/31 更稳）。
 *
 * @param {Date} d
 * @returns {boolean}
 */
function isLastDayOf_month(d = new Date()) {
  const tmr = new Date(d)
  tmr.setDate(d.getDate() + 1)
  return tmr.getMonth() !== d.getMonth()
}

/**
 * 月底自动生成全员月报，由定时任务反复调用（自己判断是否该执行）。
 * 只在「本月最后一天 17:00 之后」跑，且已存在月报的人直接跳过 —— 不覆盖用户手改过的内容；
 * 单人失败只记日志，不影响其他人的生成。
 *
 * @returns {Promise<void>}
 */
async function autoGenerateMonthEnd() {
  const now = new Date()
  if (!isLastDayOf_month(now) || now.getHours() < 17) return
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  // 审计员是只读角色，不生成月报（与日报的「应提交人数」口径一致）
  const users = await query("SELECT user_id FROM sys_user WHERE is_enable = 1 AND role <> 'auditor'")
  for (const u of users) {
    try {
      const exist = await query('SELECT 1 FROM monthly_report WHERE user_id = ? AND report_month = ?', [u.user_id, month])
      if (exist.length) continue
      await generateMonthReport(u.user_id, month)
      console.log(`[monthlyReport] 已自动生成 ${month} 月度报告（用户 ${u.user_id}）`)
    } catch (e) {
      console.error(`[monthlyReport] 自动生成失败（用户 ${u.user_id}）：`, e.message)
    }
  }
}

// ---------------- 团队月报查阅（管理员 / 审计员） ----------------
// 某月的全员月报 + 未提交名单
/**
 * 团队月报总览：某月已提交的月报列表 + 未提交名单 + 应提交人数。
 * 权限：管理员 / 审计员。月份不合法时回落本月，避免一开页面就报错。
 * 口径：应提交与未提交都按「启用且非审计员」算，两边条件必须一致，否则人数对不上。
 *
 * @param {import('express').Request} req query.month / user_id / keyword
 * @param {import('express').Response} res { month, list, total, expected, missing }
 * @returns {Promise<void>}
 */
router.get('/team', canViewAll, asyncHandler(async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '')
    ? req.query.month
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const { user_id, keyword } = req.query
  const where = ['m.report_month = ?']
  const params = [month]
  if (user_id) { where.push('m.user_id = ?'); params.push(Number(user_id)) }
  if (keyword) { where.push('m.content LIKE ?'); params.push(`%${keyword}%`) }

  const rows = await query(
    `SELECT m.report_id, m.user_id, m.report_month, LEFT(m.content, 160) AS preview,
            CHAR_LENGTH(m.content) AS content_len, m.create_time, m.update_time,
            u.real_name, u.username, u.role
     FROM monthly_report m LEFT JOIN sys_user u ON u.user_id = m.user_id
     WHERE ${where.join(' AND ')} ORDER BY m.update_time DESC`,
    params
  )
  const missing = await query(
    `SELECT u.user_id, u.username, u.real_name, u.role FROM sys_user u
     WHERE u.is_enable = 1 AND u.role <> 'auditor'
       AND NOT EXISTS (SELECT 1 FROM monthly_report m WHERE m.user_id = u.user_id AND m.report_month = ?)
     ORDER BY u.user_id`,
    [month]
  )
  const expected = await query("SELECT COUNT(*) AS n FROM sys_user WHERE is_enable = 1 AND role <> 'auditor'")
  ok(res, {
    month,
    list: rows.map(r => ({ ...r, preview: toPlain(r.preview) })),
    total: rows.length,
    expected: Number((expected[0] && expected[0].n) || 0),
    missing
  })
}))

// 团队月报详情
/**
 * 单份月报详情（全文），供管理员查看。
 * 权限：管理员 / 审计员。
 *
 * @param {import('express').Request} req req.params.id 为 report_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/team/:id', canViewAll, asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT m.*, u.real_name, u.username, u.role FROM monthly_report m
     LEFT JOIN sys_user u ON u.user_id = m.user_id WHERE m.report_id = ?`,
    [req.params.id]
  )
  if (!rows.length) return fail(res, '月报不存在')
  ok(res, { ...rows[0], content: toPlain(rows[0].content) })
}))

module.exports = router
module.exports.autoGenerateMonthEnd = autoGenerateMonthEnd
