/**
 * @file backend/src/utils/ai.js
 * @description OpenAI 兼容协议调用，多候选地址自动回退、HTTP 错误中文化、支持文本与图片理解
 *
 * 大模型调用封装 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// OpenAI 兼容接口封装：可对接 DeepSeek / 通义千问 / Kimi / OpenAI / OpenRouter / LM Studio / Ollama / vLLM / 内网私有化大模型等
// 配置为「每用户独立」，由前端在「AI 助手」中设置，不使用全局环境变量（避免多人共用同一 Token）。
//
// 两个高频踩坑点（本文件负责自动兜底）：
//   1) 用户只填了 http://host:1234/v1  → 自动补全为 /v1/chat/completions
//   2) 后端跑在 Docker 里，localhost 指向容器自身 → 自动改写为 host.docker.internal
const fs = require('fs')
const { query } = require('../db')

// 是否运行在容器内（Docker Desktop / Linux 均可）
const IN_DOCKER = process.env.IN_DOCKER === '1' || (() => {
  try { return fs.existsSync('/.dockerenv') } catch (e) { return false }
})()
// 容器内用于访问宿主机的别名；置空字符串可关闭自动改写
const LOCAL_ALIAS = process.env.AI_LOCALHOST_ALIAS !== undefined ? process.env.AI_LOCALHOST_ALIAS : 'host.docker.internal'

/**
 * 补全 OpenAI 兼容端点路径：
 *   http://h:1234            → http://h:1234/v1/chat/completions
 *   http://h:1234/v1         → http://h:1234/v1/chat/completions
 *   http://h:1234/v1/        → http://h:1234/v1/chat/completions
 *   http://h:1234/v1/chat/completions → 原样
 *   https://api.deepseek.com/v1/chat/completions → 原样
 *
 * 只认 OpenAI 兼容协议，因此不做供应商特判，靠路径形态推断即可；
 * 入参允许只填主机和端口，甚至是裸域名。
 *
 * @param {string} raw 用户填写的接口地址，允许省略协议与路径
 * @returns {string} 完整端点；入参为空返回 ''（调用方据此判定「未配置」）
 */
function normalizeBaseURL(raw) {
  let u = String(raw || '').trim().replace(/\s+/g, '')
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u
  u = u.replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(u)) return u

  const m = u.match(/^(https?:\/\/[^/]+)(\/.*)?$/i)
  if (!m) return u
  const origin = m[1]
  let path = (m[2] || '').replace(/\/+$/, '')
  if (!path) return `${origin}/v1/chat/completions`
  if (/\/completions$/i.test(path)) return `${origin}${path.replace(/\/completions$/i, '/chat/completions')}`
  if (/\/v\d+$/i.test(path)) return `${origin}${path}/chat/completions`
  return `${origin}${path}/chat/completions`
}

// 把 localhost / 127.0.0.1 换成就宿主机别名（仅在容器内启用）
/**
 * 把本机回环地址改写成宿主机别名。
 *
 * 为什么要这一步：用户在宿主机上跑 LM Studio / Ollama，习惯填 http://localhost:1234/v1；
 * 但后端跑在容器里时 localhost 指容器自身，请求必然 connection refused。
 * 只有容器内才改写——宿主机直跑时 localhost 就是对的，改了反而连不上。
 * LOCAL_ALIAS 置空可整体关闭该行为（例如容器也用了 host 网络）。
 *
 * @param {string} u 完整端点地址
 * @returns {string} 改写后的地址，无需改写时原样返回
 */
function withHostAlias(u) {
  if (!LOCAL_ALIAS) return u
  return u.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?=[:/]|$)/i, `$1${LOCAL_ALIAS}`)
}

// 生成候选地址：容器内优先「改写后的宿主机地址」，再退原始地址
/**
 * 生成按优先级排序的候选地址列表（去重）。
 *
 * 回退策略：容器内把「宿主机别名版」排前面、原始地址作兜底；
 * 宿主机直跑时反过来，把 host.docker.internal 版改写回 localhost 追加在后面。
 * 这样同一份配置在「docker 部署」和「本地 node 直跑」两种形态下都能命中，
 * 不必要求用户为两种环境各填一遍地址。
 *
 * @param {string} rawURL 用户填写的地址
 * @returns {string[]} 候选端点，首个为首选；空配置返回 []
 */
function resolveCandidates(rawURL) {
  const norm = normalizeBaseURL(rawURL)
  if (!norm) return []
  const list = [norm]
  if (IN_DOCKER) {
    const aliased = withHostAlias(norm)
    if (aliased !== norm) list.unshift(aliased)
  } else {
    const local = norm.replace(/^(https?:\/\/)host\.docker\.internal(?=[:/]|$)/i, '$1localhost')
    if (local !== norm) list.push(local)
  }
  return [...new Set(list)]
}

// 首选地址（真实调用用这个）
/**
 * 取候选列表的第一项，即实际发请求用的地址。
 *
 * @param {string} rawURL 用户填写的地址
 * @returns {string} 首选端点，未配置返回 ''
 */
function resolveURL(rawURL) {
  const list = resolveCandidates(rawURL)
  return list[0] || ''
}

// 由 chat 端点推导模型列表端点
/**
 * 由 chat 端点反推 /models，供「获取模型列表」按钮使用。
 * 依赖路径约定（…/chat/completions），因此只对已归一化的地址可靠。
 *
 * @param {string} u 已归一化的端点
 * @returns {string} 模型列表端点
 */
function modelsURL(u) {
  return String(u || '').replace(/\/chat\/completions$/i, '/models')
}

// 从供应商返回体里提取可读信息（OpenRouter / OpenAI / 通义 / LM Studio 等格式兼容）
/**
 * 从各家供应商的错误返回体里挖出一句可读原因。
 * 各家字段不统一：OpenAI 用 error.message，OpenRouter 还会把上游原文塞进
 * error.metadata.raw，部分网关只给 message / detail，故按优先级逐个尝试。
 *
 * @param {string} rawText 响应原文
 * @returns {string} 可读原因；非 JSON 时返回原文
 */
function extractDetail(rawText) {
  const raw = String(rawText || '').trim()
  if (!raw) return ''
  try {
    const j = JSON.parse(raw)
    const err = j.error
    if (err) {
      if (typeof err === 'string') return err
      let msg = err.message || err.code || ''
      if (err.metadata && err.metadata.raw) msg = `${msg}${msg ? '：' : ''}${err.metadata.raw}`
      if (msg) return String(msg)
    }
    if (j.message) return String(j.message)
    if (j.detail) return String(j.detail)
  } catch (e) { /* 非 JSON，直接返回原文 */ }
  return raw
}

// 把 HTTP 错误翻译成用户能看懂的说明（附带实际请求地址与供应商原文，便于排查）
/**
 * 把状态码翻译成可操作的中文提示。
 *
 * 为什么不用通用文案：接大模型时最常见的问题是地址、模型名、额度、限流四类，
 * 用户看不懂 404/429，必须直接告诉他「改哪里」。因此错误对象上额外挂了
 * status / aiDetail / url 三个字段，前端可原样展示或折叠查看。
 *
 * @param {number} status HTTP 状态码
 * @param {string} rawText 响应原文
 * @param {string} model 本次请求的模型名
 * @param {string} url 本次实际请求的地址
 * @returns {Error} 带 status / aiDetail / url 的 Error 实例
 */
function friendlyHttpError(status, rawText, model, url) {
  const detail = extractDetail(rawText).slice(0, 300)
  const tail = detail ? `（供应商返回：${detail}）` : ''
  const where = url ? `请求地址：${url}；` : ''
  const m = model ? `当前模型：${model}` : ''
  let msg
  switch (status) {
    case 429:
      msg = `AI 服务繁忙，触发限流（429）。免费/共享模型经常被上游限流，请稍等几十秒后重试，或改用付费模型 / 自己的 API Key / 换一个供应商。${where}${m}${tail}`
      break
    case 401:
      msg = `AI 鉴权失败（401）：Token 无效或已过期，请到「AI 助手」检查 Token 是否填写完整。${where}${m}${tail}`
      break
    case 403:
      msg = `AI 拒绝访问（403）：该 Token 没有调用此模型的权限，或所在地区被限制。${where}${m}${tail}`
      break
    case 402:
      msg = `AI 账户额度不足（402）：请充值或更换供应商 / 模型。${where}${m}${tail}`
      break
    case 404:
      msg = `AI 接口地址或模型不存在（404）：请确认地址是 OpenAI 兼容的 /v1/chat/completions（只填 /v1 不行，系统已自动补全仍 404 时请核对端口与服务是否启动）。${where}${m}${tail}`
      break
    case 400:
    case 422:
      msg = `AI 请求参数有误（${status}）：常见原因是模型名与该服务不匹配、该模型不支持系统提示或 max_tokens 超限。${where}${m}${tail}`
      break
    default:
      if (status >= 500) msg = `AI 服务端异常（${status}）：供应商临时故障，请稍后重试或更换供应商。${where}${m}${tail}`
      else msg = `AI 接口请求失败（${status}）。${where}${m}${tail}`
  }
  const e = new Error(msg)
  e.status = status
  e.aiDetail = detail
  e.url = url
  return e
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * 发起一次对话补全（OpenAI 兼容 /chat/completions）。
 *
 * @param {Array<{role:string, content:*}>} messages 对话消息，system/user/assistant 顺序由调用方组织
 * @param {object} [opts]
 * @param {string} opts.baseURL 用户配置的接口地址（可只填到 /v1，内部会自动补全）
 * @param {string} [opts.apiKey] Token；本地模型可留空，此时不发 Authorization 头
 * @param {string} opts.model 模型名
 * @param {number} [opts.temperature=0.4] 温度，工单总结类任务默认偏低以保证稳定
 * @param {number} [opts.maxTokens=2000] 输出上限
 * @param {number} [opts.retries=2] 限流/5xx 的重试次数（指数退避）
 * @param {number} [opts.retryDelay=1200] 首次退避基准毫秒数
 * @returns {Promise<string>} 模型返回的纯文本（已 trim）
 * @throws {Error} 未配置时带 noConfig；网络不可达带 network + status=0；HTTP 错误带 status/aiDetail/url
 *
 * 重试口径：仅 429 / 408 / 5xx 重试；401/403/404 这类配置错误重试毫无意义，
 * 会白白多等好几秒还掩盖真实原因。网络层异常同样直接抛出，交给用户改地址。
 */
async function chat(messages, {
  baseURL,
  apiKey,
  model,
  temperature = 0.4,
  maxTokens = 2000,
  retries = 2,
  retryDelay = 1200
} = {}) {
  if (!baseURL || !model) {
    const e = new Error('AI 未配置：请在本人「AI 助手」中设置接口地址与模型')
    e.noConfig = true
    throw e
  }

  // 本地模型（LM Studio / Ollama / vLLM）通常不需要 Token，未填则不带 Authorization
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  // 地址自动纠偏：补全 /chat/completions；容器内把 localhost 换成宿主机别名
  const url = resolveURL(baseURL)
  let lastErr = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    let res
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens })
      })
    } catch (err) {
      // 网络层失败（DNS / 端口未监听 / 证书 / 代理 / 超时）不重试，直接给出可操作提示
      const e = new Error(
        `无法连接 AI 服务：${err.message}。已尝试请求 ${url}。请确认该地址可从服务器访问（AI 服务跑在宿主机时不要写 localhost，容器内指向容器自身，请用 host.docker.internal 或局域网 IP），并确认端口已放通。`
      )
      e.status = 0
      e.network = true
      e.url = url
      throw e
    }

    if (res.ok) {
      const data = await res.json().catch(() => null)
      const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
      if (content == null || content === '') {
        const e = new Error(`AI 返回内容为空：可能是模型不支持该请求格式，或触发了内容过滤。（请求地址：${url}）`)
        e.status = res.status
        e.url = url
        throw e
      }
      return String(content).trim()
    }

    const text = await res.text().catch(() => '')
    lastErr = friendlyHttpError(res.status, text, model, url)

    // 仅对「限流 / 供应商临时故障」做退避重试
    const retriable = res.status === 429 || res.status === 408 || res.status >= 500
    if (retriable && attempt < retries) {
      await sleep(retryDelay * Math.pow(2, attempt))
      continue
    }
    throw lastErr
  }
  throw lastErr || new Error('AI 接口请求失败')
}

// 读取某用户生效中的 AI 配置（未启用或无地址返回 null，调用方降级为规则汇总）
// 注意：本地模型（LM Studio / Ollama）不需要 Token，因此 api_key 允许为空
/**
 * 读取指定用户当前生效的 AI 配置。
 *
 * 设计为「每用户独立」：多人共用一套 Token 会互相打爆额度，也无法审计用量。
 * 返回 null 是正常分支而非异常——调用方据此走规则汇总/模板生成，功能降级但不报错。
 *
 * @param {number} userId 用户 ID
 * @returns {Promise<{provider:string, baseURL:string, apiKey:string, model:string}|null>}
 */
async function loadUserConfig(userId) {
  const rows = await query(
    'SELECT provider, api_url, api_key, model, is_enable FROM user_ai_config WHERE user_id = ?',
    [userId]
  )
  if (!rows.length) return null
  const c = rows[0]
  if (!c.is_enable || !c.api_url || !c.model) return null
  return {
    provider: c.provider,
    baseURL: c.api_url,
    apiKey: c.api_key || '',
    model: c.model
  }
}

module.exports = {
  chat,
  loadUserConfig,
  normalizeBaseURL,
  resolveURL,
  resolveCandidates,
  modelsURL,
  IN_DOCKER,
  LOCAL_ALIAS
}
