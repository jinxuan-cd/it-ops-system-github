<!--
  待办抽屉 —— IT 运维工单台账与日报自动管理系统
  侧滑面板展示今日待办并支持快速处理

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.1
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
    <div
    class="todo-float"
    v-if="visible"
    :class="{ collapsed: collapsed, dragging: dragging }"
    :style="panelStyle"
    ref="panelEl"
  >
    <div class="panel-head" @pointerdown="onDragStart">
      <span v-show="!collapsed" class="panel-title">待办提示</span>
      <el-badge v-show="!collapsed" :value="todos.length + pool.length" :max="99" class="panel-badge" />
      <!-- 移动手柄：右上角 -->
      <el-icon v-show="!collapsed" class="drag-dot" title="拖动移动"><Rank /></el-icon>
      <!-- 收起：向左收（保持右边缘不动） -->
      <el-icon
        class="collapse-icon"
        title="收起 / 展开"
        @pointerdown.stop
        @click.stop="toggleCollapse"
      ><ArrowRight v-if="!collapsed" /><ArrowLeft v-else /></el-icon>
    </div>

    <div v-show="!collapsed" class="panel-body">
      <!-- 待接单 / 待指派：员工报障后同步推给运维，点「接取」即可开始处理 -->
      <div class="panel-block pool-block" v-if="pool.length">
        <div class="block-title">
          {{ desk ? '待指派工单' : '待接单工单' }} ({{ pool.length }})
          <span class="pool-go" @click="goPool">全部 →</span>
        </div>
        <div v-for="t in pool.slice(0, 5)" :key="t.ticket_id" class="pool-item">
          <div class="pool-main" @click="openTicket(t.ticket_id)">
            <div class="pool-text">{{ shortText(t.service_content) }}</div>
            <div class="pool-meta">
              <span>{{ (t.happen_time || '').slice(5, 16) }}</span>
              <span v-if="t.contact">· {{ t.contact }}</span>
            </div>
          </div>
          <el-button size="small" type="primary" plain @click.stop="claim(t)">接取</el-button>
        </div>
      </div>

      <div class="panel-block">
        <div class="block-title">今日未完成 ({{ todos.length }})</div>
        <div v-if="loadFailed" class="empty">待办加载失败，请刷新页面重试</div>
        <div v-else-if="!todos.length" class="empty">今日暂无待办 🎉</div>
        <div v-for="t in todos" :key="t.todo_id" class="todo-item">
          <el-checkbox @change="(v) => markDone(t, v)" />
          <span class="todo-text" :class="{ link: t.ticket_id }" @click="t.ticket_id && openTicket(t.ticket_id)">{{ t.todo_title }}</span>
        </div>
      </div>

      <div class="panel-block" v-if="assigned.length">
        <div class="block-title">我的处理中工单 ({{ assigned.length }})</div>
        <div v-for="t in assigned" :key="t.ticket_id" class="todo-item assign" @click="openTicket(t.ticket_id)">
          <el-icon class="a-icon" :class="t.resolve_state"><WarningFilled /></el-icon>
          <span class="todo-text">{{ shortText(t.service_content) }}</span>
        </div>
      </div>

      <div class="panel-block">
        <div class="block-title">本月目标</div>
        <el-progress
          type="circle"
          :percentage="goalProgress"
          :width="70"
          :stroke-width="8"
        />
        <div class="goal-text">{{ goalDone }} / {{ goalTotal }} 已完成</div>
      </div>

      <div class="drag-tip">拖动标题栏可移动此面板</div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import R from '../api'
import { useUserStore } from '../store/user'
import { workflow } from '../utils/workflow'
import { ElMessage } from 'element-plus'

const userStore = useUserStore()
const router = useRouter()
// 服务台模式下车池显示「待指派」，否则显示「待接单」
const desk = computed(() => workflow.service_desk_enable)

// 用户手动设置过就尊重设置；没设置过时，窄屏（<1200）自动收起，避免遮挡表格
// 两个开关都放 localStorage：面板属于个人使用习惯，跟着浏览器走就行，不必进后端
const savedCollapse = localStorage.getItem('itops_todo_collapse')
const collapsed = ref(savedCollapse === null ? window.innerWidth < 1200 : savedCollapse === '1')
const visible = ref(localStorage.getItem('itops_show_todo_float') !== '0')
const todos = ref([])
const assigned = ref([])
const pool = ref([])
// 本月目标的三个显示值来自看板指标，独立存是为了进度圈能单独更新
const goalDone = ref(0)
const goalTotal = ref(0)
const goalProgress = ref(0)
const assignedCount = ref(0)
const loadFailed = ref(false)

// 位置持久化
// 面板要能压在表格上方随手拖，所以用 fixed + left/top 定位，坐标存 localStorage
const panelEl = ref(null)
const dragging = ref(false)
const pos = ref(null) // { x, y }

// 收起态宽度写死 44px，与 CSS 的 .todo-float.collapsed 保持一致
function widthOf() {
  return collapsed.value ? 44 : 240
}
// 默认贴在页面右上角、顶栏下方（y=72 避开 56px 的 header）
function defaultPos() {
  const w = window.innerWidth
  const h = window.innerHeight
  return { x: Math.max(10, w - widthOf() - 18), y: 72 }
}
// 懒加载位置：读取失败（存储被清或写坏）就回落到默认位置
function ensurePos() {
  if (!pos.value) {
    pos.value = (() => {
      try { return JSON.parse(localStorage.getItem('itops_todo_pos') || 'null') } catch (e) { return null }
    })() || defaultPos()
  }
}
// 计算样式里顺手做位置初始化：模板首次渲染就要拿到 left/top，放在 onMounted 会先闪一下左上角
const panelStyle = computed(() => {
  ensurePos()
  return { left: pos.value.x + 'px', top: pos.value.y + 'px' }
})

// 折叠状态持久化
watch(collapsed, (v) => localStorage.setItem('itops_todo_collapse', v ? '1' : '0'))
// 窗口变大后自动展开（只影响未手动收起的场景）

// 拖拽逻辑
// 用 pointer 事件而不是 mouse：手机/平板触摸和鼠标能共用一套代码；
// 监听挂在 window 上，鼠标拖出面板范围也不会丢事件
let startX = 0, startY = 0, startLeft = 0, startTop = 0, moved = false
function onDragStart(e) {
  // 只响应左键 / 单指，右键菜单和双指缩放不触发拖动
  if (e.button !== undefined && e.button !== 0) return
  ensurePos()
  startX = e.clientX
  startY = e.clientY
  startLeft = pos.value.x
  startTop = pos.value.y
  moved = false
  dragging.value = true
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
}
function onDragMove(e) {
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  // 3px 以内不算拖动：单纯点一下标题栏（想折叠）时手指的轻微抖动不该把面板挪走
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true
  let x = startLeft + dx
  let y = startTop + dy
  const w = widthOf()
  // 夹在视口内：留 4px 边距，底部按 50px 估算，保证标题栏始终能拖回来
  x = Math.max(4, Math.min(x, window.innerWidth - w - 4))
  y = Math.max(4, Math.min(y, window.innerHeight - 50))
  pos.value = { x, y }
}
function onDragEnd() {
  dragging.value = false
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  // 拖动结束才落盘：拖动过程中每帧写 localStorage 会卡顿
  localStorage.setItem('itops_todo_pos', JSON.stringify(pos.value))
}
function toggleCollapse() {
  // 保持右边缘固定：收起时左边缘向右收（从左边收到右边）
  const before = widthOf()
  collapsed.value = !collapsed.value
  const after = widthOf()
  ensurePos()
  const maxX = Math.max(4, window.innerWidth - after - 4)
  const x = Math.max(4, Math.min(pos.value.x + (before - after), maxX))
  pos.value = { x, y: pos.value.y }
  localStorage.setItem('itops_todo_pos', JSON.stringify(pos.value))
}

async function load() {
  // 每个接口单独 catch：某一个失败不能把整个面板清空成「今日暂无待办」，
  // 否则用户会以为真的没活儿，其实是接口挂了
  const [pending, dash, mineTickets, poolTickets] = await Promise.all([
    R.pendingToday().catch(() => null),
    R.getDashboard(userStore.isAdmin ? { all: 1 } : {}).catch(() => null),
    R.listTickets({ mine: 1, status: 'processing' }).catch(() => []),
    userStore.canClaim ? R.poolTickets().catch(() => []) : []
  ])
  if (pending) todos.value = pending
  assigned.value = (mineTickets || []).slice(0, 6)
  assignedCount.value = (mineTickets || []).length
  pool.value = poolTickets || []
  const m = dash && dash.metrics
  if (m) {
    goalDone.value = m.goal_done || 0
    goalTotal.value = m.goal_total || 0
    goalProgress.value = m.goal_progress || 0
  }
  loadFailed.value = pending === null && dash === null
}

// 工单内容常是多行长文本，面板窄，只取首行前 26 字，超出补省略号
function shortText(s) {
  const t = String(s || '').split('\n')[0]
  return t.length > 26 ? t.slice(0, 26) + '…' : (t || '（无内容）')
}
// 点待办 / 工单 → 直接打开工单详情（不再只是跳到列表）
function openTicket(id) {
  router.push({ path: '/tickets', query: { open: id } })
}
// 「全部 →」跳到工单页的公海视图
function goPool() {
  router.push({ path: '/tickets', query: { scope: 'pool' } })
}
// 在面板里直接接单：成功后刷新并打开详情，等于一次点击完成「领单 + 进入处理」
async function claim(t) {
  try {
    await R.claimTicket(t.ticket_id)
    ElMessage.success('接单成功，这张工单由你负责')
    load()
    openTicket(t.ticket_id)
  } catch (e) {
    ElMessage.warning(e.message)
    load()
  }
}

// 实时事件：有新单 / 被接走 → 刷新待办与待接单列表
function onRt() { load() }

// 待办只支持「勾上完成」：取消勾选直接返回，避免已完成记录被反向改回未完成
async function markDone(t, v) {
  if (!v) return
  try {
    await R.updateTodo(t.todo_id, { is_finish: 1 })
    ElMessage.success('已标记完成')
    load()
  } catch (e) { ElMessage.error(e.message) }
}

// 跨标签页：设置页在另一个标签改了开关，这里通过 storage 事件同步
function onStorage(e) {
  if (e.key === 'itops_show_todo_float') {
    visible.value = localStorage.getItem('itops_show_todo_float') !== '0'
    if (visible.value) ensurePos()
  }
}
// 同标签页：storage 事件不会在自己页面触发，所以设置页额外派发自定义事件补上这条路
function onSettingsChanged(e) {
  if (e.detail && e.detail.key === 'itops_show_todo_float') {
    visible.value = localStorage.getItem('itops_show_todo_float') !== '0'
    if (visible.value) ensurePos()
  }
}

onMounted(() => {
  ensurePos()
  load()
  // 待办/目标变更时全局广播刷新（新增、勾选、删除、日报生成待办等场景）
  window.addEventListener('itops:todo-changed', load)
  // 实时：有新工单或被接单时刷新
  window.addEventListener('itops:rt', onRt)
  // 设置页修改提醒开关时实时响应
  window.addEventListener('storage', onStorage)
  // 同标签页内的设置变更通过自定义事件通知
  window.addEventListener('itops:settings-changed', onSettingsChanged)
})
onBeforeUnmount(() => {
  window.removeEventListener('itops:todo-changed', load)
  window.removeEventListener('itops:rt', onRt)
  window.removeEventListener('storage', onStorage)
  window.removeEventListener('itops:settings-changed', onSettingsChanged)
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
})
</script>

<style scoped>
.todo-float {
  position: fixed;
  width: 240px;
  background: #fff;
  border: 1px solid var(--it-border);
  border-radius: 12px;
  box-shadow: 0 6px 24px rgba(31, 41, 55, 0.12);
  z-index: 1000;
  overflow: hidden;
  user-select: none;
}
.todo-float.collapsed { width: 44px; }
.todo-float.dragging { opacity: 0.92; box-shadow: 0 10px 34px rgba(31, 41, 55, 0.25); cursor: grabbing; }
.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--it-primary);
  color: #fff;
  cursor: grab;
  font-weight: 600;
}
.todo-float.collapsed .panel-head { justify-content: center; padding: 10px 0; }
.todo-float.dragging .panel-head { cursor: grabbing; }
.drag-dot { cursor: grab; opacity: 0.85; }
.panel-title { flex: 1; }
.collapse-icon { cursor: pointer; transition: transform 0.15s; }
.collapse-icon:hover { transform: scale(1.15); }
.panel-body { padding: 12px; max-height: 60vh; overflow-y: auto; }
.panel-block { margin-bottom: 14px; }
.block-title { font-size: 13px; font-weight: 600; color: #2b3245; margin-bottom: 8px; }
.empty { color: var(--it-text-sub); font-size: 13px; }
.todo-item { display: flex; align-items: flex-start; gap: 6px; padding: 4px 0; }
.todo-text { font-size: 13px; color: #4a5266; line-height: 1.4; }
.goal-text { text-align: center; font-size: 12px; color: var(--it-text-sub); margin-top: 6px; }
.todo-item.assign { cursor: pointer; }
.todo-item.assign:hover .todo-text { color: var(--it-primary); }
.a-icon { color: var(--it-warning); font-size: 14px; margin-top: 2px; }
.a-icon.overdue { color: var(--it-danger); }
.drag-tip { text-align: center; font-size: 11px; color: var(--it-text-sub); margin-top: 4px; opacity: 0.7; }

/* 待接单 / 待指派区块 */
.pool-block .block-title { display: flex; align-items: center; justify-content: space-between; }
.pool-go { font-size: 11px; font-weight: 400; color: var(--it-primary); cursor: pointer; }
.pool-item { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-bottom: 1px dashed rgba(125, 125, 125, 0.2); }
.pool-item:last-child { border-bottom: none; }
.pool-main { flex: 1; min-width: 0; cursor: pointer; }
.pool-text { font-size: 13px; line-height: 1.4; color: #2b3245; word-break: break-all; }
.pool-main:hover .pool-text { color: var(--it-primary); }
.pool-meta { font-size: 11px; color: var(--it-text-sub); margin-top: 2px; }
.todo-text.link { cursor: pointer; }
.todo-text.link:hover { color: var(--it-primary); }
.dark .todo-float { background: var(--it-card); border-color: var(--it-border); }
.dark .block-title { color: var(--it-text); }
.dark .todo-text { color: var(--it-text-sub); }

@media (max-width: 768px) {
  .todo-float { /* 移动端仍允许拖拽，去掉固定底部定位 */ }
}
</style>
