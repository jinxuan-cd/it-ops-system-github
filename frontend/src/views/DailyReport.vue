<!--
  日报填写 —— IT 运维工单台账与日报自动管理系统
  当日工作填报、AI 代写与历史日报查看

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.1
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page">
    <h3 class="it-section-title">日报自动生成</h3>
    <div class="plain-tip">日报是<strong>纯文本</strong>格式：AI 汇总时会自动去掉加粗、标题、列表符号等 Markdown 标记，可直接复制到微信 / 邮件 / OA。</div>

    <div class="report-layout">
      <div class="it-card">
        <div class="it-between" style="margin-bottom:12px">
          <span class="it-text-sub">日期：{{ reportDate }}</span>
          <div>
            <el-button size="small" type="warning" :loading="aiLoading" @click="aiGenerate"><el-icon><MagicStick /></el-icon> AI 智能汇总</el-button>
            <el-button size="small" @click="regenerate"><el-icon><Refresh /></el-icon> 重新汇总今日工单</el-button>
          </div>
        </div>

        <div class="block">
          <div class="block-label">今日工作汇报：</div>
          <el-input v-model="form.today_work" type="textarea" :rows="8" placeholder="自动汇总当天已完成工单，可手动修改" />
        </div>
        <div class="block">
          <div class="block-label">需协调解决的问题：</div>
          <el-input v-model="form.need_help" type="textarea" :rows="3" placeholder="手动填写" />
        </div>
        <div class="block">
          <div class="block-label">明日工作计划（每行一条）：</div>
          <!-- 一行一条的约定要在提交时生效：后端按换行拆成次日待办，
               写成一段话只会生成一条超长待办 -->
          <el-input v-model="form.tomorrow_plan" type="textarea" :rows="5" placeholder="多条计划换行填写，提交后自动生成次日待办" />
        </div>

        <div class="it-between" style="margin-top:12px">
          <el-button type="primary" @click="copyReport"><el-icon><DocumentCopy /></el-icon> 一键复制</el-button>
          <el-button type="success" :loading="submitting" @click="onSubmit"><el-icon><Check /></el-icon> 提交日报</el-button>
        </div>
      </div>

      <div class="it-card history">
        <div class="block-label" style="margin-bottom:10px">历史日报</div>
        <el-timeline v-if="history.length">
          <el-timeline-item v-for="h in history" :key="h.report_id" :timestamp="h.report_date" placement="top">
            <div class="his-item" @click="openHistory(h)">
              <div class="his-work">{{ (h.today_work || '').slice(0, 60) || '（无内容）' }}</div>
            </div>
          </el-timeline-item>
        </el-timeline>
        <div v-else class="it-text-sub">暂无历史日报</div>
      </div>
    </div>

    <!-- 历史日报只读查看：不能直接灌进编辑框，否则点「提交」会把今天的日报覆盖掉 -->
    <el-dialog v-model="historyVisible" :title="`${historyDetail.report_date || ''} 的日报`" width="660px">
      <div class="his-sec">
        <div class="his-label">今日工作汇报</div>
        <pre class="his-text">{{ historyDetail.today_work || '—' }}</pre>
      </div>
      <div class="his-sec">
        <div class="his-label">需协调解决的问题</div>
        <pre class="his-text">{{ historyDetail.need_help || '无' }}</pre>
      </div>
      <div class="his-sec">
        <div class="his-label">明日工作计划</div>
        <pre class="his-text">{{ historyDetail.tomorrow_plan || '无' }}</pre>
      </div>
      <template #footer>
        <el-button @click="historyVisible = false">关闭</el-button>
        <el-button type="primary" @click="copyHistory">复制</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Refresh, DocumentCopy, Check, MagicStick } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import R from '../api'

const reportDate = ref('')
const history = ref([])
const submitting = ref(false)
const aiLoading = ref(false)
const form = reactive({ today_work: '', need_help: '', tomorrow_plan: '' })
const historyVisible = ref(false)
const historyDetail = ref({})

async function loadToday() {
  try {
    const data = await R.getTodayReport()
    reportDate.value = data.report_date
    form.today_work = data.today_work
    form.need_help = data.need_help
    form.tomorrow_plan = data.tomorrow_plan
  } catch (e) { ElMessage.error(e.message) }
}
async function loadHistory() {
  try { history.value = await R.getReportHistory() } catch (e) {}
}
async function regenerate() { await loadToday(); ElMessage.success('已重新汇总') }
async function aiGenerate() {
  aiLoading.value = true
  try {
    const res = await R.aiDailyReport()
    if (res.ai_raw) {
      // AI 返回格式未分段，整体放入今日工作
      form.today_work = res.today_work || ''
      form.need_help = res.need_help || ''
      form.tomorrow_plan = res.tomorrow_plan || ''
      ElMessage.success('AI 已生成日报（原始格式）')
    } else {
      form.today_work = res.today_work || ''
      form.need_help = res.need_help || ''
      form.tomorrow_plan = res.tomorrow_plan || ''
      ElMessage.success('AI 已生成向上汇报式日报，可直接复制或微调')
    }
  } catch (e) { ElMessage.error(e.message) } finally { aiLoading.value = false }
}
function buildText() {
  return `今日工作汇报：\n${form.today_work}\n\n需协调解决的问题：\n${form.need_help || '无'}\n\n明日工作计划：\n${form.tomorrow_plan || '无'}`
}
async function copyReport() {
  const text = buildText()
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制到剪贴板')
  } catch (e) {
    // 兜底
    const ta = document.createElement('textarea')
    ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    ElMessage.success('已复制到剪贴板')
  }
}
async function onSubmit() {
  submitting.value = true
  try {
    const res = await R.submitReport({ ...form })
    ElMessage.success(res || '日报已提交')
    // 明日计划已转为待办，通知浮动面板刷新
    window.dispatchEvent(new Event('itops:todo-changed'))
    loadHistory()
  } catch (e) { ElMessage.error(e.message) } finally { submitting.value = false }
}
// 历史日报：只读弹窗查看（早先直接写进 form，一提交就覆盖掉当天日报）
function openHistory(h) {
  historyDetail.value = h || {}
  historyVisible.value = true
}
async function copyHistory() {
  const d = historyDetail.value || {}
  const text = `今日工作汇报：\n${d.today_work || ''}\n\n需协调解决的问题：\n${d.need_help || '无'}\n\n明日工作计划：\n${d.tomorrow_plan || '无'}`
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制到剪贴板')
  } catch (e) {
    const ta = document.createElement('textarea')
    ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    ElMessage.success('已复制到剪贴板')
  }
}

onMounted(() => { loadToday(); loadHistory() })
</script>

<style scoped>
.plain-tip { font-size: 12px; color: var(--it-text-sub); margin: -6px 0 12px; }
.his-sec { margin-bottom: 12px; }
.his-label { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.his-text {
  margin: 0; white-space: pre-wrap; word-break: break-word;
  font-size: 13px; line-height: 1.85; max-height: 220px; overflow: auto;
  background: var(--it-bg); border: 1px solid var(--it-border); border-radius: 8px; padding: 10px 12px;
}
.report-layout { display: flex; gap: 16px; align-items: flex-start; }
.report-layout > .it-card:first-child { flex: 1; min-width: 0; }
.history { width: 300px; flex-shrink: 0; }
.block { margin-bottom: 14px; }
.block-label { font-weight: 600; margin-bottom: 6px; color: #2b3245; }
.his-item { cursor: pointer; color: #4a5266; font-size: 13px; }
.his-item:hover { color: var(--it-primary); }

@media (max-width: 1000px) { .report-layout { flex-direction: column; } .history { width: 100%; } }
</style>
