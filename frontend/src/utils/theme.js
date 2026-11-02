/**
 * @file frontend/src/utils/theme.js
 * @description 明暗主题切换与本地记忆
 *
 * 主题管理 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 主题工具：把主色应用到「整个系统」（含 Element Plus 派生色），并支持深浅模式
// 主题只存 localStorage：这是纯前端展示偏好，不需要进后端，换设备重设一次即可
const STORE_KEY = 'itops_theme'

// 解析 #rgb / #rrggbb。派生色要在运行时算，所以必须先拿回三个通道值
function hexToRgb(hex) {
  let h = (hex || '').replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const num = parseInt(h, 16)
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
}

// 将 color 向 target(白/黑) 混合 ratio 比例
function mix(color, target, ratio) {
  const c = hexToRgb(color)
  const t = hexToRgb(target)
  const r = Math.round(c.r + (t.r - c.r) * ratio)
  const g = Math.round(c.g + (t.g - c.g) * ratio)
  const b = Math.round(c.b + (t.b - c.b) * ratio)
  return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`
}

// 应用主色到整站：覆盖自定义变量 + Element Plus 全部派生色
export function setTheme(primary) {
  // 空值直接返回：把 CSS 变量设成 undefined 会让整站配色失效且难以排查
  if (!primary) return
  const root = document.documentElement
  root.style.setProperty('--it-primary', primary)
  root.style.setProperty('--el-color-primary', primary)
  // Element Plus 各状态派生色（构建期由 SCSS 生成，运行时需手动同步）
  root.style.setProperty('--el-color-primary-light-3', mix(primary, '#ffffff', 0.3))
  root.style.setProperty('--el-color-primary-light-5', mix(primary, '#ffffff', 0.5))
  root.style.setProperty('--el-color-primary-light-7', mix(primary, '#ffffff', 0.7))
  root.style.setProperty('--el-color-primary-light-8', mix(primary, '#ffffff', 0.8))
  root.style.setProperty('--el-color-primary-light-9', mix(primary, '#ffffff', 0.9))
  root.style.setProperty('--el-color-primary-dark-2', mix(primary, '#000000', 0.2))
  // 系统自定义浅色（卡片标题左侧色条、浅底标签等）
  root.style.setProperty('--it-primary-light', mix(primary, '#ffffff', 0.9))
  // 左侧菜单栏底色：由主色派生出的深色，使整个页面（含菜单）随主题变化
  root.style.setProperty('--it-sidebar-bg', mix(primary, '#0b0f17', 0.78))
  root.style.setProperty('--it-sidebar-bg-2', mix(primary, '#05080d', 0.86))
}

// 深浅模式：切换 <html class="dark">（配合 Element Plus 官方暗色 css-vars）
export function setMode(mode) {
  const root = document.documentElement
  if (mode === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
}

// 读取并应用已保存的主题（启动时调用）
// main.js 在 mount 之前就调用它：先上色再渲染，避免首屏闪一下默认蓝再跳成用户色
export function applyTheme() {
  let saved = null
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') } catch (e) {}
  // 没有保存过（首次使用 / 存储被清）时用默认品牌蓝 + 浅色
  if (!saved) saved = { primary: '#2f6fed', mode: 'light' }
  setTheme(saved.primary)
  setMode(saved.mode)
  return saved
}

// 保存并立即生效：先读旧值再合并，调用方只改其中一个维度时另一个保持不变
export function saveTheme(primary, mode) {
  const cur = applyTheme()
  const next = { primary: primary || cur.primary, mode: mode || cur.mode }
  localStorage.setItem(STORE_KEY, JSON.stringify(next))
  setTheme(next.primary)
  setMode(next.mode)
  return next
}

// 只读当前主题（不产生副作用），设置页用来回显表单初始值
export function getTheme() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') } catch (e) { return null }
}
