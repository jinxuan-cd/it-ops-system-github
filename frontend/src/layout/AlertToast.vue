<!--
  新工单强提醒横幅 —— IT 运维工单台账与日报自动管理系统
  任意页面收到 ticket:alert 时在右下角弹出，点击直达工单详情

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-11-12　　版本：1.4.2
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <!-- 强提醒横幅：声音/桌面通知由 strongAlert 负责，这里只做「人在电脑前一定能看见」的那一层 -->
  <transition name="at">
    <div v-if="current" class="alert-toast" :class="{ urgent: isUrgent, test: current.is_test }" @mouseenter="hold" @mouseleave="resume">
      <div class="at-head">
        <span class="at-dot"></span>
        <span class="at-title">{{ current.is_test ? '提醒测试' : (isUrgent ? '加急新工单' : '收到新工单') }}</span>
        <span v-if="more > 0" class="at-more">+{{ more }}</span>
        <el-icon class="at-close" title="关闭" @click.stop="dismiss"><Close /></el-icon>
      </div>

      <div class="at-body" @click="open">
        <div class="at-text">{{ current.service_content || '有人提交了新工单，点击查看详情' }}</div>
        <div class="at-meta">
          <span v-if="!current.is_test && current.report_no" class="at-no">{{ current.report_no }}</span>
          <span v-if="current.contact">{{ current.contact }}</span>
          <span v-if="current.dept">{{ current.dept }}</span>
          <span v-if="current.app_system">{{ current.app_system }}</span>
          <span v-if="current.happen_time" class="at-time">{{ current.happen_time }}</span>
        </div>
      </div>

      <div class="at-ops">
        <el-button v-if="!current.is_test" type="primary" size="small" @click.stop="open">查看工单</el-button>
        <el-button size="small" text @click.stop="dismiss">{{ more > 0 ? '下一条' : '知道了' }}</el-button>
        <!-- 关掉的是「本次提醒」，不是提醒功能；下一条新单照样会弹 -->
        <span class="at-hint">声音可在「系统设置 → 通知与提醒」调整</span>
      </div>
    </div>
  </transition>
</template>

<script setup>
/**
 * 主框架里常驻的强提醒横幅。
 * 后端把 ticket:alert 广播给所有在线账号，strongAlert 统一处理声音/桌面通知/标题闪烁，
 * 处理完再派发 itops:alert-fire；本组件只消费这个事件，因此「测提醒」也能复用同一套展示。
 *
 * 多个工单同时到达时只展示一条，其余排队：横幅位置有限，堆五六条会盖住整个页面。
 * 关闭当前这条会自动顶上下一条，队列深度用 +N 标出来。
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { Close } from '@element-plus/icons-vue'

const router = useRouter()
// 待展示队列：第 0 条正在显示
const queue = ref([])
const current = computed(() => queue.value[0] || null)
const more = computed(() => Math.max(0, queue.value.length - 1))
const isUrgent = computed(() => {
  const p = current.value
  return !!p && (p.priority === 'urgent' || p.priority === 'high')
})

// 自动收起计时器：普通 20 秒、加急 40 秒；鼠标停在横幅上时暂停，读完再走
let timer = null
const HOLD_MS = { normal: 20000, urgent: 40000 }
function startTimer() {
  clearTimer()
  const ms = isUrgent.value ? HOLD_MS.urgent : HOLD_MS.normal
  timer = setTimeout(() => { shift() }, ms)
}
function clearTimer() { if (timer) { clearTimeout(timer); timer = null } }
function hold() { clearTimer() }
function resume() { if (current.value) startTimer() }

/**
 * 横幅会盖住右下角的「待接单」小面板，显示期间把它整体上推，
 * 两个提示同时出现时不至于互相遮挡（隐藏后恢复原位）。
 */
function setStack(px) {
  try { document.documentElement.style.setProperty('--it-alert-stack', px + 'px') } catch (e) { /* 忽略 */ }
}

function shift() {
  queue.value = queue.value.slice(1)
  if (queue.value.length) startTimer()
  else { clearTimer(); setStack(0) }
}
function dismiss() { shift() }
function open() {
  const p = current.value
  if (!p) return
  if (!p.is_test && p.ticket_id) router.push({ path: '/tickets', query: { open: p.ticket_id } })
  shift()
}

function onFire(e) {
  const p = e.detail
  if (!p) return
  // 测试提醒不排队：直接替换当前显示，避免把真实工单挤到后面去
  if (p.is_test) { queue.value = [p]; clearTimer(); setStack(132); timer = setTimeout(() => shift(), 8000); return }
  // 同一张单可能因为重连被重复推送，按 ticket_id 去重
  if (queue.value.some(x => x.ticket_id === p.ticket_id)) return
  // 队列最多留 5 条，再多也没有人会一条条点开，超出直接丢弃最早的
  queue.value = [...queue.value, p].slice(-5)
  setStack(132)
  startTimer()
}

onMounted(() => window.addEventListener('itops:alert-fire', onFire))
onBeforeUnmount(() => {
  window.removeEventListener('itops:alert-fire', onFire)
  clearTimer()
  setStack(0)
})
</script>

<style scoped>
.alert-toast {
  position: fixed; right: 18px; bottom: 18px; z-index: 1300;
  width: 330px; background: #fff; border-radius: 12px; overflow: hidden;
  border: 1px solid var(--it-border);
  box-shadow: 0 14px 40px rgba(31, 41, 55, .22);
}
/* 加急/高优先级整块转红：一眼区分「要不要马上放下手上的事」 */
.alert-toast.urgent { border-color: #e54545; }
.at-head {
  display: flex; align-items: center; gap: 8px; padding: 9px 12px;
  background: var(--it-primary); color: #fff; font-size: 13px; font-weight: 600;
}
.alert-toast.urgent .at-head { background: #e54545; }
.alert-toast.test .at-head { background: #17a673; }
.at-dot {
  width: 8px; height: 8px; border-radius: 50%; background: #fff;
  animation: at-pulse 1.4s infinite;
}
@keyframes at-pulse { 0% { box-shadow: 0 0 0 0 rgba(255,255,255,.75) } 70% { box-shadow: 0 0 0 9px rgba(255,255,255,0) } 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0) } }
.at-title { flex: 1; }
.at-more { background: rgba(255,255,255,.24); border-radius: 9px; padding: 0 7px; font-size: 12px; }
.at-close { cursor: pointer; opacity: .85; }
.at-close:hover { opacity: 1; }
.at-body { padding: 10px 12px 4px; cursor: pointer; }
.at-text { font-size: 13.5px; font-weight: 600; line-height: 1.5; color: var(--it-text); word-break: break-all; }
.at-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; font-size: 11.5px; color: var(--it-text-sub); }
.at-no { font-weight: 600; color: var(--it-primary); }
.at-ops { display: flex; align-items: center; gap: 4px; padding: 4px 12px 10px; }
.at-hint { margin-left: auto; font-size: 11px; color: var(--it-text-sub); }
/* 进出场：从右下角轻微上移 + 淡入，不做过大幅度动画，避免连续提单时闪眼 */
.at-enter-active, .at-leave-active { transition: all .2s ease; }
.at-enter-from, .at-leave-to { opacity: 0; transform: translateY(12px) scale(.98); }
.dark .alert-toast { background: var(--it-card); }
@media (max-width: 820px) {
  .alert-toast { right: 10px; left: 10px; bottom: 10px; width: auto; }
  .at-hint { display: none; }
}
</style>
