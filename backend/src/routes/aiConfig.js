/**
 * @file backend/src/routes/aiConfig.js
 * @description 模型地址、密钥、模型名配置，连通性自测与模型列表拉取
 *
 * AI 接入配置路由 —— IT 运维工单台账与日报自动管理系统
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
const { auth } = require('../middleware/auth')
const ai = require('../utils/ai')

router.use(auth)

// 获取本人 AI 接入配置
// api_key 出于安全不回显明文，仅返回 has_key 标记；首次访问返回默认供应商模板
/**
 * 读取本人 AI 配置。权限：登录用户只能读写自己的配置。
 * 不回显密钥明文（只给 has_key），避免通过接口把 Token 抓走；
 * configured 只看「启用 + 地址 + 模型」，本地模型不需要 Token，所以不把密钥作为必要条件。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/config', asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT config_id, provider, api_url, model, is_enable,
            (api_key IS NOT NULL AND api_key <> '') AS has_key
     FROM user_ai_config WHERE user_id = ?`,
    [req.user.user_id]
  )
  if (rows.length) {
    const c = rows[0]
    const enabled = c.is_enable === 1 || c.is_enable === true
    ok(res, {
      provider: c.provider,
      api_url: c.api_url,
      model: c.model,
      is_enable: enabled,
      has_key: c.has_key === 1 || c.has_key === true,
      // 已填写地址+模型并启用即可视为可用（本地模型无需 Token）
      configured: !!(enabled && c.api_url && c.model)
    })
  } else {
    // 默认模板（DeepSeek），用户保存后才入库
    ok(res, {
      provider: 'deepseek',
      api_url: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      is_enable: true,
      has_key: false,
      configured: false
    })
  }
}))

// 保存本人 AI 接入配置
/**
 * 保存本人 AI 配置（每人一份，有则更新无则新建）。
 * 权限：登录用户只能改自己的。api_key 留空表示保留原密钥，避免前端只改模型时把 Token 清掉。
 *
 * @param {import('express').Request} req body: provider / api_url / api_key / model / is_enable
 * @param {import('express').Response} res { api_url } 返回补全后的真实请求地址
 * @returns {Promise<void>}
 */
router.put('/config', asyncHandler(async (req, res) => {
  const { provider, api_key, model, is_enable } = req.body
  // 地址自动补全：只填 /v1 或根地址也能用（存库时统一为完整端点）
  const api_url = ai.normalizeBaseURL(req.body.api_url)
  if (!api_url || !model) return fail(res, 'API 地址与模型为必填项')
  const enable = is_enable === false ? 0 : 1
  const exist = await query('SELECT config_id, api_key FROM user_ai_config WHERE user_id = ?', [req.user.user_id])

  if (exist.length) {
    const sets = ['provider = ?', 'api_url = ?', 'model = ?', 'is_enable = ?', 'update_time = NOW()']
    const vals = [provider || 'custom', api_url, model, enable]
    // 仅当传入了非空 api_key 时才更新 Token（留空表示保留原值）
    if (api_key) { sets.push('api_key = ?'); vals.push(api_key) }
    vals.push(req.user.user_id)
    await query(`UPDATE user_ai_config SET ${sets.join(', ')} WHERE user_id = ?`, vals)
  } else {
    await query(
      `INSERT INTO user_ai_config (user_id, provider, api_url, api_key, model, is_enable, create_time, update_time)
       VALUES (?,?,?,?,?,?,NOW(),NOW())`,
      [req.user.user_id, provider || 'custom', api_url, api_key || '', model, enable]
    )
  }
  ok(res, { api_url }, `AI 接入配置已保存（实际请求地址：${api_url}）`)
}))

// 测试连接：用传入的临时配置做一次最小调用，验证 Token / 地址 / 模型是否有效（不落库）
// 会自动尝试候选地址（补全 /chat/completions、容器内 localhost → host.docker.internal），
// 成功时返回实际可用的 working_url，前端可一键回填。
/**
 * 连接自测：用传入的临时配置发一次最小请求（只让模型回「成功」），不写库。
 * 权限：登录用户；未填地址/模型/密钥时自动用已保存的配置兜底。
 * 逐个尝试候选地址（补全 /chat/completions、容器内 localhost 换 host.docker.internal），
 * 全部失败才报错，并回传尝试链便于排查；maxTokens=16 + retries=0 保证失败得快。
 *
 * @param {import('express').Request} req body: api_url / api_key / model
 * @param {import('express').Response} res { ok, working_url, normalized_url, candidates }
 * @returns {Promise<void>}
 */
router.post('/test', asyncHandler(async (req, res) => {
  let { api_url, api_key, model } = req.body
  if (!api_url || !model) {
    const saved = await ai.loadUserConfig(req.user.user_id)
    if (saved) {
      api_url = api_url || saved.baseURL
      model = model || saved.model
      if (!api_key) api_key = saved.apiKey
    }
  }
  if (!api_url || !model) return fail(res, '请填写 API 地址与模型后再测试（本地模型可留空 Token）')

  const candidates = ai.resolveCandidates(api_url)
  let lastErr = null
  for (const url of candidates) {
    try {
      const text = await ai.chat(
        [{ role: 'user', content: '请只回复两个字：成功' }],
        { baseURL: url, apiKey: api_key, model, maxTokens: 16, retries: 0 }
      )
      return ok(res, {
        ok: true,
        working_url: url,
        normalized_url: ai.normalizeBaseURL(api_url),
        candidates
      }, `连接成功（实际请求：${url}；模型返回：${String(text).slice(0, 20)}）`)
    } catch (e) {
      lastErr = e
    }
  }
  const extra = candidates.length > 1 ? `（已尝试：${candidates.join(' → ')}）` : ''
  fail(res, '连接失败：' + (lastErr ? lastErr.message : '未知错误') + extra, 1)
}))

// 列出该接口可用模型（GET /v1/models），方便用户挑准确模型名
/**
 * 拉取该接口的可用模型清单，避免用户手填模型名拼错后一直调不通。
 * 权限：登录用户；未填地址或密钥时用已保存配置兜底。
 * 兼容 OpenAI 的 data[] 与部分厂商的 models[] 两种返回结构；
 * 接口不支持 /models 时逐个候选地址试完再报错，提示改为手动填写。
 *
 * @param {import('express').Request} req body: api_url / api_key
 * @param {import('express').Response} res { models[], endpoint }
 * @returns {Promise<void>}
 */
router.post('/models', asyncHandler(async (req, res) => {
  let { api_url, api_key } = req.body
  if (!api_url) {
    const saved = await ai.loadUserConfig(req.user.user_id)
    if (saved) {
      api_url = saved.baseURL
      if (!api_key) api_key = saved.apiKey
    }
  }
  if (!api_url) return fail(res, '请先填写 API 地址')

  const candidates = ai.resolveCandidates(api_url).map(ai.modelsURL)
  let lastErr = null
  for (const url of candidates) {
    try {
      const r = await fetch(url, { headers: api_key ? { Authorization: `Bearer ${api_key}` } : {} })
      if (!r.ok) {
        const t = await r.text().catch(() => '')
        lastErr = new Error(`获取模型列表失败（${r.status} @ ${url}）：${t.slice(0, 120)}`)
        continue
      }
      const data = await r.json().catch(() => null)
      const list = (data && (data.data || data.models)) || []
      const models = list.map(x => (typeof x === 'string' ? x : (x.id || x.name))).filter(Boolean)
      if (!models.length) { lastErr = new Error(`接口未返回模型列表（${url}）`); continue }
      return ok(res, { models, endpoint: url }, `已获取 ${models.length} 个可用模型`)
    } catch (e) { lastErr = e }
  }
  fail(res, '获取模型列表失败：' + (lastErr ? lastErr.message : '该接口可能不支持 /models，请手动填写模型名'), 1)
}))

module.exports = router
