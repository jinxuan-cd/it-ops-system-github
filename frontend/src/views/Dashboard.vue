<template>
  <div class="it-page">
    <div class="it-between" style="margin-bottom:14px">
      <h3 class="it-section-title" style="margin:0">数据看板<el-tag v-if="userStore.canViewAll" size="small" type="warning" style="margin-left:8px">全公司</el-tag></h3>
      <el-button v-if="userStore.canViewAll" type="primary" plain size="small" @click="router.push('/analytics')">
        <el-icon><TrendCharts /></el-icon> 团队运营分析
      </el-button>
    </div>

    <!-- 指标卡片 -->
    <el-row :gutter="14" class="card-row">
      <el-col :xs="12" :sm="8" :md="4"><div class="metric-card blue"><div class="m-val">{{ m.today_ticket }}</div><div class="m-label">当日工单</div></div></el-col>
      <el-col :xs="12" :sm="8" :md="4"><div class="metric-card green"><div class="m-val">{{ m.today_done }}</div><div class="m-label">当日已完成</div></div></el-col>
      <el-col :xs="12" :sm="8" :md="4"><div class="metric-card orange"><div class="m-val">{{ m.today_todo }}</div><div class="m-label">当日待办</div></div></el-col>
      <el-col :xs="12" :sm="8" :md="4"><div class="metric-card purple"><div class="m-val">{{ m.week_ticket }}<small> ({{ diffText(m.week_diff) }})</small></div><div class="m-label">本周工单/环比</div></div></el-col>
      <el-col :xs="12" :sm="8" :md="4"><div class="metric-card cyan"><div class="m-val">{{ m.month_ticket }}<small> ({{ diffText(m.month_diff) }})</small></div><div class="m-label">本月工单/环比</div></div></el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="metric-card teal" :title="m.handle_sample ? `按 ${m.handle_sample} 条有完整起止时间的工单统计` : '本月暂无起止时间完整的工单'">
          <div class="m-val">{{ m.avg_handle_hours === null ? '—' : m.avg_handle_hours }}<small v-if="m.avg_handle_hours !== null"> h</small></div>
          <div class="m-label">本月平均时长<small v-if="m.handle_sample" class="sub">（{{ m.handle_sample }} 单）</small></div>
        </div>
      </el-col>
    </el-row>

    <!-- 扩展指标：只在有数据/有异常时出现，没故障就不显示故障项 -->
    <div v-if="extras.length" class="extra-row">
      <div v-for="e in extras" :key="e.key" class="extra-item" :class="e.type" @click="e.to && router.push(e.to)">
        <span class="e-val">{{ e.value }}</span>
        <span class="e-label">{{ e.label }}</span>
      </div>
    </div>

    <!-- 上月汇总 + 本年度趋势（滚动复盘用） -->
    <div class="it-between" style="margin:2px 0 10px">
      <h4 class="it-section-title" style="margin:0">上月与本年度汇总</h4>
      <span class="mini-note">
        本年度累计 {{ summary.year.total_accepted }} 单 · 完成 {{ summary.year.total_done }} 单
        <template v-if="summary.year.avg_hours !== null"> · 平均 {{ summary.year.avg_hours }} h</template>
      </span>
    </div>
    <div class="lm-row">
      <div class="lm-item">
        <div class="lm-val">{{ summary.last_month.accepted }}</div>
        <div class="lm-label">上月工单<small v-if="summary.last_month.ym">（{{ summary.last_month.ym }}）</small></div>
      </div>
      <div class="lm-item">
        <div class="lm-val">{{ summary.last_month.done }}</div>
        <div class="lm-label">上月完成</div>
      </div>
      <div class="lm-item">
        <div class="lm-val">{{ summary.last_month.done_rate }}<small>%</small></div>
        <div class="lm-label">上月完成率</div>
      </div>
      <div class="lm-item">
        <div class="lm-val">{{ summary.last_month.avg_hours === null ? '—' : summary.last_month.avg_hours }}<small v-if="summary.last_month.avg_hours !== null"> h</small></div>
        <div class="lm-label">上月平均时长</div>
      </div>
      <div class="lm-item">
        <div class="lm-val">{{ summary.last_month.sla_overdue }}</div>
        <div class="lm-label">上月超期完成</div>
      </div>
      <div class="lm-item">
        <div class="lm-val">{{ summary.last_month.satisfy_avg === null ? '—' : summary.last_month.satisfy_avg }}</div>
        <div class="lm-label">上月满意度<small v-if="summary.last_month.satisfy_cnt">（{{ summary.last_month.satisfy_cnt }} 条）</small></div>
      </div>
    </div>

    <el-row :gutter="14" class="chart-row">
      <el-col :md="16">
        <div class="it-card">
          <div class="it-between" style="margin-bottom:10px">
            <h4 class="it-section-title" style="margin:0">{{ summary.year.year }} 年度月度趋势</h4>
            <span class="mini-note">柱：受理 / 完成 · 线：平均处理时长</span>
          </div>
          <div ref="yearChart" class="chart"></div>
        </div>
      </el-col>
      <el-col :md="8">
        <div class="it-card">
          <h4 class="it-section-title">上月问题类别 TOP</h4>
          <div v-if="!summary.last_month_types.length" class="empty">上月没有工单数据</div>
          <div v-show="summary.last_month_types.length" ref="lastTypeChart" class="chart"></div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="14" class="chart-row">
      <el-col :md="16">
        <div class="it-card">
          <div class="it-between" style="margin-bottom:10px">
            <h4 class="it-section-title" style="margin:0">工单趋势</h4>
            <el-radio-group v-model="trendRange" size="small" @change="loadTrend">
              <el-radio-button value="week">本周</el-radio-button>
              <el-radio-button value="month">本月</el-radio-button>
            </el-radio-group>
          </div>
          <div ref="trendChart" class="chart"></div>
        </div>
      </el-col>
      <el-col :md="8">
        <div class="it-card">
          <h4 class="it-section-title">本月目标进度</h4>
          <div class="goal-center">
            <el-progress type="dashboard" :percentage="m.goal_progress" :width="140" />
            <div class="goal-sub">{{ m.goal_done }} / {{ m.goal_total }} 已完成</div>
          </div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="14" class="chart-row">
      <el-col :md="12">
        <div class="it-card">
          <div class="it-between" style="margin-bottom:10px">
            <h4 class="it-section-title" style="margin:0">问题类别分布</h4>
            <el-radio-group v-model="distRange" size="small" @change="loadDistribution">
              <el-radio-button value="today">当日</el-radio-button>
              <el-radio-button value="month">本月</el-radio-button>
            </el-radio-group>
          </div>
          <div ref="pieType" class="chart"></div>
        </div>
      </el-col>
      <el-col :md="12">
        <div class="it-card">
          <div class="it-between" style="margin-bottom:10px">
            <h4 class="it-section-title" style="margin:0">应用系统分布</h4>
            <el-radio-group v-model="distRange" size="small" @change="loadDistribution">
              <el-radio-button value="today">当日</el-radio-button>
              <el-radio-button value="month">本月</el-radio-button>
            </el-radio-group>
          </div>
          <div ref="pieApp" class="chart"></div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="14" class="chart-row">
      <el-col :md="12">
        <div class="it-card">
          <h4 class="it-section-title">今日最新工单</h4>
          <el-table :data="todayTickets" size="small">
            <el-table-column prop="happen_time" label="时间" width="150" />
            <el-table-column prop="dept" label="部门" width="100" />
            <el-table-column prop="app_system" label="系统" width="110" />
            <el-table-column prop="service_content" label="内容" show-overflow-tooltip />
            <el-table-column label="状态" width="80">
              <template #default="{ row }"><el-tag size="small" :type="row.status==='done'?'success':(row.status==='pending'?'info':'warning')">{{ row.status==='done'?'完成':(row.status==='pending'?'待接单':'处理中') }}</el-tag></template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>
      <el-col :md="12">
        <div class="it-card">
          <h4 class="it-section-title">未完成待办</h4>
          <div v-if="!pendingTodos.length" class="empty">暂无未完成待办</div>
          <div v-for="t in pendingTodos" :key="t.todo_id" class="todo-line">{{ t.todo_title }}</div>
        </div>
      </el-col>
    </el-row>

    <!-- 到期未完成项目提醒（可在「系统设置-通知与提醒」关闭） -->
    <el-row v-if="dueProjects.length && showDueAlert" class="chart-row">
      <el-col :md="24">
        <div class="it-card due-alert">
          <div class="it-between" style="margin-bottom:10px">
            <h4 class="it-section-title" style="margin:0;color:#c0392b">
              <el-icon><WarningFilled /></el-icon> 项目周期已到仍未完成（{{ dueProjects.length }}）
            </h4>
            <el-button text type="primary" size="small" @click="goProjects">前往项目管理</el-button>
          </div>
          <div class="due-item" v-for="p in dueProjects" :key="p.project_id">
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
import R from '../api'
import { useUserStore } from '../store/user'

const router = useRouter()
const userStore = useUserStore()

const m = reactive({ today_ticket: 0, today_done: 0, today_todo: 0, week_ticket: 0, week_diff: 0, month_ticket: 0, month_diff: 0, avg_handle_hours: null, handle_sample: 0, goal_done: 0, goal_total: 0, goal_progress: 0 })
const todayTickets = ref([])
const pendingTodos = ref([])
const dueProjects = ref([])
const showDueAlert = ref(localStorage.getItem('itops_show_due') !== '0')
const trendRange = ref('week')
const distRange = ref('month')
const trendChart = ref(null)
const pieType = ref(null)
const pieApp = ref(null)
const yearChart = ref(null)
const lastTypeChart = ref(null)

// 上月 + 本年度汇总
const summary = reactive({
  last_month: { ym: '', accepted: 0, done: 0, done_rate: 0, avg_hours: null, sla_overdue: 0, satisfy_avg: null, satisfy_cnt: 0 },
  this_month: { accepted: 0, done: 0 },
  diff: { accepted: 0, done: 0, avg_hours: null },
  year: { year: new Date().getFullYear(), months: [], total_accepted: 0, total_done: 0, avg_hours: null },
  last_month_types: []
})

// 扩展指标（故障 / SLA / 指派 / 满意度 / 巡检）：没数据的项自动不显示
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
    list.push({ key: 'sla', type: 'red', value: extra.sla.overdue, label: '超出 SLA 未完成', to: '/tickets' })
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
  if (extra.satisfy.count > 0) {
    list.push({ key: 'satisfy', type: 'green', value: extra.satisfy.avg, label: `满意度（${extra.satisfy.count} 条评价）`, to: '/analytics' })
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

async function loadDashboard() {
  try {
    const data = await R.getDashboard(userStore.canViewAll ? { all: 1 } : {})
    Object.assign(m, data.metrics)
    todayTickets.value = data.todayTickets
    pendingTodos.value = data.pendingTodos
    dueProjects.value = data.dueProjects || []
  } catch (e) {}
  loadExtra()
}

async function loadTrend() {
  try {
    // 管理员/审计员要看全公司；不加 all=1 会被后端的「只看自己」口径过滤成空图
    const rows = await R.getTrend(trendRange.value, userStore.canViewAll ? { all: 1 } : {})
    // 切换「本周/本月」时复用已有实例，重复 init 会打印
    // "There is a chart instance already initialized on the dom" 并残留旧序列
    let chart = echarts.getInstanceByDom(trendChart.value)
    if (chart) chart.clear()
    else chart = echarts.init(trendChart.value)
    const list = Array.isArray(rows) ? rows : []
    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 20, top: 20, bottom: 30 },
      xAxis: { type: 'category', data: list.map(r => r.d), axisLabel: { rotate: 30, formatter: v => (v || '').slice(5) } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{ type: 'line', smooth: true, data: list.map(r => r.c), areaStyle: { opacity: 0.15 }, itemStyle: { color: '#2f6fed' }, lineStyle: { color: '#2f6fed' } }]
    }, true)
  } catch (e) {}
}

async function loadDistribution() {
  try {
    const data = await R.getDistribution({ range: distRange.value, ...(userStore.canViewAll ? { all: 1 } : {}) })
    const pieLabel = {
      formatter: '{b}：{c} ({d}%)',
      fontSize: 12
    }
    const pieCommon = {
      tooltip: { trigger: 'item', formatter: '{b}：{c} 单 ({d}%)' },
      legend: { bottom: 0, type: 'scroll' },
      avoidLabelOverlap: true,
      label: pieLabel
    }
    let pt = echarts.getInstanceByDom(pieType.value)
    if (pt) pt.dispose()
    pt = echarts.init(pieType.value)
    pt.setOption({ ...pieCommon, series: [{ type: 'pie', radius: '55%', center: ['50%', '45%'], data: data.problemType, label: pieLabel }] })

    let pa = echarts.getInstanceByDom(pieApp.value)
    if (pa) pa.dispose()
    pa = echarts.init(pieApp.value)
    pa.setOption({ ...pieCommon, series: [{ type: 'pie', radius: '55%', center: ['50%', '45%'], data: data.appSystem, label: pieLabel }] })
  } catch (e) {}
}

// 上月汇总 + 本年度趋势：年度趋势用柱(受理/完成) + 线(平均时长)
async function loadSummary() {
  try {
    const data = await R.getDashboardSummary(userStore.canViewAll ? { all: 1 } : {})
    Object.assign(summary, data)
  } catch (e) { return }
  await nextTick()
  renderYearChart()
  renderLastTypeChart()
}

function renderYearChart() {
  const el = yearChart.value
  if (!el) return
  let c = echarts.getInstanceByDom(el)
  if (c) c.clear()
  else c = echarts.init(el)
  const months = summary.year.months || []
  c.setOption({
    tooltip: { trigger: 'axis' },
    legend: { top: 0, itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 12 } },
    grid: { left: 44, right: 44, top: 34, bottom: 28 },
    xAxis: { type: 'category', data: months.map(m => m.label), axisLabel: { fontSize: 11 } },
    yAxis: [
      { type: 'value', minInterval: 1, axisLabel: { fontSize: 11 } },
      { type: 'value', axisLabel: { fontSize: 11, formatter: '{value}h' }, splitLine: { show: false } }
    ],
    series: [
      { name: '受理', type: 'bar', barMaxWidth: 18, itemStyle: { color: '#2f6fed' }, data: months.map(m => m.accepted) },
      { name: '完成', type: 'bar', barMaxWidth: 18, itemStyle: { color: '#18a058' }, data: months.map(m => m.done) },
      {
        name: '平均时长',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 6,
        itemStyle: { color: '#f0a020' },
        lineStyle: { color: '#f0a020' },
        data: months.map(m => m.avg_hours)
      }
    ]
  })
}

function renderLastTypeChart() {
  const el = lastTypeChart.value
  const list = summary.last_month_types || []
  if (!el || !list.length) return
  let c = echarts.getInstanceByDom(el) || echarts.init(el)
  c.clear()
  const rows = [...list].sort((a, b) => a.value - b.value)
  c.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 8, right: 34, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'category', data: rows.map(r => r.name), axisLabel: { fontSize: 11, width: 90, overflow: 'truncate' } },
    series: [{
      type: 'bar',
      barMaxWidth: 16,
      itemStyle: { color: '#5b8def', borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 11 },
      data: rows.map(r => r.value)
    }]
  })
}

function resize() {
  ;[trendChart.value, pieType.value, pieApp.value, yearChart.value, lastTypeChart.value].forEach(el => {
    const c = el && echarts.getInstanceByDom(el)
    if (c) c.resize()
  })
}

function goProjects() { router.push('/projects') }

onMounted(async () => {
  window.addEventListener('resize', resize)
  await loadDashboard()
  await nextTick()
  loadTrend()
  loadDistribution()
  loadSummary()
  // 待办 / 月度目标发生变更时，看板指标同步刷新
  window.addEventListener('itops:todo-changed', loadDashboard)
})
onBeforeUnmount(() => {
  ;[trendChart.value, pieType.value, pieApp.value, yearChart.value, lastTypeChart.value].forEach(el => {
    const c = el && echarts.getInstanceByDom(el)
    if (c) c.dispose()
  })
  window.removeEventListener('resize', resize)
  window.removeEventListener('itops:todo-changed', loadDashboard)
})
</script>

<style scoped>
/* 右侧浮动待办面板宽 240px，宽屏下给内容留出安全区，避免指标卡被遮挡 */
@media (min-width: 1200px) {
  .it-page { padding-right: 272px; }
}
.card-row { margin-bottom: 14px; }
/* 上月汇总小卡 */
.lm-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 14px; }
.lm-item {
  background: var(--it-card); border: 1px solid var(--it-border); border-radius: 10px;
  padding: 12px 14px; border-left: 3px solid #c7d6f5;
}
.lm-item .lm-val { font-size: 22px; font-weight: 700; color: var(--it-text); line-height: 1.2; }
.lm-item .lm-val small { font-size: 12px; font-weight: 500; color: var(--it-text-sub); margin-left: 2px; }
.lm-item .lm-label { font-size: 12px; color: var(--it-text-sub); margin-top: 4px; }
@media (max-width: 1100px) { .lm-row { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 640px) { .lm-row { grid-template-columns: repeat(2, 1fr); } }
.extra-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.extra-item {
  display: flex; align-items: baseline; gap: 8px; padding: 9px 16px; cursor: pointer;
  background: var(--it-card); border: 1px solid var(--it-border); border-left-width: 4px; border-radius: 8px;
}
.extra-item .e-val { font-size: 18px; font-weight: 700; }
.extra-item .e-label { font-size: 12px; color: var(--it-text-sub); }
.extra-item.blue { border-left-color: var(--it-primary); }
.extra-item.blue .e-val { color: var(--it-primary); }
.extra-item.red { border-left-color: var(--it-danger); }
.extra-item.red .e-val { color: var(--it-danger); }
.extra-item.orange { border-left-color: var(--it-warning); }
.extra-item.orange .e-val { color: var(--it-warning); }
.extra-item.green { border-left-color: var(--it-success); }
.extra-item.green .e-val { color: var(--it-success); }
.metric-card { border-radius: 10px; padding: 16px; color: #fff; margin-bottom: 8px; }
.metric-card .m-val { font-size: 26px; font-weight: 700; }
.metric-card .m-val small { font-size: 13px; font-weight: 400; opacity: 0.9; }
.metric-card .m-label { font-size: 12px; opacity: 0.92; margin-top: 4px; }
.metric-card .m-label .sub { font-size: 11px; opacity: 0.85; }
.blue { background: linear-gradient(135deg,#2f6fed,#5b8def); }
.green { background: linear-gradient(135deg,#18a058,#36c47e); }
.orange { background: linear-gradient(135deg,#f0a020,#f7b84b); }
.purple { background: linear-gradient(135deg,#7c5cff,#9d82ff); }
.cyan { background: linear-gradient(135deg,#0fb5d6,#42c8e0); }
.teal { background: linear-gradient(135deg,#13b5b1,#3fd0c9); }
.chart-row { margin-bottom: 14px; }
.chart { height: 280px; }
.goal-center { text-align: center; padding: 16px 0; }
.goal-sub { margin-top: 10px; color: var(--it-text-sub); font-size: 13px; }
.todo-line { padding: 6px 0; border-bottom: 1px dashed var(--it-border); font-size: 13px; color: #4a5266; }
.empty { color: var(--it-text-sub); font-size: 13px; padding: 10px 0; }
.due-alert { border: 1px solid #f3c4c0; background: #fff7f6; }
.due-item { display: flex; align-items: center; gap: 14px; padding: 8px 0; border-bottom: 1px dashed #f0d3cf; font-size: 13px; }
.due-item:last-child { border-bottom: none; }
.due-name { font-weight: 600; color: #2b3245; flex: 1; }
.due-progress { color: #c0392b; white-space: nowrap; }
.due-date { color: var(--it-text-sub); white-space: nowrap; }
.dark .due-alert { background: #2a1f1d; border-color: #6b3b34; }
.dark .due-item { border-color: #4a3030; }
.dark .due-name { color: var(--it-text); }
</style>
