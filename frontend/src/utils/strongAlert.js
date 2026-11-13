/**
 * @file frontend/src/utils/strongAlert.js
 * @description 新工单强提醒：提示音、浏览器桌面通知、标题闪烁与偏好设置的统一入口
 *
 * 强提醒工具 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-11-12
 */
// 为什么单独一层：右下角弹窗只在「后台页面开着」时存在，而声音/桌面通知/标题闪烁
// 还要在「提醒守护页」里复用。两边共用同一套偏好与去重，避免开两个窗口就响两次。
//
// 提示音用 Web Audio 现场合成，不引入 mp3 资源：私有化部署不需要额外静态文件，
// 也不会因为构建产物变化导致 404。浏览器自动播放策略要求「用户先交互过一次」，
// 所以模块加载时就挂一次性的 pointerdown/keydown 解锁。

const PREFS_KEY = 'itops_strong_alert_prefs'
const DEDUP_KEY = 'itops_strong_alert_dedup'
// style = 提示音样式 id，见下面 SOUND_STYLES；老版本存的是 sound:true/false，缺 style 时回落到默认铃声
const DEFAULTS = { sound: true, style: 'dingdong', desktop: false, volume: 0.7 }

/**
 * 可选提示音样式。
 * 全部用「频率 + 时长」描述，播放时现场合成：不引入 mp3 静态资源，
 * 私有化部署不挑环境，也不会因为构建产物变化导致 404。
 * 加急/高优先级会自动把整段重复一遍，与样式无关。
 *
 * @type {Array<{id:string,label:string,desc:string,wave:OscillatorType,notes:Array<[number,number,number]>}>}
 * notes 每项 = [频率 Hz（0 表示停顿）, 相对开始的偏移秒, 持续秒]
 */
export const SOUND_STYLES = [
  { id: 'dingdong', label: '叮咚（默认）', desc: '两声下行，最不打扰', wave: 'sine', notes: [[880, 0, 0.18], [1175, 0.24, 0.18]] },
  { id: 'chime', label: '清脆铃声', desc: '三声上行，辨识度高', wave: 'sine', notes: [[1318, 0, 0.12], [1568, 0.15, 0.12], [2093, 0.3, 0.3]] },
  { id: 'bell', label: '双铃', desc: '一高一低，像门铃', wave: 'triangle', notes: [[1046, 0, 0.2], [784, 0.26, 0.34]] },
  { id: 'pulse', label: '电子提示', desc: '短促两声，办公室环境清楚', wave: 'square', notes: [[660, 0, 0.09], [0, 0.12, 0.05], [660, 0.2, 0.09]] },
  { id: 'alarm', label: '警示音', desc: '四声急促，适合吵闹环境', wave: 'triangle', notes: [[740, 0, 0.13], [988, 0.16, 0.13], [740, 0.32, 0.13], [988, 0.48, 0.22]] },
  { id: 'soft', label: '轻柔', desc: '低音量长音，安静工位用', wave: 'sine', notes: [[587, 0, 0.28], [698, 0.3, 0.42]] }
]

/** 取某个样式定义；id 不存在（旧配置/手改 localStorage）时回落到第一项 */
export function soundStyle(id) {
  return SOUND_STYLES.find(s => s.id === id) || SOUND_STYLES[0]
}

/** 读取提醒偏好；本地存储损坏时回退默认值，不让提醒功能整个挂掉 */
export function getPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }
  } catch (e) {
    return { ...DEFAULTS }
  }
}

/** 合并写入提醒偏好，返回合并后的完整值 */
export function savePrefs(patch) {
  const next = { ...getPrefs(), ...patch }
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)) } catch (e) { /* 隐私模式下忽略 */ }
  return next
}

let ctx = null
function ensureCtx() {
  if (ctx) return ctx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  try { ctx = new AC() } catch (e) { return null }
  return ctx
}

/**
 * 在用户手势里解锁音频上下文（浏览器自动播放策略）。
 * 播一段几乎听不见的静音，确保后续后台标签页也能出声。
 * @returns {boolean} 浏览器是否支持并成功创建上下文
 */
export function unlockAudio() {
  const c = ensureCtx()
  if (!c) return false
  if (c.state === 'suspended') c.resume().catch(() => {})
  try {
    const osc = c.createOscillator()
    const g = c.createGain()
    g.gain.value = 0.0001
    osc.connect(g).connect(c.destination)
    osc.start()
    osc.stop(c.currentTime + 0.01)
  } catch (e) { /* 单个浏览器兼容问题不影响其它提醒通道 */ }
  return true
}

function beep(c, freq, at, dur, vol, wave = 'sine') {
  // 频率 0 当作休止符：留白也是节奏的一部分（如「电子提示」两声之间的停顿）
  if (!freq) return
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = wave
  osc.frequency.setValueAtTime(freq, at)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.linearRampToValueAtTime(vol, at + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  osc.connect(gain).connect(c.destination)
  osc.start(at)
  osc.stop(at + dur + 0.02)
}

/**
 * 播放提示音。
 * @param {string} priority low/normal/high/urgent —— 加急与高优先级会整段重复一遍
 * @param {string} [styleId] 指定样式；不传则用本机偏好里的 style
 * @returns {void}
 */
export function playSound(priority = 'normal', styleId) {
  const c = ensureCtx()
  if (!c) return
  if (c.state === 'suspended') c.resume().catch(() => {})
  const st = soundStyle(styleId || getPrefs().style)
  const vol = Math.max(0.05, Math.min(0.4, 0.25 * (getPrefs().volume || 0.7)))
  const t0 = c.currentTime + 0.03
  const seq = st.notes
  // 每段总长 = 最后一个音符的「偏移 + 时长」，重复时从这里接着排
  const span = seq.reduce((m, n) => Math.max(m, n[1] + n[2]), 0) + 0.18
  const runs = (priority === 'urgent' || priority === 'high') ? 2 : 1
  for (let r = 0; r < runs; r++) {
    for (const [f, off, dur] of seq) {
      try { beep(c, f, t0 + r * span + off, dur, vol, st.wave) } catch (e) { /* 单个音符失败不中断 */ }
    }
  }
}

/**
 * 试听某个样式（设置页/守护页的「试听」按钮）。
 * 只响一遍、不受加急逻辑影响，便于对比挑选。
 *
 * @param {string} styleId 样式 id
 * @returns {void}
 */
export function previewSound(styleId) {
  unlockAudio()
  playSound('normal', styleId)
}

/** 浏览器桌面通知权限状态：unsupported / default / granted / denied */
export function desktopState() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

/** 申请桌面通知权限；必须由用户点击触发，返回最终状态 */
export async function requestDesktop() {
  if (!('Notification' in window)) return 'unsupported'
  try { return await Notification.requestPermission() } catch (e) { return 'denied' }
}

function showDesktop(p) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const urgent = p.priority === 'urgent' || p.priority === 'high'
  const title = (urgent ? '【加急新工单】' : '【新工单】') + (p.report_no || '待处理')
  const body = [
    (p.service_content || '有人提交了新工单').slice(0, 90),
    p.contact ? `报障人：${p.contact}${p.dept ? '（' + p.dept + '）' : ''}` : '',
    p.app_system ? `相关系统：${p.app_system}` : ''
  ].filter(Boolean).join('\n')
  try {
    // requireInteraction：通知不会自动收起，人在别的标签页也不会错过
    const n = new Notification(title, {
      body,
      tag: 'itops-ticket-' + p.ticket_id,
      requireInteraction: true
    })
    n.onclick = () => {
      window.focus()
      clearTitleFlash()
      if (p.ticket_id) window.open('/tickets?open=' + p.ticket_id, 'itops_ticket_' + p.ticket_id)
      n.close()
    }
  } catch (e) { /* 某些浏览器要求 Service Worker，忽略即可，还有声音与页面横幅 */ }
}

let titleTimer = null
let origTitle = null
/** 停止标题闪烁并还原原标题 */
export function clearTitleFlash() {
  if (titleTimer) { clearInterval(titleTimer); titleTimer = null }
  if (origTitle !== null) { document.title = origTitle; origTitle = null }
}
function flashTitle(text) {
  clearTitleFlash()
  origTitle = document.title
  let on = false
  titleTimer = setInterval(() => {
    on = !on
    document.title = on ? text : origTitle
  }, 900)
  // 最多闪 30 秒，避免人不在电脑前时标题永远闪下去
  setTimeout(clearTitleFlash, 30000)
}

/**
 * 跨标签页去重：同一张工单在 4 秒内只强提醒一次。
 * 员工提单会广播给所有在线连接，同一个人开了后台 + 守护页两个窗口时不该响两遍。
 */
function dedup(ticketId) {
  try {
    const raw = JSON.parse(localStorage.getItem(DEDUP_KEY) || '{}')
    const now = Date.now()
    if (raw.id === ticketId && now - (raw.ts || 0) < 4000) return false
    localStorage.setItem(DEDUP_KEY, JSON.stringify({ id: ticketId, ts: now }))
  } catch (e) { /* 存储不可用时退化为不做去重 */ }
  return true
}

/**
 * 触发一次完整强提醒：声音 + 桌面通知 + 标题闪烁 + 页面内横幅事件。
 * 即使声音与桌面通知都关掉，仍会派发 itops:alert-fire，保证页面内的视觉提示不丢。
 *
 * @param {object} p ticket:alert 的事件体
 * @returns {void}
 */
export function fireStrongAlert(p) {
  if (!p || !p.ticket_id) return
  // 去重只拦「声音和桌面通知」：同一个人同时开着后台 + 守护小窗时不该响两遍；
  // 但页面内横幅要照常弹——万一常驻小窗在另一块屏幕上，主页面也不能静悄悄地什么都不显示。
  if (dedup(p.ticket_id)) {
    const prefs = getPrefs()
    if (prefs.sound) playSound(p.priority)
    if (prefs.desktop) showDesktop(p)
  }
  flashTitle('【新工单】' + (p.service_content || '').slice(0, 18))
  window.dispatchEvent(new CustomEvent('itops:alert-fire', { detail: p }))
}

/** 手动测试：不走去重，也不写进工单历史，纯粹验证声音/通知/横幅是否生效 */
export function fireTestAlert() {
  const fake = {
    ticket_id: -1,
    report_no: 'TEST',
    service_content: '这是一条提醒测试，收到就说明声音与弹窗配置正常',
    contact: '系统',
    dept: '',
    app_system: '',
    priority: 'normal',
    happen_time: '',
    is_test: true
  }
  playSound('normal')
  if (getPrefs().desktop) showDesktop(fake)
  flashTitle('【提醒测试】新工单')
  window.dispatchEvent(new CustomEvent('itops:alert-fire', { detail: fake }))
}

// 页面任意一次点击/按键就解锁音频；capture + once 保证只跑一次且不会被业务代码 stopPropagation 挡掉
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { unlockAudio() }, { once: true, capture: true })
  window.addEventListener('keydown', () => { unlockAudio() }, { once: true, capture: true })
  // 从别的标签页切回来时不再闪标题（人已经看到了）
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) clearTitleFlash()
  })
}
