/**
 * @file frontend/src/utils/realtime.js
 * @description 订阅 SSE 事件流，断线自动重连并分发业务事件
 *
 * 实时推送客户端 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 前端实时消息（SSE）：全局只建一条连接，收到事件后以 window 事件 'itops:rt' 分发给各组件
// 用法：window.addEventListener('itops:rt', e => { const { type, payload } = e.detail })
// 断线由浏览器 EventSource 自动重连，不需要自己写重试逻辑

// 单例连接：整个应用只开一条 SSE，避免每个组件各自订阅把浏览器并发连接数占满
let es = null
let started = false

// 需要转发给组件的事件白名单，名字与后端 push 的事件名一一对应；
// 没列出来的事件不会绑监听，新增推送类型要同时改这里
const EVENTS = ['ticket:new', 'ticket:taken', 'ticket:released', 'ticket:mine', 'ticket:done', 'ticket:alert']

// 用 window 自定义事件做分发：订阅方（待办面板、接单弹窗）只在挂载期间加监听，
// 卸载时移除即可，不需要关心连接本身的生命周期
function emit(type, payload) {
  window.dispatchEvent(new CustomEvent('itops:rt', { detail: { type, payload } }))
}

export function startRealtime() {
  const token = localStorage.getItem('itops_token')
  // 没登录不连；已连过直接返回，保证幂等（主框架重挂载不会重复建连）
  if (!token || started) return
  started = true
  try {
    // token 只能放 query：EventSource 不支持自定义请求头，后端从 query 里取并校验
    es = new EventSource(`/api/realtime/stream?token=${encodeURIComponent(token)}`)
  } catch (e) {
    // 构造失败（如被浏览器策略拦截）必须复位标记，否则后续再调 startRealtime 会一直空转
    started = false
    return
  }
  for (const name of EVENTS) {
    es.addEventListener(name, (e) => {
      // 推送体是 JSON 字符串；单条解析失败只丢这条，不能让整个连接报错
      let data = null
      try { data = JSON.parse(e.data) } catch (err) { data = null }
      emit(name, data)
    })
  }
  // 首次连上以及每次断线重连成功都会触发，组件可据此在断线期间补一次全量拉取
  es.onopen = () => emit('connected', null)
}

// 退出登录或离开主框架时调用：主动 close 防止浏览器按默认策略一直重连
export function stopRealtime() {
  if (es) { es.close(); es = null }
  started = false
}
