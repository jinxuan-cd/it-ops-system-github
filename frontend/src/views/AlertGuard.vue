<!--
  新工单提醒守护页 —— IT 运维工单台账与日报自动管理系统
  可单独开一个小窗口常驻，最小化/切到后台也能收到声音与系统通知

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-11-12　　版本：1.4.2
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="guard">
    <div class="guard-head">
      <div class="g-logo">IT</div>
      <div>
        <h1>新工单提醒守护</h1>
        <p>有人提单，这个窗口会响铃并弹出系统通知</p>
      </div>
    </div>

    <!-- 最新一条：整块红色横幅，比系统通知更抢眼，点开直达工单详情 -->
    <div v-if="latest" class="g-banner" :class="{ test: latest.is_test }" @click="openTicket(latest)">
      <div class="g-banner-title">{{ latest.is_test ? '提醒测试' : '收到新工单' }}</div>
      <div class="g-banner-text">{{ latest.service_content || '点击查看工单详情' }}</div>
      <div class="g-banner-meta">
        <span v-if="!latest.is_test">{{ latest.report_no || '待接单' }}</span>
        <span v-if="latest.contact">{{ latest.contact }}</span>
        <span v-if="latest.dept">{{ latest.dept }}</span>
        <span class="g-go">{{ latest.is_test ? '配置正常' : '点此查看 →' }}</span>
      </div>
    </div>

    <div class="g-card">
      <div class="g-status" :class="{ on: connected }">
        <span class="dot"></span>
        {{ connected ? '已连接，正在监听新工单' : '连接中 / 已断开，正在自动重连' }}
      </div>

      <div class="g-switches">
        <el-switch v-model="prefs.sound" active-text="提示音" @change="onSoundChange" />
        <el-switch v-model="prefs.desktop" active-text="桌面通知" @change="onDesktopChange" />
        <span class="g-perm" :class="permClass">{{ permText }}</span>
      </div>

      <!-- 提示音样式：6 种预设，选中即试听，不用再点按钮确认效果 -->
      <div class="g-style">
        <span class="g-label">提示音样式</span>
        <el-select v-model="prefs.style" size="small" style="width:150px" :disabled="!prefs.sound" @change="onStyleChange">
          <el-option v-for="s in SOUND_STYLES" :key="s.id" :label="s.label" :value="s.id" />
        </el-select>
        <el-button size="small" text :disabled="!prefs.sound" @click="preview"><el-icon><Headset /></el-icon> 试听</el-button>
      </div>

      <div class="g-btns">
        <el-button size="small" @click="unlock"><el-icon><Bell /></el-icon> 开启声音</el-button>
        <el-button size="small" @click="askDesktop"><el-icon><Message /></el-icon> 允许桌面通知</el-button>
        <el-button size="small" type="primary" plain @click="test"><el-icon><VideoPlay /></el-icon> 测试提醒</el-button>
      </div>

      <div class="g-note">
        <p><b>怎么用：</b>把这个页面单独开成一个小窗口，或固定在浏览器标签栏上，然后最小化去做别的事。只要浏览器还开着，即使工单系统的页签没打开、当前在看别的网站，有人提单也会响铃、弹桌面通知、闪烁标题。</p>
        <p><b>重要限制：</b>如果把整个浏览器都关掉，网页就收不到任何消息了——这是浏览器本身的限制，任何网页系统都做不到关机推送。需要「浏览器关了也能收到」时，请到「系统设置 → 消息通知」配置企业微信 / 钉钉群机器人，手机也能收到。</p>
        <p><b>没声音？</b>点一次上面的「开启声音」；桌面通知还要点「允许桌面通知」并在浏览器弹窗里选「允许」。Chrome/Edge 若提示「已被阻止」，请点地址栏左侧图标把通知权限改回允许。</p>
      </div>

      <div class="g-btns">
        <el-button size="small" text @click="openSystem"><el-icon><Monitor /></el-icon> 打开工单系统</el-button>
        <el-button size="small" text @click="copyUrl"><el-icon><Link /></el-icon> 复制本页地址</el-button>
      </div>
    </div>

    <div class="g-card">
      <div class="g-list-title">最近提醒 <span>（最多保留 8 条，刷新后清空）</span></div>
      <div v-if="!history.length" class="g-empty">还没有新工单。可以点「测试提醒」验证配置。</div>
      <div v-for="h in history" :key="h.ticket_id + '-' + (h.alert_at || 0)" class="g-item" @click="openTicket(h)">
        <div class="g-item-main">{{ h.service_content || '新工单' }}</div>
        <div class="g-item-meta">{{ h.report_no || '—' }}　{{ h.contact || '' }}　{{ fmtTime(h.alert_at) }}</div>
      </div>
    </div>

    <div class="g-foot">© 2026 锦轩 · IT 运维工单系统　|　本页只做提醒，不展示业务数据</div>
  </div>
</template>

<script setup>
/**
 * 提醒守护页：不挂主框架，因此页面很轻，可以长期开着不占资源。
 * 它只做三件事：连 SSE、收到 ticket:alert 触发强提醒、把最近几条列出来方便回看。
 */
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { Bell, Message, VideoPlay, Monitor, Link, Headset } from '@element-plus/icons-vue'
import { startRealtime, stopRealtime } from '../utils/realtime'
import {
  getPrefs, savePrefs, unlockAudio, fireStrongAlert, fireTestAlert,
  desktopState, requestDesktop, clearTitleFlash, SOUND_STYLES, previewSound
} from '../utils/strongAlert'

const connected = ref(false)
const prefs = reactive(getPrefs())
const latest = ref(null)
const history = ref([])
const permText = ref(desktopState() === 'granted' ? '已授权' : desktopState() === 'denied' ? '已被拒绝，请在浏览器设置里改回允许' : '未授权')
const permClass = ref(desktopState() === 'granted' ? 'ok' : desktopState() === 'denied' ? 'bad' : '')

// 工单号显示用；alert_at 是后端给的毫秒时间戳
function fmtTime(ts) {
  if (!ts) return ''
  try { return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) } catch (e) { return '' }
}

function openTicket(t) {
  if (!t || t.is_test || !t.ticket_id || t.ticket_id < 0) return
  window.open('/tickets?open=' + t.ticket_id, 'itops_ticket_' + t.ticket_id)
}
function openSystem() { window.open('/dashboard', '_blank') }
function copyUrl() {
  navigator.clipboard?.writeText(location.href).then(
    () => ElMessage.success('已复制，可加到浏览器启动页'),
    () => ElMessage.warning('复制失败，请从地址栏手动复制')
  )
}

function unlock() {
  ElMessage.success(unlockAudio() ? '声音已解锁，之后的提醒会响铃' : '当前浏览器不支持网页声音')
}
async function askDesktop() {
  const p = await requestDesktop()
  permText.value = p === 'granted' ? '已授权' : p === 'denied' ? '已被拒绝，请在浏览器设置里改回允许' : '未授权'
  permClass.value = p === 'granted' ? 'ok' : p === 'denied' ? 'bad' : ''
  if (p === 'granted') {
    prefs.desktop = true
    savePrefs({ desktop: true })
    ElMessage.success('桌面通知已开启')
  } else if (p === 'denied') {
    ElMessage.warning('浏览器拒绝了通知权限，请点地址栏左侧图标手动允许')
  }
}
function test() { unlockAudio(); fireTestAlert() }
// 换样式立即试听：选择器里只有名字，听一遍才知道是不是自己要的
function onStyleChange(v) {
  savePrefs({ style: v })
  if (prefs.sound) previewSound(v)
}
function preview() { previewSound(prefs.style) }
function onSoundChange(v) {
  savePrefs({ sound: v })
  if (v) unlockAudio()
}
async function onDesktopChange(v) {
  if (v && desktopState() !== 'granted') {
    const p = await requestDesktop()
    if (p !== 'granted') { prefs.desktop = false; savePrefs({ desktop: false }); return }
    permText.value = '已授权'
    permClass.value = 'ok'
  }
  savePrefs({ desktop: v })
}

// SSE 事件：connected 用于显示连接状态，ticket:alert 触发强提醒
function onRt(e) {
  const { type, payload } = e.detail || {}
  if (type === 'connected') { connected.value = true; return }
  if (type === 'ticket:alert' && payload) fireStrongAlert(payload)
}
// 强提醒真正落地后（含测试）再更新横幅与历史，保证「没响的那次」不会留下假记录
function onFire(e) {
  const p = e.detail
  if (!p) return
  latest.value = p
  if (!p.is_test) history.value = [p, ...history.value].slice(0, 8)
}
function onVisible() { if (!document.hidden) clearTitleFlash() }

onMounted(() => {
  window.addEventListener('itops:rt', onRt)
  window.addEventListener('itops:alert-fire', onFire)
  document.addEventListener('visibilitychange', onVisible)
  startRealtime()
})
onBeforeUnmount(() => {
  window.removeEventListener('itops:rt', onRt)
  window.removeEventListener('itops:alert-fire', onFire)
  document.removeEventListener('visibilitychange', onVisible)
  clearTitleFlash()
  stopRealtime()
})
</script>

<style scoped>
.guard {
  min-height: 100vh; padding: 18px 14px 30px;
  background: #f4f6fb; color: #1f2937;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
}
.guard-head { display: flex; align-items: center; gap: 12px; max-width: 640px; margin: 0 auto 14px; }
.g-logo {
  width: 44px; height: 44px; border-radius: 12px; flex: none;
  background: #2563eb; color: #fff; font-weight: 700; font-size: 18px;
  display: flex; align-items: center; justify-content: center;
}
.guard-head h1 { margin: 0; font-size: 18px; }
.guard-head p { margin: 2px 0 0; font-size: 12.5px; color: #6b7280; }
.g-card {
  max-width: 640px; margin: 0 auto 12px; padding: 14px 16px;
  background: #fff; border-radius: 14px; box-shadow: 0 6px 24px rgba(31,41,55,.08);
}
.g-banner {
  max-width: 640px; margin: 0 auto 12px; padding: 14px 16px; cursor: pointer;
  border-radius: 14px; background: #e5484d; color: #fff;
  box-shadow: 0 8px 24px rgba(229,72,77,.28);
  animation: g-in .25s ease;
}
.g-banner.test { background: #2563eb; box-shadow: 0 8px 24px rgba(37,99,235,.24); }
@keyframes g-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
.g-banner-title { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
.g-banner-text { font-size: 13.5px; line-height: 1.5; }
.g-banner-meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; opacity: .92; margin-top: 8px; }
.g-go { margin-left: auto; font-weight: 600; }
.g-status { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #6b7280; margin-bottom: 12px; }
.g-status .dot { width: 9px; height: 9px; border-radius: 50%; background: #f0a020; }
.g-status.on { color: #17a673; }
.g-status.on .dot { background: #17a673; }
.g-switches { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-bottom: 12px; }
.g-style { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.g-label { font-size: 13px; color: #4b5563; }
.g-perm { font-size: 12px; color: #6b7280; }
.g-perm.ok { color: #17a673; }
.g-perm.bad { color: #e5484d; }
.g-btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.g-note { border-top: 1px solid #e5e7eb; margin-top: 14px; padding-top: 10px; }
.g-note p { font-size: 12.5px; line-height: 1.75; color: #4b5563; margin: 6px 0; }
.g-note b { color: #1f2937; }
.g-list-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.g-list-title span { font-size: 12px; font-weight: 400; color: #6b7280; }
.g-empty { font-size: 12.5px; color: #6b7280; padding: 8px 0; }
.g-item { padding: 9px 10px; border: 1px solid #e5e7eb; border-radius: 9px; margin-bottom: 8px; cursor: pointer; }
.g-item:hover { border-color: #2563eb; background: #f7faff; }
.g-item-main { font-size: 13px; font-weight: 600; }
.g-item-meta { font-size: 11.5px; color: #6b7280; margin-top: 3px; }
.g-foot { max-width: 640px; margin: 16px auto 0; text-align: center; font-size: 11.5px; color: #9ca3af; }
</style>
