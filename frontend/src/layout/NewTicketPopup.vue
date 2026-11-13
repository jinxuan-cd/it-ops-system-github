<!--
  快捷录入弹窗 —— IT 运维工单台账与日报自动管理系统
  顶栏随时唤起的新建工单窗口

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.4.2
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <!-- 右下角新工单接单提醒：有单自动弹出，可折叠 / 关闭，接取后实时消失 -->
  <transition name="cp">
    <div v-if="show" class="claim-pop" :class="{ collapsed, urgent: hasUrgent }">
      <div class="cp-head" @click="collapsed = !collapsed">
        <span class="cp-dot"></span>
        <span class="cp-title">{{ desk ? '新工单待指派' : '新工单待接取' }}</span>
        <span class="cp-count">{{ list.length }}</span>
        <el-icon class="cp-btn" @click.stop="dismiss" title="关闭（有新单会再提示）"><Close /></el-icon>
      </div>

      <div v-show="!collapsed" class="cp-body">
        <div v-for="t in list.slice(0, 4)" :key="t.ticket_id" class="cp-item">
          <div class="cp-line">
            <el-tag size="small" :type="priType(t.priority)" effect="plain">{{ priLabel(t.priority) }}</el-tag>
            <span class="cp-time">{{ (t.happen_time || '').slice(5, 16) }}</span>
            <span v-if="t.report_no" class="cp-no">{{ t.report_no }}</span>
          </div>
          <div class="cp-content">{{ t.service_content || '（未填写服务内容）' }}</div>
          <div class="cp-meta">
            <span v-if="t.contact">{{ t.contact }}</span>
            <span v-if="t.dept">{{ t.dept }}</span>
            <span v-if="t.app_system">{{ t.app_system }}</span>
          </div>
          <div class="cp-ops">
            <el-button size="small" type="primary" :loading="claiming === t.ticket_id" @click.stop="claim(t)">
              {{ desk ? '我去处理' : '接取' }}
            </el-button>
            <el-button size="small" text @click.stop="openDetail(t)">详情</el-button>
            <el-button v-if="desk" size="small" text @click.stop="openDetail(t, 'assign')">派单</el-button>
          </div>
        </div>
        <div v-if="list.length > 4" class="cp-more" @click="goPool">
          还有 {{ list.length - 4 }} 单在待接单池，查看全部 →
        </div>
        <div v-if="desk" class="cp-tip">已开启服务台模式：由你派单给工程师，也可以自己去处理。</div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { Close } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import R from '../api'
import { useUserStore } from '../store/user'
import { workflow, loadWorkflow } from '../utils/workflow'

const router = useRouter()
const userStore = useUserStore()
// 面板折叠状态：小屏（≤820px）首次出现时自动收起成一条，避免挡住工单列表
const collapsed = ref(false)
// 待接单池（抢单模式）或待指派池（服务台模式），接口是同一个
const list = ref([])
// 正在接单的 ticket_id，用来只给对应按钮转圈，避免连点重复提交
const claiming = ref(null)
// 用户手动关闭：只是本次隐藏，下次来了新单还会重新弹出
const closed = ref(false)
// 派单/抢单模式来自全局流转配置，决定标题与按钮文案
const desk = computed(() => workflow.service_desk_enable)
// 有紧急/高优先级单时整块变红，让运维一眼看到
const hasUrgent = computed(() => list.value.some(t => t.priority === 'urgent' || t.priority === 'high'))
// 审计员 canClaim 为 false，弹窗整体不出现；池子为空时也不占屏幕
const show = computed(() => !closed.value && userStore.canClaim && list.value.length > 0)

// 优先级字典：后端存英文枚举，展示用中文
const PRI = { urgent: '紧急', high: '高', normal: '普通', low: '低' }
function priLabel(p) { return PRI[p] || '普通' }
function priType(p) { return p === 'urgent' ? 'danger' : p === 'high' ? 'warning' : p === 'low' ? 'info' : 'primary' }

// 首屏只取一次池子：之后的新增/被抢都靠 SSE 增量更新，不必轮询
async function load() {
  try {
    const rows = await R.poolTickets()
    list.value = rows || []
    // 手机端默认收起，避免挡住内容
    if (window.innerWidth <= 820) collapsed.value = true
  } catch (e) { /* 静默 */ }
}

async function claim(t) {
  claiming.value = t.ticket_id
  try {
    await R.claimTicket(t.ticket_id)
    ElMessage.success('接单成功，这张工单由你负责')
    list.value = list.value.filter(x => x.ticket_id !== t.ticket_id)
    // 通知浮动待办面板刷新「我的处理中工单」
    window.dispatchEvent(new Event('itops:todo-changed'))
  } catch (e) {
    // 被别人抢先：从提醒里移除，并刷新池子
    ElMessage.warning(e.message)
    list.value = list.value.filter(x => x.ticket_id !== t.ticket_id)
    load()
  } finally { claiming.value = null }
}

// 跳工单页并带上 open 参数，打开后自动弹详情；action=assign 时服务台直接进派单
function openDetail(t, action) {
  router.push({ path: '/tickets', query: { open: t.ticket_id, ...(action ? { action } : {}) } })
}
function goPool() { router.push({ path: '/tickets', query: { scope: 'pool' } }) }
// 关闭只在本地隐藏，不记住到下次会话：宁可多提醒一次，也不要漏单
function dismiss() { closed.value = true }

// 实时事件：新单来了立刻弹出，被别人接走立刻消失
function onRt(e) {
  const { type, payload } = e.detail || {}
  if (type === 'ticket:new') {
    // 同一单可能被重复推送（重连补发），先按 ticket_id 去重
    if (!payload || list.value.some(t => t.ticket_id === payload.ticket_id)) return
    list.value = [payload, ...list.value]
    closed.value = false
    collapsed.value = false
  } else if (type === 'ticket:taken' || type === 'ticket:done') {
    if (!payload) return
    list.value = list.value.filter(t => t.ticket_id !== payload.ticket_id)
  } else if (type === 'ticket:released') {
    // 退回公海：只知道有单回来了，具体内容得重新拉一次
    load()
  }
}

// 页面从后台切回：SSE 在手机休眠期间可能已断，补一次全量拉取兜底
function onVisible() { if (!document.hidden) load() }

onMounted(async () => {
  // 先拿到流转模式再拉池子，否则标题会先显示「待接取」再跳成「待指派」
  await loadWorkflow()
  load()
  window.addEventListener('itops:rt', onRt)
  // 页面切回来时补一次，防止 SSE 断线期间漏单
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  window.removeEventListener('itops:rt', onRt)
  document.removeEventListener('visibilitychange', onVisible)
})
</script>

<style scoped>
/* 底部留出 --it-alert-stack：新工单强提醒横幅显示期间把它整体上推，两者不叠在一起 */
.claim-pop {
  position: fixed; right: 18px; bottom: calc(18px + var(--it-alert-stack, 0px)); z-index: 1200;
  transition: bottom .2s ease;
  width: 296px; background: #fff; border-radius: 12px; overflow: hidden;
  border: 1px solid var(--it-border);
  box-shadow: 0 10px 34px rgba(31, 41, 55, 0.18);
}
.claim-pop.urgent { border-color: #f56c6c; }
.cp-head {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
  padding: 10px 12px; color: #fff; background: var(--it-primary);
  font-size: 13px; font-weight: 600; user-select: none;
}
.claim-pop.urgent .cp-head { background: #e54545; }
.cp-dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 0 rgba(255,255,255,.7); animation: cp-pulse 1.6s infinite; }
@keyframes cp-pulse { 0% { box-shadow: 0 0 0 0 rgba(255,255,255,.7); } 70% { box-shadow: 0 0 0 8px rgba(255,255,255,0); } 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); } }
.cp-title { flex: 1; }
.cp-count { background: rgba(255,255,255,.24); border-radius: 9px; padding: 0 7px; font-size: 12px; }
.cp-btn { cursor: pointer; opacity: .85; }
.cp-btn:hover { opacity: 1; }
.cp-body { padding: 10px 12px 12px; max-height: 62vh; overflow-y: auto; }
.cp-item { border: 1px solid var(--it-border); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
.cp-line { display: flex; align-items: center; gap: 6px; }
.cp-time { font-size: 12px; color: var(--it-text-sub); }
.cp-no { margin-left: auto; font-size: 11px; color: var(--it-text-sub); }
.cp-content { font-size: 13px; font-weight: 600; line-height: 1.45; margin: 5px 0 4px; word-break: break-all; }
.cp-meta { display: flex; flex-wrap: wrap; gap: 6px; font-size: 11px; color: var(--it-text-sub); }
.cp-ops { display: flex; align-items: center; gap: 4px; margin-top: 6px; }
.cp-more { text-align: center; font-size: 12px; color: var(--it-primary); cursor: pointer; padding: 4px 0; }
.cp-tip { font-size: 11px; color: var(--it-text-sub); line-height: 1.6; margin-top: 4px; }
.claim-pop.collapsed { width: auto; }
.cp.c-enter-active, .cp.c-leave-active { transition: all .18s ease; }
.cp.c-enter-from, .cp.c-leave-to { opacity: 0; transform: translateY(10px); }
.dark .claim-pop { background: var(--it-card); border-color: var(--it-border); }
.dark .cp-item { border-color: var(--it-border); }
@media (max-width: 820px) {
  .claim-pop { right: 10px; left: 10px; bottom: calc(10px + var(--it-alert-stack, 0px)); width: auto; }
  .cp-body { max-height: 54vh; }
}
</style>
