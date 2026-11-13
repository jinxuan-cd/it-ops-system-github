/**
 * @file backend/src/utils/helpers.js
 * @description 统一响应体（ok/fail）、异步异常包装、JSON 安全解析、时间格式化
 *
 * 通用工具 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 通用工具：统一响应、异步包装、安全解析 JSON 字段

/**
 * 成功响应：统一 `{ code: 0, message, data }` 信封。
 * 前端 axios 拦截器只认 code，因此 data 必须是可序列化的对象或 null。
 *
 * @param {import('express').Response} res
 * @param {*} [data] 业务数据
 * @param {string} [message] 提示文案
 * @returns {void}
 */
function ok(res, data = null, message = 'success') {
  res.json({ code: 0, message, data })
}

/**
 * 失败响应：`{ code, message, data: null }`。
 *
 * 注意 status 默认 200：业务失败（校验不通过、无权限）多数走 200 + 非零 code，
 * 由前端统一弹出 message；只有鉴权失败等需要网关/浏览器识别的场景才显式传 4xx。
 * 改默认值会让所有前端拦截逻辑失效。
 *
 * @param {import('express').Response} res
 * @param {string} [message] 给用户看的错误文案
 * @param {number} [code=1] 业务错误码
 * @param {number} [status=200] HTTP 状态码
 * @returns {void}
 */
function fail(res, message = 'error', code = 1, status = 200) {
  res.status(status).json({ code, message, data: null })
}

// 包装 async 路由，自动捕获异常
/**
 * 包装 async 路由处理函数，把 rejected Promise 转交给 Express 的错误中间件。
 *
 * 为什么需要：Express 4 不会自动捕获 async 函数里的异常，
 * 不包一层的话「await 抛错」会让请求一直挂起直到超时，而不是返回 500。
 *
 * @param {Function} fn 路由处理函数
 * @returns {Function} 可直接注册到 router 的同步包装版
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

// 安全解析 JSON（mysql2 已解析 JSON 列，这里兜底字符串情况）
/**
 * 宽松解析 JSON 字段：解析失败返回 null 而不是抛错。
 * 用于 items / stages / duty_contacts 这类历史遗留字段——
 * 早期版本以 TEXT 存 JSON，手工改库或截断会产生非法 JSON，
 * 这里吞掉异常，让列表页照常渲染而不是整页 500。
 *
 * @param {*} val 可能是对象、JSON 字符串或 null
 * @returns {*} 解析结果，失败为 null
 */
function safeJson(val) {
  if (val == null) return null
  if (typeof val === 'string') {
    try { return JSON.parse(val) } catch (e) { return null }
  }
  return val
}

// 本机时区的「今天 / 现在」字符串。
// 不能用 toISOString()：那是 UTC，北京时间 00:00-08:00 之间会算成前一天。
function pad2(n) { return String(n).padStart(2, '0') }
/**
 * 本机时区的日期串 'YYYY-MM-DD'。
 * 所有报表、日报、待办日期都走这里，保证「今天」的判定与数据库 CURDATE() 口径一致。
 *
 * @param {Date} [d] 默认当前时间，传参便于测试与补数据
 * @returns {string}
 */
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
/**
 * 本机时区的日期时间串 'YYYY-MM-DD HH:mm:ss'，可直接写入 DATETIME 列。
 *
 * @param {Date} [d] 默认当前时间
 * @returns {string}
 */
function nowStr(d = new Date()) {
  return `${todayStr(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

module.exports = { ok, fail, asyncHandler, safeJson, todayStr, nowStr }
