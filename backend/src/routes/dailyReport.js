/**
 * @file backend/src/routes/dailyReport.js
 * @description 今日草稿、历史记录、提交、AI 代写、团队提交情况与缺席名单
 *
 * 日报路由 —— IT 运维工单台账与日报自动管理系统
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

/**
 * 取本地日期串 YYYY-MM-DD。日报按「自然日」归集，必须用本地时区，
 * 不能用 toISOString()（UTC 会差 8 小时，早上 8 点前提交会算到前一天）。
 *
 * @param {Date} d
 * @returns {string}
 */
function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 今日工单自动汇总（仅用于录入页默认草稿，不含部门/人名）
/**
 * 把今日已完成工单压成「类别：处理摘要」的草稿，作为输入框的默认内容。
 *
 * @param {Array<object>} tickets 今日已完成工单
 * @returns {string}
 */
function buildTodayWork(tickets) {
  if (!tickets.length) return '今日无已完成工单。'
  const lines = tickets.map(t => {
    const pt = t.problem_type || '问题'
    const desc = (t.handle_desc || t.service_content || '').slice(0, 60)
    return `${pt}：${desc}`
  })
  return lines.join('\n')
}

// 无 AI 时的规则兜底日报：只写「今天做了哪些事 + 处理结果」，不写部门、不写人名
/**
 * 规则版日报：AI 不可用时的降级方案，输出与 AI 版同样的三段结构（今日/协调/计划）。
 * 未完成待办同时充当「需协调」和「明日计划」，保持与 AI 输出的字段语义一致。
 *
 * @param {Array<object>} done 今日已完成工单
 * @param {Array<object>} pending 未完成待办
 * @returns {{today_work: string, need_help: string, tomorrow_plan: string}}
 */
function buildRuleDaily(done, pending) {
  const lines = []
  lines.push('【今日】')
  if (done.length) {
    done.forEach((t, i) => {
      const pt = t.problem_type || '问题'
      const sv = (t.service_content || '').trim().slice(0, 80) || '（未填写服务内容）'
      const hd = (t.handle_desc || '').trim().slice(0, 120) || '（未填写处理结果）'
      lines.push(`${i + 1}. 处理${pt}：${sv}；处理结果：${hd}`)
    })
  } else {
    lines.push('今日暂无已完成的工单处理记录。')
  }

  lines.push('')
  lines.push('【协调】')
  if (pending.length) {
    lines.push('以下事项仍需跟进/协调：')
    pending.forEach(x => lines.push(`- ${x.todo_title}`))
  } else {
    lines.push('无')
  }

  lines.push('')
  lines.push('【计划】')
  if (pending.length) {
    pending.forEach(x => lines.push(`- ${x.todo_title}`))
  } else {
    lines.push('无')
  }

  return {
    today_work: lines.join('\n'),
    need_help: pending.length ? pending.map(x => x.todo_title).join('\n') : '',
    tomorrow_plan: pending.length ? pending.map(x => x.todo_title).join('\n') : ''
  }
}

// 获取今日日报（含自动汇总）
/**
 * 今日日报：已保存过就回显，没保存则用「今日已完成工单」自动生成草稿。
 * 权限：登录用户只能看自己的日报。
 * 口径：只统计 user_id 为自己、发生时间在今天、状态已完成的工单；
 *      这是「今天干了什么」的口径，与看板那种「自己报的 + 派给自己的」口径不同。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res { report_date, auto_work, today_work, need_help, tomorrow_plan }
 * @returns {Promise<void>}
 */
router.get('/today', asyncHandler(async (req, res) => {
  const t = dateStr(new Date())
  const done = await query(
    `SELECT dept, problem_type, handle_desc, service_content FROM ticket
     WHERE user_id = ? AND DATE(happen_time) = ? AND status = 'done' ORDER BY happen_time DESC`,
    [req.user.user_id, t]
  )
  const auto = buildTodayWork(done)

  const saved = await query(
    'SELECT * FROM daily_report WHERE user_id = ? AND report_date = ?', [req.user.user_id, t]
  )
  const record = saved[0] || null
  ok(res, {
    report_date: t,
    auto_work: auto,
    // 历史数据里可能残留 AI 写出的 Markdown 符号，返回前统一清成纯文本
    today_work: record ? toPlain(record.today_work) : auto,
    need_help: record ? toPlain(record.need_help) : '',
    tomorrow_plan: record ? toPlain(record.tomorrow_plan) : ''
  })
}))

// 历史日报
/**
 * 我的历史日报：按日期倒序最多 60 条，够翻两个月，不做分页。
 * 权限：仅本人（恒定按 user_id 过滤，不接收前端传入的用户参数）。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/history', asyncHandler(async (req, res) => {
  const rows = await query(
    'SELECT report_id, report_date, today_work, need_help, tomorrow_plan, create_time FROM daily_report WHERE user_id = ? ORDER BY report_date DESC LIMIT 60',
    [req.user.user_id]
  )
  ok(res, rows.map(r => ({
    ...r,
    today_work: toPlain(r.today_work),
    need_help: toPlain(r.need_help),
    tomorrow_plan: toPlain(r.tomorrow_plan)
  })))
}))

// 提交日报：保存 + 明日计划拆分成待办
/**
 * 提交当日日报，并把「明日计划」逐行拆成次日待办。
 * 权限：登录用户，只能提交自己的日报（同一天重复提交按 upsert 覆盖）。
 * 幂等：先删掉上一次由日报生成的明日待办再重建，否则每改一次就多一份重复待办。
 *
 * @param {import('express').Request} req body: today_work / need_help / tomorrow_plan
 * @param {import('express').Response} res { plan_count } 本次生成/覆盖的待办条数
 * @returns {Promise<void>}
 */
router.post('/submit', asyncHandler(async (req, res) => {
  // 入库前统一清成纯文本（用户从别处粘贴带 ** / ## 的内容也不会脏数据）
  const today_work_p = toPlain(req.body.today_work)
  const need_help_p = toPlain(req.body.need_help)
  const tomorrow_plan_p = toPlain(req.body.tomorrow_plan)
  const t = dateStr(new Date())

  await query(
    `INSERT INTO daily_report (user_id, report_date, today_work, need_help, tomorrow_plan)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE today_work=VALUES(today_work), need_help=VALUES(need_help), tomorrow_plan=VALUES(tomorrow_plan)`,
    [req.user.user_id, t, today_work_p, need_help_p, tomorrow_plan_p]
  )

  // 明日计划：每行一条待办，plan_date = 次日
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = dateStr(tomorrow)
  const lines = [...new Set(
    tomorrow_plan_p
      .split(/\r?\n/)
      // 去掉行首的「·」「-」「1.」「(1)」等列表符号，待办标题保持干净
      .map(s => s.replace(/^\s*(?:[·•*+-]|\d+[.)、]|[（(]\d+[）)])\s*/, '').trim())
      .filter(Boolean)
  )]

  // 同一天重复提交（或改完再提）时，先清掉上一次由日报生成的明日计划待办，
  // 否则每提交一次待办就翻一倍（日报本身是 upsert，不会重复）
  await query(
    "DELETE FROM todo WHERE user_id = ? AND source = 'daily_report' AND plan_date = ?",
    [req.user.user_id, tomorrowStr]
  )

  for (const line of lines) {
    await query(
      'INSERT INTO todo (user_id, todo_title, plan_date, source) VALUES (?,?,?,?)',
      [req.user.user_id, line, tomorrowStr, 'daily_report']
    )
  }

  ok(res, { plan_count: lines.length }, `日报已保存${lines.length ? `，${lines.length} 条明日计划已生成待办` : ''}`)
}))

// AI 智能汇总当日工作（向上汇报风格，非流水账）
/**
 * AI 生成日报：把今日工单、未完成待办、在办项目拼成事实材料交给模型，输出三段式纯文本。
 * 权限：登录用户，只能用自己的 AI 配置生成自己的日报。
 * 降级：未配置 AI 或调用失败（限流/超时/Token 失效）一律回落 buildRuleDaily，功能不因 AI 挂掉。
 * 返回值里 ai_used / ai_error 让前端能提示「这次是 AI 写的还是规则拼的」。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res { today_work, need_help, tomorrow_plan, ai_used, ai_error? }
 * @returns {Promise<void>}
 */
router.post('/ai-generate', asyncHandler(async (req, res) => {
  const t = dateStr(new Date())
  const uid = req.user.user_id

  const [done, pending, projects] = await Promise.all([
    query(
      `SELECT dept, problem_type, service_content, handle_desc FROM ticket
       WHERE user_id = ? AND DATE(happen_time) = ? AND status = 'done' ORDER BY happen_time DESC`,
      [uid, t]
    ),
    query(
      `SELECT todo_title FROM todo WHERE user_id = ? AND is_finish = 0 AND (plan_date IS NULL OR plan_date <= ?) ORDER BY todo_id DESC LIMIT 10`,
      [uid, t]
    ),
    query(
      `SELECT project_name, progress, status, end_date FROM project WHERE user_id = ? AND status = 'active' ORDER BY end_date IS NULL, end_date ASC LIMIT 10`,
      [uid]
    )
  ])

  const fact = []
  fact.push(`【今日已完成工单】(${done.length} 单)`)
  done.forEach(x => fact.push(`- ${x.problem_type || '问题'}｜${(x.service_content || '').slice(0, 60)}｜处理：${(x.handle_desc || '').slice(0, 80)}`))
  if (!done.length) fact.push('- 无')
  fact.push(`【当前未完成待办】`)
  pending.forEach(x => fact.push(`- ${x.todo_title}`))
  if (!pending.length) fact.push('- 无')
  fact.push(`【在办项目】`)
  projects.forEach(x => fact.push(`- ${x.project_name}：进度 ${x.progress || 0}%，计划结束 ${x.end_date || '待定'}`))
  if (!projects.length) fact.push('- 无')

  // 优先使用本人 AI 配置；未配置或调用失败则降级为规则汇总
  const cfg = await ai.loadUserConfig(uid)
  if (!cfg) {
    const rule = buildRuleDaily(done, pending)
    return ok(res, { ...rule, ai_used: false }, '已按规则汇总（未配置 AI，仅列今日处理事项与结果）')
  }

  try {
    const prompt = `你是 IT 运维工程师的汇报助手。请根据以下原始材料，撰写一份「向上汇报」的当日工作日报。
要求：
1. 不要流水账：同类事项归类合并，突出结果与价值（保障了什么业务、解决了什么问题、消除了什么风险）；
2. 语言简练专业、分点表达，可直接复制发送给领导（微信 / 邮件 / OA 均为纯文本场景）；
3. 不要写部门、不要写具体经办人姓名，只写做了什么事、处理结果是什么；
4. 「明日工作计划」若材料不足，可参考未完成待办给出 2-3 条合理建议；
5. 【格式硬要求】只输出纯文本：不要使用任何 Markdown 标记，禁止出现 ** 、## 、- 、\` 、> 、表格竖线等符号；分点请直接用「1. 」「2. 」或「· 」开头；
6. 输出必须严格使用以下分段标记，不要添加其他标题：
[今日]
（今日工作汇报）
[协调]
（需协调解决的问题，没有则写"无"）
[计划]
（明日工作计划，每行一条）

原始材料：
${fact.join('\n')}`

    const text = await ai.chat([
      { role: 'system', content: '你是一名专业的 IT 运维汇报撰写助手，输出必须是纯文本，禁止使用 Markdown 语法。' },
      { role: 'user', content: prompt }
    ], { baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model, maxTokens: 1500 })

    // 模型偶尔仍会加粗 / 用 # 号，这里再兜一层，保证文本框里就是干净的纯文本
    const clean = toPlain(text)
    const m = clean.match(/\[今日\]([\s\S]*?)\[协调\]([\s\S]*?)\[计划\]([\s\S]*)/)
    if (!m) return ok(res, { today_work: clean, need_help: '', tomorrow_plan: '', ai_raw: true, ai_used: true })
    ok(res, {
      today_work: m[1].trim(),
      need_help: m[2].trim(),
      tomorrow_plan: m[3].trim(),
      ai_used: true
    })
  } catch (e) {
    // AI 调用失败（Token 失效 / 429 限流 / 网络等）时，自动降级为规则汇总，保证功能可用
    const rule = buildRuleDaily(done, pending)
    const reason = String(e.message || '').slice(0, 180)
    return ok(
      res,
      { ...rule, ai_used: false, ai_error: reason },
      `AI 调用失败，已自动按规则汇总。原因：${reason}`
    )
  }
}))

// ---------------- 团队日报查阅（管理员 / 审计员） ----------------
// 应提交人数：启用状态的非审计员账号（审计员是只读角色，不要求写日报）
/**
 * 日报「应提交人数」的分母：启用中且非审计员的账号数。
 * 这个口径必须与 /team/missing 的过滤条件保持一致，否则已交 + 未交 ≠ 应提交。
 *
 * @returns {Promise<number>}
 */
async function expectedReporters() {
  const r = await query("SELECT COUNT(*) AS n FROM sys_user WHERE is_enable = 1 AND role <> 'auditor'")
  return Number((r[0] && r[0].n) || 0)
}

// 提交情况概览：应提交 / 今日已交 / 本月份数 / 最近 7 天趋势
/**
 * 分母用 expectedReporters()（启用且非审计员），已交按 user_id 去重，一人一天只算一条；
 * 趋势固定输出最近 7 天、缺的日期补 0，保证前端柱状图间距均匀。
 * 权限：管理员 / 审计员（canViewAll）。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/team/summary', canViewAll, asyncHandler(async (req, res) => {
  const today = dateStr(new Date())
  const monthStart = today.slice(0, 8) + '01'
  const [expected, todayRows, monthRows, trendRows] = await Promise.all([
    expectedReporters(),
    query('SELECT COUNT(DISTINCT user_id) AS n FROM daily_report WHERE report_date = ?', [today]),
    query('SELECT COUNT(*) AS n FROM daily_report WHERE report_date >= ? AND report_date <= ?', [monthStart, today]),
    query(
      `SELECT report_date, COUNT(DISTINCT user_id) AS n FROM daily_report
       WHERE report_date >= DATE_SUB(?, INTERVAL 6 DAY) AND report_date <= ?
       GROUP BY report_date ORDER BY report_date`,
      [today, today]
    )
  ])
  ok(res, {
    report_date: today,
    expected,
    today_submitted: Number((todayRows[0] && todayRows[0].n) || 0),
    month_count: Number((monthRows[0] && monthRows[0].n) || 0),
    // 固定输出最近 7 天（没有提交的日期补 0），前端柱状图才是等距的
    trend: (() => {
      const map = new Map(trendRows.map(r => [String(r.report_date).slice(0, 10), Number(r.n)]))
      const out = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const key = dateStr(d)
        out.push({ date: key, count: map.get(key) || 0 })
      }
      return out
    })()
  })
}))

// 未提交名单（某一天 / 某个月）
/**
 * 某天未提交日报的人员名单，用 NOT EXISTS 反查，避免 LEFT JOIN 空行判断。
 * 权限：管理员 / 审计员。日期参数不合法时回落为今天，防止传错就把全公司列成未提交。
 *
 * @param {import('express').Request} req query.date 形如 2026-11-02
 * @param {import('express').Response} res { date, count, list }
 * @returns {Promise<void>}
 */
router.get('/team/missing', canViewAll, asyncHandler(async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : dateStr(new Date())
  const rows = await query(
    `SELECT u.user_id, u.username, u.real_name, u.role FROM sys_user u
     WHERE u.is_enable = 1 AND u.role <> 'auditor'
       AND NOT EXISTS (SELECT 1 FROM daily_report d WHERE d.user_id = u.user_id AND d.report_date = ?)
     ORDER BY u.user_id`,
    [date]
  )
  ok(res, { date, count: rows.length, list: rows })
}))

// 团队日报列表（按人员 / 日期区间 / 关键字筛选，服务端分页）
/**
 * 团队日报检索：按日期区间、人员、关键词过滤，服务端分页（默认 20、上限 100）。
 * 权限：管理员 / 审计员。日期参数走正则校验后才拼 SQL，非法值直接忽略。
 * 关键词同时匹配今日工作、需协调、明日计划三个字段。
 *
 * @param {import('express').Request} req query.from / to / user_id / keyword / page / page_size
 * @param {import('express').Response} res { list, total, page, page_size }
 * @returns {Promise<void>}
 */
router.get('/team', canViewAll, asyncHandler(async (req, res) => {
  const { from, to, user_id, keyword } = req.query
  const page = Math.max(Number(req.query.page) || 1, 1)
  const pageSize = Math.min(Math.max(Number(req.query.page_size) || 20, 1), 100)
  const where = ['1=1']
  const params = []
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || '')) { where.push('d.report_date >= ?'); params.push(from) }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to || '')) { where.push('d.report_date <= ?'); params.push(to) }
  if (user_id) { where.push('d.user_id = ?'); params.push(Number(user_id)) }
  if (keyword) {
    where.push('(d.today_work LIKE ? OR d.need_help LIKE ? OR d.tomorrow_plan LIKE ?)')
    const k = `%${keyword}%`
    params.push(k, k, k)
  }
  const w = where.join(' AND ')
  const cnt = await query(`SELECT COUNT(*) AS n FROM daily_report d WHERE ${w}`, params)
  const rows = await query(
    `SELECT d.report_id, d.user_id, d.report_date, d.today_work, d.need_help, d.tomorrow_plan, d.create_time,
            u.real_name, u.username, u.role
     FROM daily_report d LEFT JOIN sys_user u ON u.user_id = d.user_id
     WHERE ${w} ORDER BY d.report_date DESC, d.report_id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  )
  ok(res, {
    list: rows.map(r => ({
      ...r,
      today_work: toPlain(r.today_work),
      need_help: toPlain(r.need_help),
      tomorrow_plan: toPlain(r.tomorrow_plan)
    })),
    total: Number((cnt[0] && cnt[0].n) || 0),
    page,
    page_size: pageSize
  })
}))

// 团队日报详情
/**
 * 单份日报详情（含作者姓名与角色），供管理员查看全文。
 * 权限：管理员 / 审计员；按 report_id 直接取，不做人员归属校验（能进这个接口的角色本就可见全员）。
 *
 * @param {import('express').Request} req req.params.id 为 report_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/team/:id', canViewAll, asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT d.*, u.real_name, u.username, u.role FROM daily_report d
     LEFT JOIN sys_user u ON u.user_id = d.user_id WHERE d.report_id = ?`,
    [req.params.id]
  )
  if (!rows.length) return fail(res, '日报不存在')
  const r = rows[0]
  ok(res, {
    ...r,
    today_work: toPlain(r.today_work),
    need_help: toPlain(r.need_help),
    tomorrow_plan: toPlain(r.tomorrow_plan)
  })
}))

module.exports = router
