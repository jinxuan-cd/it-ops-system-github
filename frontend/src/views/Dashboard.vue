<template>
  <div class="it-page">
    <!-- 顶部：时间维度切换（整页跟着变） -->
    <div class="dash-head">
      <div class="dash-title">
        <h3 class="it-section-title" style="margin:0">
          数据看板
          <el-tag v-if="userStore.canViewAll" size="small" type="warning" style="margin-left:8px">全公司</el-tag>
        </h3>
        <div class="range-note" v-if="ov.start_date">
          {{ ov.range_label }} · {{ ov.start_date }} ~ {{ ov.end_date }}
          <span class="dot">·</span>趋势{{ unitText }}
        </div>
      </div>
      <div class="dash-actions">
        <el-radio-group v-model="range" size="small" @change="reload">
          <el-radio-button value="today">今日</el-radio-button>
          <el-radio-button value="week">本周</el-radio-button>
          <el-radio-button value="month">本月</el-radio-button>
          <el-radio-button value="last_month">上月</el-radio-button>
          <el-radio-button value="year">本年</el-radio-button>
        </el-radio-group>
        <el-button v-if="userStore.canViewAll" type="primary" plain size="small" @click="router.push('/analytics')">
          <el-icon><TrendCharts /></el-icon> 团队运营分析
        </el-button>
      </div>
    </div>

    <!-- 指标卡片（本期口径，环比为与上一同长度周期的对比） -->
    <el-row :gutter="14" class="card-row" v-loading="loading">
      <el-col :xs="12" :sm="8" :md="4">
        <div class="metric-card blue" :title="`较上一周期 ${diffText(ov.diff.accepted)} 单`">
          <div class="m-val">{{ m.accepted }}</div>
          <div class="m-label">{{ ov.range_label }}受理<small class="sub">（较上期 {{ diffText(ov.diff.accepted) }}）</small></div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="metric-card green" :title="`较上一周期 ${diffText(ov.diff.done)} 单`">
          <div class="m-val">{{ m.done }}</div>
          <div class="m-label">{{ ov.range_label }}完成<small class="sub">（较上期 {{ diffText(ov.diff.done) }}）</small></div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="metric-card teal" :title="`${ov.range_label}受理的工单中已完成 ${m.done_rate}%`">
          <div class="m-val">{{ m.done_rate }}<small> %</small></div>
          <div class="m-label">完成率</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="metric-card purple" :title="m.sample ? `按本期完成的 ${m.sample} 条有完整起止时间的工单统计` : '本期没有起止时间完整的已完成工单'">
          <div class="m-val">{{ m.avg_hours === null ? '—' : m.avg_hours }}<small v-if="m.avg_hours !== null"> h</small></div>
          <div class="m-label">平均处理时长<small v-if="m.sample" class="sub">（{{ m.sample }} 单）</small></div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="metric-card orange">
          <div class="m-val">{{ m.pending }}</div>
          <div class="m-label">{{ ov.range_label }}未完成</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="metric-card cyan">
          <div class="m-val">{{ m.satisfy_avg === null ? '—' : m.satisfy_avg }}</div>
          <div class="m-label">满意度<small v-if="m.satisfy_cnt" class="sub">（{{ m.satisfy_cnt }} 条评价）</small></div>
        </div>
      </el-col>
    </el-row>

    <!-- 待处理提醒：只在有数据时出现 -->
    <div v-if="extras.length" class="extra-row">
      <div v-for="e in extras" :key="e.key" class="extra-item" :class="e.type" @click="e.to && router.push(e.to)">
        <span class="e-val">{{ e.value }}</span>
        <span class="e-label">{{ e.label }}</span>
      </div>
    </div>

    <!-- 趋势 + 类别排名 -->
    <el-row :gutter="14" class="chart-row">
      <el-col :md="16">
        <div class="it-card">
          <div class="it-between" style="margin-bottom:10px">
            <h4 class="it-section-title" style="margin:0">{{ ov.range_label }}工单趋势</h4>
            <span class="mini-note">柱：受理 / 完成 · {{ unitText }} · 悬停看平均时长</span>
          </div>
          <div ref="trendChart" class="chart"></div>
        </div>
      </el-col>
      <el-col :md="8">
        <div class="it-card">
          <div class="it-between" style="margin-bottom:4px">
            <h4 class="it-section-title" style="margin:0">{{ ov.range_label }}问题类别 TOP</h4>
            <span class="mini-note" v-if="ov.typeRank.length">共 {{ ov.typeRank.length }} 类</span>
          </div>
          <div v-if="!ov.typeRank.length" class="empty">{{ ov.range_label }}没有工单数据</div>
          <div v-show="ov.typeRank.length" ref="typeChart" class="chart"></div>
        </div>
      </el-col>
    </el-row>

    <!-- 分布 -->
    <el-row :gutter="14" class="chart-row">
      <el-col :md="12">
        <div class="it-card">
          <h4 class="it-section-title">{{ ov.range_label }}问题类别分布</h4>
          <div v-if="!ov.distribution.problemType.length" class="empty">暂无数据</div>
          <div v-show="ov.distribution.problemType.length" ref="pieType" class="chart"></div>
        </div>
      </el-col>
      <el-col :md="12">
        <div class="it-card">
          <h4 class="it-section-title">{{ ov.range_label }}应用系统分布</h4>
          <div v-if="!ov.distribution.appSystem.length" class="empty">暂无数据</div>
          <div v-show="ov.distribution.appSystem.length" ref="pieApp" class="chart"></div>
        </div>
      </el-col>
    </el-row>

    <!-- 最新工单 + 今日待办 -->
    <el-row :gutter="14" class="chart-row">
      <el-col :md="14">
        <div class="it-card">
          <div class="it-between" style="margin-bottom:10px">
            <h4 class="it-section-title" style="margin:0">{{ ov.range_label }}最新工单</h4>
            <el-button text type="primary" size="small" @click="router.push('/tickets')">查看全部</el-button>
          </div>
          <el-table :data="ov.recent" size="small" empty-text="暂无工单">
            <el-table-column prop="happen_time" label="时间" width="150" />
            <el-table-column prop="dept" label="部门" width="100" show-overflow-tooltip />
            <el-table-column prop="app_system" label="系统" width="110" show-overflow-tooltip />
            <el-table-column prop="service_content" label="内容" show-overflow-tooltip />
            <el-table-column label="状态" width="82">
              <template #default="{ row }"><el-tag size="small" :type="row.status==='done'?'success':(row.status==='pending'?'info':'warning')">{{ statusText(row.status) }}</el-tag></template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>
      <el-col :md="10">
        <div class="it-card">
          <h4 class="it-section-title">今日待办</h4>
          <div v-if="!ov.pendingTodos.length" class="empty">暂无未完成待办</div>
          <div v-for="t in ov.pendingTodos" :key="t.todo_id" class="todo-line">{{ t.todo_title }}</div>
          <div class="goal-block">
            <div class="it-between">
              <h4 class="it-section-title" style="margin:0">本月目标进度</h4>
              <span class="mini-note">{{ goalDone }} / {{ goalTotal }}</span>
            </div>
            <el-progress v-if="goalTotal" :percentage="goalProgress" :stroke-width="14" :show-text="false" style="margin-top:10px" />
            <div v-else class="empty" style="padding:8px 0">本月还没有设定目标</div>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 到期未完成项目提醒 -->
    <el-row v-if="ov.dueProjects.length && showDueAlert" class="chart-row">
      <el-col :md="24">
        <div class="it-card due-alert">
          <div class="it-between" style="margin-bottom:10px">
            <h4 class="it-section-title" style="margin:0;color:#c0392b">
              <el-icon><WarningFilled /></el-icon> 项目周期已到仍未完成（{{ ov.dueProjects.length }}）
            </h4>
            <el-button text type="primary" size="small" @click="goProjects">前往项目管理</el-button>
          </div>
          <div class="due-item" v-for="p in ov.dueProjects" :key="p.project_id">
            <span class="due-name">{{ p.project_name }}</span>
            <span class="due-progress">进度 {{ p.progress || 0 }}%</span>
            <span class="due-date">应完成于 {{ p.end_date }}</span>
          </div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import R from '../api'
import { useUserStore } from '../store/user'

const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const range = ref('month')
const showDueAlert = ref(localStorage.getItem('itops_show_due') !== '0')

const trendChart = ref(null)
const typeChart = ref(null)
const pieType = ref(null)
const pieApp = ref(null)

// 整页数据：切换时间维度时整体替换
const ov = reactive({
  range: 'month',
  range_label: '本月',
  start_date: '',
  end_date: '',
  unit: 'day',
  metrics: {
    accepted: 0, done: 0, done_rate: 0, pending: 0,
    overdue_open: 0, overdue_done: 0, avg_hours: null, sample: 0,
    satisfy_avg: null, satisfy_cnt: 0
  },
  prev: { accepted: 0, done: 0, avg_hours: null },
  diff: { accepted: 0, done: 0, avg_hours: null },
  trend: [],
  distribution: { problemType: [], appSystem: [] },
  typeRank: [],
  recent: [],
  pendingTodos: [],
  monthGoals: [],
  dueProjects: []
})
const m = computed(() => ov.metrics)

const unitText = computed(() => (ov.unit === 'hour' ? '按小时' : ov.unit === 'month' ? '按月' : '按天'))
const goalTotal = computed(() => ov.monthGoals.length)
const goalDone = computed(() => ov.monthGoals.filter(g => g.is_finish).length)
const goalProgress = computed(() => (goalTotal.value ? Math.round(goalDone.value / goalTotal.value * 100) : 0))

// 扩展指标（SLA / 指派 / 故障 / 巡检）：没数据就不显示
const extra = reactive({
  incident: { total: 0, ongoing: 0, serious: 0 },
  sla: { overdue: 0, soon: 0 },
  satisfy: { avg: 0, count: 0 },
  inspection_today: true,
  assigned_to_me: 0
})
const extras = computed(() => {
  const list = []
  if (extra.assigned_to_me > 0) {
    list.push({ key: 'assign', type: 'blue', value: extra.assigned_to_me, label: '指派给我待处理', to: '/tickets' })
  }
  if (extra.sla.overdue > 0) {
    list.push({ key: 'sla', type: 'red', value: extra.sla.overdue, label: '当前超出 SLA 未完成', to: '/tickets' })
  }
  if (extra.incident.total > 0) {
    list.push({
      key: 'incident',
      type: extra.incident.ongoing > 0 ? 'red' : 'orange',
      value: extra.incident.total,
      label: extra.incident.ongoing > 0 ? `本月故障（${extra.incident.ongoing} 个未恢复）` : '本月故障',
      to: '/incidents'
    })
  }
  if (!extra.inspection_today && !userStore.isAuditor) {
    list.push({ key: 'insp', type: 'orange', value: '未巡检', label: '今日机房巡检', to: '/inspections' })
  }
  return list
})

async function loadExtra() {
  try {
    Object.assign(extra, await R.getDashboardExtra(userStore.canViewAll ? { all: 1 } : {}))
  } catch { /* 扩展数据失败不影响主看板 */ }
}

function diffText(d) {
  if (d > 0) return '+' + d
  if (d < 0) return '' + d
  return '0'
}

function statusText(s) {
  return s === 'done' ? '完成' : s === 'pending' ? '待接单' : '处理中'
}

// 切换时间维度：整页重新取数并重绘
async function reload() {
  loading.value = true
  try {
    const params = { range: range.value, ...(userStore.canViewAll ? { all: 1 } : {}) }
    const data = await R.getDashboardOverview(params)
    Object.assign(ov, data)
    loadExtra()
    await nextTick()
    drawTrend()
    drawTypeRank()
    drawDistribution()
  } catch (e) {
    ElMessage.error('看板数据加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}

function chartOf(el) {
  if (!el) return null
  return echarts.getInstanceByDom(el) || echarts.init(el)
}

function drawTrend() {
  const c = chartOf(trendChart.value)
  if (!c) return
  const list = ov.trend || []
  const dense = list.length > 16
  c.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: ps => {
        const it = list[ps[0].dataIndex]
        if (!it) return ''
        const h = it.avg_hours === null || it.avg_hours === undefined ? '—' : it.avg_hours + ' h'
        return `${it.label}<br/>受理 ${it.accepted} 单<br/>完成 ${it.done} 单<br/>平均处理 ${h}`
      }
    },
    legend: { top: 0, itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 12 } },
    grid: { left: 40, right: 22, top: 34, bottom: 26 },
    xAxis: {
      type: 'category',
      data: list.map(r => r.label),
      axisLabel: { fontSize: 11, interval: dense ? 'auto' : 0, hideOverlap: true },
      axisTick: { show: false }
    },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 11 } },
    series: [
      { name: '受理', type: 'bar', barMaxWidth: 16, itemStyle: { color: '#2f6fed' }, data: list.map(r => r.accepted) },
      { name: '完成', type: 'bar', barMaxWidth: 16, itemStyle: { color: '#18a058' }, data: list.map(r => r.done) }
    ]
  }, true)
}

function drawTypeRank() {
  const c = chartOf(typeChart.value)
  if (!c) return
  const rows = [...(ov.typeRank || [])].sort((a, b) => a.value - b.value)
  c.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: ps => {
        const it = rows[ps[0].dataIndex]
        return it ? `${it.name}<br/>${it.value} 单（占 ${it.ratio}%）` : ''
      }
    },
    grid: { left: 4, right: 28, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'category', data: rows.map(r => r.name), axisLabel: { fontSize: 11, width: 96, overflow: 'truncate' } },
    series: [{
      type: 'bar',
      barMaxWidth: 16,
      itemStyle: { color: '#5b8def', borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 11, color: '#5a6478' },
      data: rows.map(r => r.value)
    }]
  }, true)
}

function drawDistribution() {
  const opt = data => ({
    tooltip: { trigger: 'item', formatter: '{b}：{c} 单 ({d}%)' },
    legend: { bottom: 0, type: 'plain', itemWidth: 10, itemHeight: 8, itemGap: 8, textStyle: { fontSize: 11 } },
    series: [{
      type: 'pie',
      radius: '48%',
      center: ['50%', '43%'],
      data,
      label: { formatter: '{b}：{c} ({d}%)', fontSize: 11 },
      labelLine: { length: 8, length2: 8 }
    }]
  })
  const a = chartOf(pieType.value)
  if (a) a.setOption(opt(ov.distribution.problemType), true)
  const b = chartOf(pieApp.value)
  if (b) b.setOption(opt(ov.distribution.appSystem), true)
}

function resize() {
  ;[trendChart.value, typeChart.value, pieType.value, pieApp.value].forEach(el => {
    const c = el && echarts.getInstanceByDom(el)
    if (c) c.resize()
  })
}

function goProjects() { router.push('/projects') }

onMounted(async () => {
  window.addEventListener('resize', resize)
  await reload()
  // 待办 / 月度目标变更后同步刷新
  window.addEventListener('itops:todo-changed', reload)
})
onBeforeUnmount(() => {
  ;[trendChart.value, typeChart.value, pieType.value, pieApp.value].forEach(el => {
    const c = el && echarts.getInstanceByDom(el)
    if (c) c.dispose()
  })
  window.removeEventListener('resize', resize)
  window.removeEventListener('itops:todo-changed', reload)
})
</script>

<style scoped>
/* 右侧浮动待办面板宽 240px，宽屏下给内容留出安全区，避免指标卡被遮挡 */
@media (min-width: 1200px) {
  .it-page { padding-right: 272px; }
}
/* 顶部：标题 + 维度切换 */
.dash-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin-bottom: 14px;
}
.dash-title { min-width: 0; }
.range-note { font-size: 12px; color: var(--it-text-sub); margin-top: 6px; }
.range-note .dot { margin: 0 6px; opacity: 0.55; }
.dash-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.card-row { margin-bottom: 14px; }
.extra-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.extra-item {
  display: flex; align-items: baseline; gap: 8px; padding: 9px 16px; cursor: pointer;
  background: var(--it-card); border: 1px solid var(--it-border); border-left-width: 4px; border-radius: 8px;
}
.extra-item .e-val { font-size: 18px; font-weight: 700; }
.extra-item .e-label { font-size: 12px; color: var(--it-text-sub); }
.extra-item.blue { border-left-color: var(--it-primary); }
.extra-item.blue .e-val { color: #1f56c8; }
.extra-item.red { border-left-color: var(--it-danger); }
.extra-item.red .e-val { color: #c62828; }
.extra-item.orange { border-left-color: var(--it-warning); }
.extra-item.orange .e-val { color: #a86400; }
.extra-item.green { border-left-color: var(--it-success); }
.extra-item.green .e-val { color: #0f7a44; }
.metric-card { border-radius: 10px; padding: 16px; color: #fff; margin-bottom: 8px; }
.metric-card .m-val { font-size: 26px; font-weight: 700; }
.metric-card .m-val small { font-size: 13px; font-weight: 400; opacity: 0.9; }
.metric-card .m-label { font-size: 12px; opacity: 0.92; margin-top: 4px; }
.metric-card .m-label .sub { font-size: 11px; opacity: 0.85; }
.metric-card.blue { background: linear-gradient(135deg,#2f6fed,#5b8def); }
.metric-card.green { background: linear-gradient(135deg,#18a058,#36c47e); }
.metric-card.orange { background: linear-gradient(135deg,#f0a020,#f7b84b); }
.metric-card.purple { background: linear-gradient(135deg,#7c5cff,#9d82ff); }
.metric-card.cyan { background: linear-gradient(135deg,#0fb5d6,#42c8e0); }
.metric-card.teal { background: linear-gradient(135deg,#13b5b1,#3fd0c9); }
.chart-row { margin-bottom: 14px; }
.chart { height: 280px; }
.goal-block { margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--it-border); }
.todo-line { padding: 6px 0; border-bottom: 1px dashed var(--it-border); font-size: 13px; color: #4a5266; }
.empty { color: var(--it-text-sub); font-size: 13px; padding: 24px 0; text-align: center; }
.due-alert { border: 1px solid #f3c4c0; background: #fff7f6; }
.due-item { display: flex; align-items: center; gap: 14px; padding: 8px 0; border-bottom: 1px dashed #f0d3cf; font-size: 13px; }
.due-item:last-child { border-bottom: none; }
.due-name { font-weight: 600; color: #2b3245; flex: 1; }
.due-progress { color: #c0392b; white-space: nowrap; }
.due-date { color: var(--it-text-sub); white-space: nowrap; }
.dark .due-alert { background: #2a1f1d; border-color: #6b3b34; }
.dark .due-item { border-color: #4a3030; }
.dark .due-name { color: var(--it-text); }
.dark .todo-line { color: #c8cfdd; }
</style>
