/**
 * @file backend/src/routes/knowledge.js
 * @description 条目增删改查、关键词推荐、AI 归类整理、附件内容解析
 *
 * 知识库路由 —— IT 运维工单台账与日报自动管理系统
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
const path = require('path')
const { query } = require('../db')
const { ok, fail, asyncHandler, safeJson } = require('../utils/helpers')
const { auth, isViewAll } = require('../middleware/auth')
const { upload, uploadDir } = require('../middleware/upload')
const ai = require('../utils/ai')

router.use(auth)

/**
 * 知识库读范围：默认只看自己沉淀的条目，管理员/审计员带 all=1 才看全员。
 * 与写范围分开，是因为读接口会带 all 参数、写接口不会。
 *
 * @param {import('express').Request} req
 * @returns {{clause: string, params: number[]}}
 */
function scope(req) {
  if (isViewAll(req.user.role) && req.query.all === '1') return { clause: '', params: [] }
  return { clause: 'AND user_id = ?', params: [req.user.user_id] }
}

// 写操作不受 all=1 限制：管理员/审计员可维护任意条目（前端写操作不带 all 参数）
/**
 * 知识库写范围：管理员/审计员不限，其他人只能改自己创建的条目。
 *
 * @param {import('express').Request} req
 * @returns {{clause: string, params: number[]}}
 */
function writeScope(req) {
  if (isViewAll(req.user.role)) return { clause: '', params: [] }
  return { clause: 'AND user_id = ?', params: [req.user.user_id] }
}

// 简单关键词自动提取（CJK 分词较弱，取去噪后的短语 + 字典字段兜底）
/**
 * 从正文里粗提关键词：中文不做真正分词，靠去标点后按空白切，再拼上应用系统与问题类别兜底。
 * 最多留 10 个，够搜索命中就行，不追求精确。
 *
 * @param {string} text 方案或摘要原文
 * @param {string} [app_system]
 * @param {string} [problem_type]
 * @returns {string} 逗号分隔的关键词串
 */
function extractKeywords(text, app_system, problem_type) {
  const base = [app_system, problem_type].filter(Boolean)
  const cleaned = (text || '').replace(/[\s\r\n，。、；：！？“”‘’（）【】《》,.;:!?()]/g, ' ').trim()
  const tokens = cleaned.split(/\s+/).filter(w => w.length >= 2 && w.length <= 20)
  const uniq = Array.from(new Set([...base, ...tokens])).slice(0, 10)
  return uniq.join('，')
}

// 列表（筛选 + 关键词搜索）
/**
 * 知识条目列表：按应用系统、问题类别、关键词过滤，可选只看已公开到自助门户的条目。
 * 权限：默认只返回自己的条目，管理员/审计员带 all=1 看全员。
 * 不分页：知识库是内部沉淀，量级可控，前端用关键词缩小范围。
 *
 * @param {import('express').Request} req query: app_system / problem_type / keyword / public / all
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/', asyncHandler(async (req, res) => {
  const { app_system, problem_type, keyword, all } = req.query
  const sc = scope(req)
  const where = ['1=1']
  const params = []
  // 管理员/审计员 all=1 时 clause 为空，不能拼进 WHERE（否则 SQL 语法错误）
  if (sc.clause) {
    where.push(sc.clause.replace(/^AND/, ''))
    params.push(...sc.params)
  }
  if (app_system) { where.push('app_system = ?'); params.push(app_system) }
  if (problem_type) { where.push('problem_type = ?'); params.push(problem_type) }
  // 只看已公开到自助门户的条目（常见问题管理页用）
  if (req.query.public === '1') where.push('is_public = 1')
  if (keyword) {
    where.push('(problem_summary LIKE ? OR solution LIKE ? OR keyword LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }
  const rows = await query(
    `SELECT * FROM knowledge WHERE ${where.join(' AND ')} ORDER BY create_time DESC`, params
  )
  rows.forEach(r => { r.attachment = safeJson(r.attachment) || [] })
  ok(res, rows)
}))

// 工单录入时推荐方案：优先 应用系统+问题类别 精准，兜底关键词模糊
// 同时返回「历史工单」——把工单本身当成知识库，展示之前的处理方式
/**
 * 录单时的方案推荐：先按「应用系统 + 问题类别」精准命中，命中不到再退化成关键词模糊搜；
 * 同时附 8 条已完成的相似历史工单，把工单本身也当作知识来源。
 * 权限：只查自己的数据（user_id 恒取当前登录人）。
 *
 * @param {import('express').Request} req query: app_system / problem_type / keyword
 * @param {import('express').Response} res { knowledge, history }
 * @returns {Promise<void>}
 */
router.get('/recommend', asyncHandler(async (req, res) => {
  const { app_system, problem_type, keyword } = req.query
  const uid = req.user.user_id
  let knowledge = []
  if (app_system && problem_type) {
    knowledge = await query(
      `SELECT * FROM knowledge WHERE user_id = ? AND app_system = ? AND problem_type = ?
       ORDER BY view_count DESC, create_time DESC LIMIT 5`,
      [uid, app_system, problem_type]
    )
  }
  if (!knowledge.length && (keyword || app_system || problem_type)) {
    const k = keyword || [app_system, problem_type].filter(Boolean).join(' ')
    knowledge = await query(
      `SELECT * FROM knowledge WHERE user_id = ? AND (problem_summary LIKE ? OR solution LIKE ? OR keyword LIKE ?)
       ORDER BY view_count DESC LIMIT 5`,
      [uid, `%${k}%`, `%${k}%`, `%${k}%`]
    )
  }
  knowledge.forEach(r => { r.attachment = safeJson(r.attachment) || [] })

  // 历史工单（已完成的工单即知识沉淀）：同 应用系统+问题类别 或 关键字匹配
  let history = []
  const hWhere = ['user_id = ?', 'status = ?', 'handle_desc IS NOT NULL', 'handle_desc <> ""']
  const hParams = [uid, 'done']
  if (app_system && problem_type) {
    hWhere.push('app_system = ?', 'problem_type = ?')
    hParams.push(app_system, problem_type)
  } else {
    const k = keyword || [app_system, problem_type].filter(Boolean).join(' ')
    if (k) {
      hWhere.push('(service_content LIKE ? OR handle_desc LIKE ? OR problem_type LIKE ? OR app_system LIKE ?)')
      hParams.push(`%${k}%`, `%${k}%`, `%${k}%`, `%${k}%`)
    }
  }
  if (k_or_hasFilter(app_system, problem_type, keyword)) {
    history = await query(
      `SELECT ticket_id, happen_time, dept, service_content, app_system, problem_type, handle_desc, status
       FROM ticket WHERE ${hWhere.join(' AND ')} ORDER BY happen_time DESC LIMIT 8`,
      hParams
    )
  }
  ok(res, { knowledge, history })
}))

/**
 * 判断推荐条件是否为空：三个筛选条件全空时直接跳过历史工单查询，
 * 否则会无条件把「最近 8 条已完成工单」当成推荐，反而干扰录入。
 *
 * @param {string} app_system
 * @param {string} problem_type
 * @param {string} keyword
 * @returns {boolean}
 */
function k_or_hasFilter(app_system, problem_type, keyword) {
  return !!(app_system || problem_type || keyword)
}

// AI 整理知识库：把已完成的工单按 应用系统+问题类别 聚类，生成/更新知识条目
// 配置了 AI 则自动总结处理方案；未配置则规则合并历史处理方式
/**
 * 一键整理知识库：把已完成的工单按「应用系统 + 问题类别」聚类，取最近 6 条处理说明，
 * 有 AI 配置就总结成标准方案，没有就原样合并；同维度已有条目则更新、没有则新建。
 * 权限：只整理自己的工单与自己名下的条目（user_id 恒为当前登录人）。
 * 上限 20 组，避免一次触发太多模型调用；单组失败只是退回规则合并，不中断整批。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res { created, updated, skipped, ai_used }
 * @returns {Promise<void>}
 */
router.post('/ai-organize', asyncHandler(async (req, res) => {
  const uid = req.user.user_id
  const groups = await query(
    `SELECT app_system, problem_type, COUNT(*) AS cnt,
            GROUP_CONCAT(handle_desc SEPARATOR '\n---\n') AS descs
     FROM ticket
     WHERE user_id = ? AND status = 'done' AND handle_desc IS NOT NULL AND handle_desc <> ''
     GROUP BY app_system, problem_type
     ORDER BY cnt DESC
     LIMIT 20`,
    [uid]
  )
  if (!groups.length) return ok(res, { created: 0, updated: 0, skipped: 0, ai_used: false }, '暂无可整理的已完成工单')

  // 已有的知识条目（按 应用系统+问题类别 去重）
  const existing = await query(
    'SELECT kb_id, app_system, problem_type FROM knowledge WHERE user_id = ?', [uid]
  )
  const existKey = new Set(existing.map(r => `${r.app_system || ''}|${r.problem_type || ''}`))

  // 读取本人 AI 配置：有配置才调用 AI 总结，否则规则合并历史处理方式
  const cfg = await ai.loadUserConfig(uid)
  let created = 0, updated = 0, skipped = 0, aiUsed = false
  for (const g of groups) {
    const key = `${g.app_system || ''}|${g.problem_type || ''}`
    const snippet = (g.descs || '').split('\n---\n').map(s => s.trim()).filter(Boolean).slice(0, 6)
    if (!snippet.length) { skipped++; continue }

    let solution = snippet.join('\n')
    if (snippet.length > 1 && cfg) {
      try {
        const prompt = `你是运维知识库整理助手。下面是一组相同「应用系统=${g.app_system || '未知'}、问题类别=${g.problem_type || '未知'}」的工单的历史处理方式，请归纳成一份简洁、可复用的标准处理方案（分点、去重、保留关键命令/步骤，控制在 300 字内）：\n\n${snippet.join('\n')}`
        const summary = await ai.chat([
          { role: 'system', content: '你是一名严谨的运维知识库整理助手，输出纯文本处理方案。' },
          { role: 'user', content: prompt }
        ], { baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model, maxTokens: 600 })
        solution = summary
        aiUsed = true
      } catch (e) {
        if (!e.noConfig) console.error('[knowledge] AI 整理失败，降级规则合并：', e.message)
      }
    }

    if (existKey.has(key)) {
      // 已有同维度条目则更新方案
      await query(
        'UPDATE knowledge SET solution = ?, keyword = ?, update_time = NOW() WHERE user_id = ? AND app_system <=> ? AND problem_type <=> ?',
        [solution, [g.app_system, g.problem_type].filter(Boolean).join('，'), uid, g.app_system || null, g.problem_type || null]
      )
      updated++
    } else {
      await query(
        `INSERT INTO knowledge (user_id, app_system, problem_type, problem_summary, solution, keyword, source_ticket_id, attachment)
         VALUES (?,?,?,?,?,?,NULL,NULL)`,
        [uid, g.app_system || null, g.problem_type || null,
         `${g.app_system || '通用'} · ${g.problem_type || '问题'} 标准处理方案`,
         solution, [g.app_system, g.problem_type].filter(Boolean).join('，')]
      )
      created++
    }
  }
  ok(res, { created, updated, skipped, ai_used: aiUsed },
     aiUsed ? `AI 已整理知识库：新增 ${created} 条、更新 ${updated} 条` : `已整理知识库（规则合并）：新增 ${created} 条、更新 ${updated} 条`)
}))

// 详情 + 浏览计数
/**
 * 知识条目详情，顺手累加 view_count。
 * 权限：按 scope 判断，别人创建的条目只有管理员/审计员（带 all=1）能看。
 * 浏览计数用于「哪些知识真的被用上了」，也用于推荐排序（看得多的优先）。
 *
 * @param {import('express').Request} req req.params.id 为 kb_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const sc = scope(req)
  const rows = await query(
    `SELECT * FROM knowledge WHERE kb_id = ? ${sc.clause}`, [req.params.id, ...sc.params]
  )
  if (!rows.length) return fail(res, '知识库条目不存在')
  await query('UPDATE knowledge SET view_count = view_count + 1 WHERE kb_id = ?', [req.params.id])
  rows[0].attachment = safeJson(rows[0].attachment) || []
  rows[0].view_count = (rows[0].view_count || 0) + 1
  ok(res, rows[0])
}))

// 一键导入「面向电脑小白的自助排障」模板
/**
 * 批量补导常见问题模板。按标题判重，重复点不会产生第二份，
 * 也不会覆盖管理员手工编辑过的条目。首次部署时启动迁移已自动导入过一次，
 * 这个接口主要用于「删了几条想补回来」或迁移失败后手工重试。
 * 权限：审计员是只读账号，不能导入；其他已登录用户都可以（条目归到自己名下）。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res { inserted, skipped, total }
 * @returns {Promise<void>}
 */
router.post('/import-starter', asyncHandler(async (req, res) => {
  if (req.user.role === 'auditor') return fail(res, '只读账号不能导入常见问题')
  const { importStarterFaqs } = require('../data/faqStarter')
  const r = await importStarterFaqs(query, req.user.user_id)
  ok(res, r, r.inserted ? `已导入 ${r.inserted} 条` : '模板已全部存在，没有新增')
}))

// 新增
/**
 * 新建知识条目：没传关键词就自动提取，作者恒为当前登录人。
 *
 * @param {import('express').Request} req body: app_system / problem_type / problem_summary / solution / is_public / attachment
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body
  const keyword = b.keyword || extractKeywords(b.solution || b.problem_summary, b.app_system, b.problem_type)
  await query(
    `INSERT INTO knowledge (user_id, app_system, problem_type, problem_summary, solution, keyword, is_public, source_ticket_id, attachment)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [req.user.user_id, b.app_system || null, b.problem_type || null, b.problem_summary || '', b.solution || '', keyword,
     b.is_public ? 1 : 0, b.source_ticket_id || null, b.attachment ? JSON.stringify(b.attachment) : null]
  )
  ok(res, null, '创建成功')
}))

// 更新
/**
 * 编辑知识条目：只改 body 里出现的字段，空对象直接拒绝。
 * 权限：writeScope —— 自己创建的；管理员/审计员可改任意条目。
 *
 * @param {import('express').Request} req req.params.id 为 kb_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.put('/:id', asyncHandler(async (req, res) => {
  const sc = writeScope(req)
  const b = req.body
  const sets = [], vals = []
  ;['app_system', 'problem_type', 'problem_summary', 'solution', 'keyword', 'source_ticket_id'].forEach(f => {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); vals.push(b[f]) }
  })
  // 是否公开到「常见问题自助门户」
  if (b.is_public !== undefined) { sets.push('is_public = ?'); vals.push(b.is_public ? 1 : 0) }
  if (b.attachment !== undefined) { sets.push('attachment = ?'); vals.push(JSON.stringify(b.attachment)) }
  if (!sets.length) return fail(res, '无更新字段')
  vals.push(req.params.id, ...sc.params)
  const result = await query(`UPDATE knowledge SET ${sets.join(', ')} WHERE kb_id = ? ${sc.clause}`, vals)
  if (result.affectedRows === 0) return fail(res, '条目不存在或无权限')
  ok(res, null, '更新成功')
}))

// 删除
/**
 * 删除知识条目。权限：writeScope —— 自己创建的；管理员/审计员可删任意条目。
 *
 * @param {import('express').Request} req req.params.id 为 kb_id
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const sc = writeScope(req)
  const result = await query(`DELETE FROM knowledge WHERE kb_id = ? ${sc.clause}`, [req.params.id, ...sc.params])
  if (result.affectedRows === 0) return fail(res, '条目不存在或无权限')
  ok(res, null, '删除成功')
}))

// 文档解析：上传文档，自动提取文本回填
/**
 * 上传文档并把正文提出来回填到方案输入框，省得运维手敲一遍。
 * 支持 txt/md/csv/pdf/docx；正文压成一整行并截断 2000 字，避免长文档把输入框撑爆。
 * 权限：任意已登录用户。
 *
 * @param {import('express').Request} req multipart 单文件字段名 file
 * @param {import('express').Response} res { text, url }
 * @returns {Promise<void>}
 */
router.post('/parse', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return fail(res, '未接收到文件')
  const fp = path.resolve(uploadDir, req.file.filename)
  const ext = path.extname(req.file.originalname).toLowerCase()
  let text = ''
  try {
    if (ext === '.txt' || ext === '.md' || ext === '.csv') {
      text = fs.readFileSync(fp, 'utf-8')
    } else if (ext === '.pdf') {
      const pdfParse = require('pdf-parse')
      const buf = fs.readFileSync(fp)
      const data = await pdfParse(buf)
      text = data.text || ''
    } else if (ext === '.docx') {
      const mammoth = require('mammoth')
      const data = await mammoth.extractRawText({ path: fp })
      text = data.value || ''
    } else {
      return fail(res, '暂不支持该格式（支持 txt/md/csv/pdf/docx）')
    }
  } catch (e) {
    return fail(res, '文档解析失败：' + e.message)
  }
  // 截断，避免过长
  const preview = text.replace(/\s+/g, ' ').trim().slice(0, 2000)
  ok(res, { text: preview, url: `/uploads/${req.file.filename}` })
}))

module.exports = router
