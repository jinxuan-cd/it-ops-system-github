<!--
  月报 —— IT 运维工单台账与日报自动管理系统
  按月生成与查看个人月报

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.2
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page">
    <div class="it-between" style="margin-bottom:14px">
      <h3 class="it-section-title" style="margin:0">月度工作报告</h3>
      <!-- 月份切换只读已存报告，不自动生成：避免翻看历史月份时误触发 AI 调用 -->
      <div>
        <el-date-picker
          v-model="month"
          type="month"
          value-format="YYYY-MM"
          placeholder="选择月份"
          style="width:150px;margin-right:10px"
          @change="onMonthChange"
        />
        <el-button type="primary" :loading="genLoading" @click="generate">
          <el-icon><MagicStick /></el-icon> 生成 / 重新生成
        </el-button>
      </div>
    </div>

    <!-- 生成结果提示：ai_used 决定配色与文案，让用户一眼知道这份是 AI 写的还是规则汇总的 -->
    <el-alert
      v-if="aiNote"
      :title="aiNote"
      :type="aiUsed ? 'success' : 'info'"
      :closable="false"
      show-icon
      style="margin-bottom:14px"
    />

    <el-row :gutter="14">
      <el-col :md="16">
        <!-- 正文用可编辑 textarea 而非只读展示：生成后允许人工微调再复制去汇报 -->
        <div class="it-card">
          <div class="it-between" style="margin-bottom:10px">
            <h4 class="it-section-title" style="margin:0">汇报内容（可复制 / 微调）</h4>
            <el-button size="small" type="success" @click="copyReport"><el-icon><DocumentCopy /></el-icon> 一键复制</el-button>
          </div>
          <el-input
            v-model="content"
            type="textarea"
            :rows="22"
            placeholder="选择月份后点击「生成 / 重新生成」；若配置了 AI 接口将生成向上汇报风格报告，未配置则使用规则汇总。"
          />
        </div>
      </el-col>

      <el-col :md="8">
        <div class="it-card" style="margin-bottom:14px">
          <h4 class="it-section-title" style="margin-bottom:10px">本月统计</h4>
          <!-- 统计随生成一起返回：只有点过生成才有数据，已存报告不带回明细，所以先判空 -->
          <div v-if="!stats.ticket" class="it-text-sub">暂无数据</div>
          <template v-else>
            <div class="stat-row"><span>工单总量</span><b>{{ stats.ticket.total || 0 }} 单</b></div>
            <div class="stat-row"><span>已完成</span><b>{{ stats.ticket.done_cnt || 0 }} 单</b></div>
            <div class="stat-row"><span>平均处理时长</span><b>{{ stats.ticket.avg_hours || 0 }} 小时</b></div>
            <div class="stat-row"><span>月度目标</span><b>{{ (stats.goal || {}).done || 0 }} / {{ (stats.goal || {}).total || 0 }}</b></div>
            <div class="stat-row"><span>在办项目</span><b>{{ (stats.projects || []).length }} 个</b></div>
            <el-divider style="margin:10px 0" />
            <div class="mini-title">问题类别 TOP</div>
            <div v-for="x in (stats.byType || []).slice(0,5)" :key="x.name" class="mini-line">{{ x.name }}：{{ x.value }} 单</div>
            <div class="mini-title" style="margin-top:8px">应用系统 TOP</div>
            <div v-for="x in (stats.bySystem || []).slice(0,5)" :key="x.name" class="mini-line">{{ x.name }}：{{ x.value }} 单</div>
          </template>
        </div>

        <div class="it-card">
          <h4 class="it-section-title" style="margin-bottom:10px">历史报告</h4>
          <!-- 历史月报只存成稿，点条目回看往月原文；预览里的换行压成一行，避免时间轴被撑高 -->
          <el-timeline v-if="history.length">
            <el-timeline-item
              v-for="h in history"
              :key="h.report_id"
              :timestamp="h.report_month"
              placement="top"
            >
              <span class="his-link" @click="loadMonth(h.report_month)">{{ (h.preview || '').replace(/\n/g, ' ') || '（点击查看）' }}</span>
            </el-timeline-item>
          </el-timeline>
          <div v-else class="it-text-sub">暂无历史月度报告</div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { MagicStick, DocumentCopy } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import R from '../api'

// 当前查看的月份（YYYY-MM）。默认落在当前自然月，进页面就有内容可看，不用先选月份
const month = ref(currentMonth())
// 报告正文，可直接编辑，所以和「已存报告」解耦，改乱了重新生成即可
const content = ref('')
// 右侧统计卡数据：工单量、完成数、平均处理时长、目标进度、项目数、类别/系统 TOP。
// 统计口径按 happen_time 归月（当月经手），完成数与平均时长也只从这批工单里算，
// 不掺上月受理、本月完成的单子，否则跨月对比会失真。
const stats = ref({})
// 历史月报列表，用于时间轴回看
const history = ref([])
const genLoading = ref(false)
// 本月报告是否由 AI 生成：只影响提示颜色与文案，不影响内容结构
const aiUsed = ref(false)
// 生成结果提示语，空串则不显示提示条
const aiNote = ref('')

// 取当前年月：本地时区即可，月报按运维同事所在时区切月
function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// 生成 / 重新生成月报。同一月份重复生成会覆盖已有内容（后端按月份 upsert），
// 所以按钮文案写成「生成 / 重新生成」，提醒用户点下去就是覆盖。
// 是否走 AI 由后端配置决定：没配 AI 就退回规则汇总，前端只按 ai_used 切换提示文案。
async function generate() {
  if (!month.value) { ElMessage.warning('请选择月份'); return }
  genLoading.value = true
  try {
    const res = await R.generateMonthlyReport(month.value)
    content.value = res.content || ''
    stats.value = res.stats || {}
    aiUsed.value = !!res.ai_used
    aiNote.value = res.ai_used
      ? `已使用 AI 生成「${month.value}」月度汇报报告，可直接复制归档用于年度汇报。`
      : `已生成「${month.value}」月度报告（规则汇总）。如需 AI 向上汇报风格，请在后端 .env 配置 AI_API_URL / AI_API_KEY / AI_MODEL。`
    ElMessage.success(res.ai_used ? 'AI 月度报告已生成' : '月度报告已生成')
    loadHistory()
  } catch (e) { ElMessage.error(e.message) } finally { genLoading.value = false }
}

// 切换月份：只拉该月已存的成稿，查不到就把编辑区清空等用户手点生成。
// 这里不自动生成——不然来回翻月份会把 AI 额度烧光，也会覆盖之前手改过的稿子。
async function onMonthChange() {
  if (!month.value) return
  try {
    const row = await R.getMonthlyReport(month.value)
    if (row) {
      content.value = row.content || ''
      aiNote.value = ''
      // 已存报告不带回统计明细，重新生成可刷新统计
    } else {
      content.value = ''
      aiNote.value = ''
    }
  } catch (e) { ElMessage.error(e.message) }
}

// 点历史条目回看：先同步月份选择器，再走同一条读取逻辑，保证两处状态一致
async function loadMonth(m) {
  month.value = m
  await onMonthChange()
}

// 历史列表是辅助信息，拉失败就静默：不能因为时间轴挂了把整页月报卡住
async function loadHistory() {
  try { history.value = await R.monthlyReportHistory() } catch (e) {}
}

// 一键复制正文。优先用 Clipboard API，它在非 https 环境和旧浏览器会 reject，
// 所以退化到临时 textarea + execCommand，保证内网 http 部署也能复制。
function copyReport() {
  const text = content.value || ''
  if (!text.trim()) { ElMessage.warning('暂无可复制内容'); return }
  navigator.clipboard.writeText(text).then(
    () => ElMessage.success('已复制到剪贴板'),
    () => {
      const ta = document.createElement('textarea')
      ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
      ElMessage.success('已复制到剪贴板')
    }
  )
}

// 进入页面：并行拿历史列表和当月已存报告，两个请求互不依赖
onMounted(() => { loadHistory(); onMonthChange() })
</script>

<style scoped>
.stat-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed var(--it-border); font-size: 13px; }
.stat-row span { color: var(--it-text-sub); }
.stat-row b { color: #2b3245; }
.mini-title { font-weight: 600; font-size: 12px; color: #2b3245; margin-bottom: 4px; }
.mini-line { font-size: 12px; color: #4a5266; padding: 2px 0; }
.his-link { cursor: pointer; color: #4a5266; font-size: 13px; }
.his-link:hover { color: var(--it-primary); }
</style>
