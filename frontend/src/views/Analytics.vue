<template>
  <div class="it-page">
    <div class="it-between page-head">
      <div>
        <h3 class="it-section-title" style="margin:0">团队运营分析</h3>
        <div class="page-sub">全公司工单数据 · 用于月度复盘与向上汇报（{{ data.range_label || '本月' }}）</div>
      </div>
      <div class="head-actions">
        <el-radio-group v-model="range" size="small" @change="load">
          <el-radio-button value="today">今日</el-radio-button>
          <el-radio-button value="week">本周</el-radio-button>
          <el-radio-button value="month">本月</el-radio-button>
          <el-radio-button value="last_month">上月</el-radio-button>
          <el-radio-button value="year">本年</el-radio-button>
        </el-radio-group>
        <el-button size="small" :loading="loading" @click="load"><el-icon><Refresh /></el-icon> 刷新</el-button>
      </div>
    </div>

    <!-- 数据体检提示：只在发现异常时出现，可一键修复 -->
    <el-alert v-if="health.issues > 0" type="warning" :closable="false" show-icon class="health-bar">
      <template #title>
        数据体检发现 {{ health.issues }} 条异常工单会影响统计口径：
        <span v-if="health.finish_before_happen">完成时间早于发生时间 {{ health.finish_before_happen }} 条、</span>
        <span v-if="health.done_without_finish">已完成但缺完成时间 {{ health.done_without_finish }} 条、</span>
        <span v-if="health.happen_in_future">发生时间在未来 {{ health.happen_in_future }} 条</span>
        <el-button size="small" type="warning" plain style="margin-left:8px" :loading="repairing" @click="onRepair">一键修复</el-button>
      </template>
    </el-alert>

    <!-- 核心指标 -->
    <el-row :gutter="14" class="card-row">
      <el-col :xs="12" :sm="8" :md="4">
        <div class="metric-card blue">
          <div class="m-val">{{ m.accepted }}<small> ({{ diffText(m.accepted_diff) }})</small></div>
          <div class="m-label">受理工单 · 较{{ data.prev_label || '上期' }}</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="metric-card green">
          <div class="m-val">{{ m.done }}<small> ({{ diffText(m.done_diff) }})</small></div>
          <div class="m-label">完成工单 · 按完成时间</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="metric-card cyan">
          <div class="m-val">{{ m.done_rate }}<small> %</small></div>
          <div class="m-label">本期完成率</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="metric-card purple">
          <div class="m-val">{{ m.avg_hours === null ? '—' : m.avg_hours }}<small v-if="m.avg_hours !== null"> h</small></div>
          <div class="m-label">平均处理时长 · {{ m.avg_hours === null ? '本期无起止时间完整的工单' : '较' + (data.prev_label || '上期') + ' ' + hoursDiffText }}</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="metric-card" :class="m.over24 > 0 ? 'red pulse' : 'teal'">
          <div class="m-val">{{ m.backlog }}<small v-if="m.over24 > 0"> / 超24h {{ m.over24 }}</small></div>
          <div class="m-label">当前积压未闭环<template v-if="m.over24 > 0"> · 需重点关注</template></div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="metric-card orange">
          <div class="m-val">{{ m.per_capita }}<small> 单/人</small></div>
          <div class="m-label">人均产出 · {{ m.active_users }} 人参与</div>
        </div>
      </el-col>
    </el-row>

    <!-- SLA / 满意度 / 故障（有数据才展示对应卡片） -->
    <el-row :gutter="14" class="card-row">
      <el-col :xs="12" :sm="6" :md="4">
        <div class="metric-card" :class="data.sla.respond_rate === null ? 'cyan' : data.sla.respond_rate >= 90 ? 'green' : data.sla.respond_rate >= 70 ? 'orange' : 'red'">
          <div class="m-val">{{ data.sla.respond_rate === null ? '—' : data.sla.respond_rate }}<small v-if="data.sla.respond_rate !== null"> %</small></div>
          <div class="m-label">SLA 响应达成率<small v-if="data.sla.respond_base" class="sub">（{{ data.sla.respond_base }} 单）</small></div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6" :md="4">
        <div class="metric-card" :class="data.sla.resolve_rate === null ? 'cyan' : data.sla.resolve_rate >= 90 ? 'green' : data.sla.resolve_rate >= 70 ? 'orange' : 'red'">
          <div class="m-val">{{ data.sla.resolve_rate === null ? '—' : data.sla.resolve_rate }}<small v-if="data.sla.resolve_rate !== null"> %</small></div>
          <div class="m-label">SLA 解决达成率<small v-if="data.sla.resolve_base" class="sub">（{{ data.sla.resolve_base }} 单）</small></div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6" :md="4">
        <div class="metric-card" :class="data.sla.sla_overdue_now > 0 ? 'red' : 'cyan'">
          <div class="m-val">{{ data.sla.sla_overdue_now }}<small> 单</small></div>
          <div class="m-label">当前超出时限未完成</div>
        </div>
      </el-col>
      <el-col v-if="data.satisfy.count > 0" :xs="12" :sm="6" :md="4">
        <div class="metric-card" :class="data.satisfy.score >= 4.5 ? 'green' : data.satisfy.score >= 3.5 ? 'orange' : 'red'">
          <div class="m-val">{{ data.satisfy.score }}<small> / 5</small></div>
          <div class="m-label">服务满意度 · {{ data.satisfy.count }} 条评价</div>
        </div>
      </el-col>
      <el-col v-if="data.incident.total > 0" :xs="12" :sm="6" :md="4">
        <div class="metric-card" :class="data.incident.ongoing > 0 ? 'red' : 'purple'">
          <div class="m-val">{{ data.incident.total }}<small> 起</small></div>
          <div class="m-label">本期故障<template v-if="data.incident.ongoing"> · {{ data.incident.ongoing }} 未恢复</template></div>
        </div>
      </el-col>
      <el-col v-if="data.incident.total > 0" :xs="12" :sm="6" :md="4">
        <div class="metric-card blue">
          <div class="m-val">{{ data.incident.avg_hours }}<small> h</small></div>
          <div class="m-label">故障平均恢复时长</div>
        </div>
      </el-col>
    </el-row>

    <!-- 汇报要点（自动生成，可一键复制） -->
    <div class="it-card brief-card">
      <div class="it-between" style="margin-bottom:10px">
        <h4 class="it-section-title" style="margin:0">本期汇报要点（自动生成）</h4>
        <div class="it-flex it-gap">
          <el-button size="small" @click="copyBrief"><el-icon><CopyDocument /></el-icon> 复制要点</el-button>
          <el-button size="small" text @click="showTips = !showTips">{{ showTips ? '收起说明' : '汇报口径说明' }}</el-button>
        </div>
      </div>
      <ol class="brief-list">
        <li v-for="(b, i) in brief" :key="i" :class="b.level">
          <span class="brief-tag" v-if="b.level === 'danger'">重点</span>
          <span class="brief-tag warn" v-else-if="b.level === 'warn'">关注</span>
          <span v-html="b.text"></span>
        </li>
      </ol>
      <div v-if="showTips" class="tips">
        <p><b>可直接写进汇报（结果类）：</b>受理量 / 完成量及其环比、完成率、平均处理时长、Top 问题类别与应用系统、人均产出、知识沉淀数量。领导最关心的是「量、效率、趋势」，不是过程。</p>
        <p><b>建议重点标记（用红/黄标出，汇报时口头解释）：</b>超过 24 小时未闭环的积压、环比明显上升的类别、集中在单一系统的批量故障、完成率下滑。</p>
        <p><b>不建议对外汇报（内部管理参考）：</b>个人排名适合内部排班、绩效沟通与工作量均衡，直接用于汇报容易变成「评比」，建议改成「人均产出 / 团队合计」来表述。</p>
      </div>
    </div>

    <!-- 趋势 + 人员产出排名 -->
    <el-row :gutter="14" class="chart-row">
      <el-col :md="15">
        <div class="it-card">
          <h4 class="it-section-title">受理 / 完成趋势</h4>
          <div ref="trendEl" class="chart"></div>
        </div>
      </el-col>
      <el-col :md="9">
        <div class="it-card">
          <h4 class="it-section-title">人员产出排名（{{ data.range_label || '本月' }}完成量）</h4>
          <div ref="userBarEl" class="chart"></div>
        </div>
      </el-col>
    </el-row>

    <!-- 问题类别排名 + 应用系统排名 -->
    <el-row :gutter="14" class="chart-row">
      <el-col :md="12">
        <div class="it-card">
          <div class="it-between" style="margin-bottom:4px">
            <h4 class="it-section-title" style="margin:0">问题类别排名</h4>
            <span class="mini-note">共 {{ data.problemRank.kinds || 0 }} 类</span>
          </div>
          <div ref="paretoEl" class="chart"></div>
        </div>
      </el-col>
      <el-col :md="12">
        <div class="it-card">
          <h4 class="it-section-title">应用系统排名</h4>
          <div ref="appBarEl" class="chart"></div>
        </div>
      </el-col>
    </el-row>

    <!-- 人员明细 + 超期未闭环 -->
    <el-row :gutter="14" class="chart-row">
      <el-col :md="14">
        <div class="it-card">
          <div class="it-between" style="margin-bottom:10px">
            <h4 class="it-section-title" style="margin:0">人员工单明细排名</h4>
            <span class="mini-note">点击姓名可查看该员工本期工单明细</span>
          </div>
          <el-table :data="data.userRank" size="small" :row-class-name="rankRowClass" empty-text="暂无数据">
            <el-table-column label="#" width="46">
              <template #default="{ $index }"><span class="rank-no" :class="'top' + ($index + 1)">{{ $index + 1 }}</span></template>
            </el-table-column>
            <el-table-column label="姓名" min-width="110">
              <template #default="{ row }">
                <span class="link-name" @click="openUser(row)">{{ row.real_name || row.username }}</span>
                <el-tag v-if="row.role === 'auditor'" size="small" type="warning" style="margin-left:6px">审计</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="done_cnt" label="完成" width="70" sortable />
            <el-table-column prop="accept_cnt" label="受理" width="70" sortable />
            <el-table-column prop="done_rate" label="完成率" width="80">
              <template #default="{ row }">
                <span v-if="row.accept_cnt" :class="rateClass(row.done_rate)">{{ row.done_rate }}%</span>
                <span v-else class="mini-note">—</span>
              </template>
            </el-table-column>
            <el-table-column label="平均时长" width="90">
              <template #default="{ row }">{{ row.avg_hours ? row.avg_hours + ' h' : '—' }}</template>
            </el-table-column>
            <el-table-column label="积压" width="70">
              <template #default="{ row }">
                <span :class="{ 'danger-text': row.backlog > 0 }">{{ row.backlog }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="kb_cnt" label="知识沉淀" width="90" />
          </el-table>
        </div>
      </el-col>
      <el-col :md="10">
        <div class="it-card">
          <div class="it-between" style="margin-bottom:10px">
            <h4 class="it-section-title" style="margin:0">超期未闭环工单</h4>
            <el-tag v-if="overdue.total" size="small" type="danger">{{ overdue.total }} 单待跟进</el-tag>
          </div>
          <div v-if="!overdue.list.length" class="empty">当前没有未闭环工单，状态良好</div>
          <template v-else>
            <!-- 固定高度 + 内部滚动：积压几十单也不会把整页拉长 -->
            <div class="ov-list">
              <div v-for="t in overdue.list" :key="t.ticket_id" class="overdue-item" :class="{ serious: (t.age_min || 0) >= 4320 }">
                <div class="ov-top">
                  <span class="ov-hours" :class="{ 'danger-text': (t.age_min || 0) >= 1440 }">已挂 {{ ageText(t) }}</span>
                  <span class="ov-user">{{ t.real_name || '—' }}</span>
                  <span class="ov-type">{{ t.problem_type || '未分类' }}</span>
                </div>
                <div class="ov-content">{{ t.service_content || '（无内容）' }}</div>
                <div class="ov-meta">{{ t.app_system || '—' }} · {{ t.happen_time }}</div>
              </div>
            </div>
            <div class="ov-page">
              <el-pagination
                small background layout="prev, pager, next"
                :total="overdue.total" :page-size="overdue.size" :current-page="overdue.page"
                @current-change="loadOverdue" />
              <span class="mini-note">第 {{ overdue.page }} / {{ Math.max(1, Math.ceil(overdue.total / overdue.size)) }} 页</span>
            </div>
          </template>
        </div>
      </el-col>
    </el-row>

    <!-- 人员维度分析：选定一名员工，只看他自己的工单情况 -->
    <div class="it-card" style="margin-bottom:14px">
      <div class="it-between person-head">
        <div>
          <h4 class="it-section-title" style="margin:0">人员数据分析</h4>
          <span class="mini-note">选定一名员工，只看他的受理、完成、积压与问题分布（已指派给他的工单算他的）</span>
        </div>
        <div class="person-tools">
          <el-select v-model="personId" filterable clearable placeholder="选择员工" size="small" style="width:170px" @change="loadPerson">
            <el-option v-for="u in data.userRank" :key="u.user_id" :label="u.real_name || u.username" :value="u.user_id" />
          </el-select>
          <el-radio-group v-model="personRange" size="small" @change="loadPerson">
            <el-radio-button value="today">今日</el-radio-button>
            <el-radio-button value="week">本周</el-radio-button>
            <el-radio-button value="month">本月</el-radio-button>
            <el-radio-button value="year">本年</el-radio-button>
          </el-radio-group>
        </div>
      </div>

      <div v-if="!personId" class="empty">还没有选择员工。选择后会显示他的工单受理量、完成量、积压、超期与问题类别分布。</div>
      <div v-else v-loading="personLoading">
        <div class="pm-row">
          <div class="pm-item"><div class="pm-val">{{ person.metrics.accepted }}</div><div class="pm-label">受理</div></div>
          <div class="pm-item"><div class="pm-val">{{ person.metrics.done }}</div><div class="pm-label">完成</div></div>
          <div class="pm-item"><div class="pm-val">{{ person.metrics.done_rate }}<small>%</small></div><div class="pm-label">完成率</div></div>
          <div class="pm-item">
            <div class="pm-val">{{ person.metrics.avg_hours === null ? '—' : person.metrics.avg_hours }}<small v-if="person.metrics.avg_hours !== null"> h</small></div>
            <div class="pm-label">平均时长</div>
          </div>
          <div class="pm-item"><div class="pm-val" :class="{ 'danger-text': person.metrics.backlog > 0 }">{{ person.metrics.backlog }}</div><div class="pm-label">当前积压</div></div>
          <div class="pm-item"><div class="pm-val" :class="{ 'danger-text': person.metrics.overdue_now > 0 }">{{ person.metrics.overdue_now }}</div><div class="pm-label">超时未完成</div></div>
          <div class="pm-item">
            <div class="pm-val">{{ person.metrics.satisfy_cnt ? person.metrics.satisfy_avg : '—' }}</div>
            <div class="pm-label">满意度<small v-if="person.metrics.satisfy_cnt">（{{ person.metrics.satisfy_cnt }} 条）</small></div>
          </div>
          <div class="pm-item"><div class="pm-val">{{ person.metrics.kb_cnt }}</div><div class="pm-label">知识沉淀</div></div>
        </div>

        <el-row :gutter="14">
          <el-col :md="14">
            <div class="chart-sub">
              <h5 class="sub-title">受理 / 完成趋势（{{ person.range_label || '本月' }}）</h5>
              <div ref="personTrendEl" class="chart"></div>
            </div>
          </el-col>
          <el-col :md="10">
            <div class="chart-sub">
              <h5 class="sub-title">问题类别分布</h5>
              <div v-if="!person.problemRank.length" class="empty">本期暂无工单</div>
              <div v-show="person.problemRank.length" ref="personTypeEl" class="chart"></div>
            </div>
          </el-col>
        </el-row>

        <div class="sub-title" style="margin:10px 0 8px">最近工单（最多 10 条）</div>
        <el-table :data="person.recent" size="small" empty-text="本期暂无工单">
          <el-table-column prop="happen_time" label="发生时间" width="150" />
          <el-table-column prop="app_system" label="系统" width="110" />
          <el-table-column prop="problem_type" label="类别" width="110" />
          <el-table-column prop="service_content" label="服务内容" show-overflow-tooltip />
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 'done' ? 'success' : (row.status === 'pending' ? 'info' : 'warning')">
                {{ row.status === 'done' ? '完成' : (row.status === 'pending' ? '待接单' : '处理中') }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="耗时" width="80">
            <template #default="{ row }">{{ row.hours == null ? '—' : row.hours + ' h' }}</template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 近 6 个月 + 部门 -->
    <el-row :gutter="14" class="chart-row">
      <el-col :md="15">
        <div class="it-card">
          <h4 class="it-section-title">近 6 个月月度趋势（复盘用）</h4>
          <div ref="monthlyEl" class="chart"></div>
        </div>
      </el-col>
      <el-col :md="9">
        <div class="it-card">
          <h4 class="it-section-title">报障部门排名</h4>
          <div ref="deptEl" class="chart"></div>
        </div>
      </el-col>
    </el-row>

    <!-- 人员工单明细抽屉（只读） -->
    <el-drawer v-model="drawer" :title="drawerTitle" size="60%" direction="rtl">
      <el-table :data="userTickets" size="small" v-loading="drawerLoading" empty-text="本期暂无工单">
        <el-table-column prop="happen_time" label="发生时间" width="150" />
        <el-table-column prop="app_system" label="系统" width="110" />
        <el-table-column prop="problem_type" label="类别" width="110" />
        <el-table-column prop="service_content" label="服务内容" show-overflow-tooltip />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'done' ? 'success' : 'warning'">{{ row.status === 'done' ? '完成' : '处理中' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="80">
          <template #default="{ row }">{{ row.hours == null ? '—' : row.hours + ' h' }}</template>
        </el-table-column>
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import R from '../api'

const range = ref('month')
const loading = ref(false)
const showTips = ref(false)
const data = reactive({
  range_label: '',
  prev_label: '',
  metrics: {},
  trend: [],
  userRank: [],
  problemRank: { list: [], total: 0, kinds: 0 },
  appRank: { list: [], total: 0, kinds: 0 },
  deptRank: { list: [], total: 0, kinds: 0 },
  monthlyTrend: [],
  overdue: [],
  sla: { sla_total: 0, respond_rate: 0, resolve_rate: 0, sla_overdue_now: 0 },
  satisfy: { score: 0, count: 0, good_rate: 0, bad: 0 },
  incident: { total: 0, ongoing: 0, serious: 0, avg_hours: 0, avg_respond_min: 0, byLevel: [] }
})
const m = reactive({ accepted: 0, done: 0, done_rate: 0, avg_hours: 0, backlog: 0, over24: 0, over72: 0, per_capita: 0, active_users: 0, accepted_diff: 0, done_diff: 0, hours_diff: 0, kb_total: 0, kb_new: 0 })

const trendEl = ref(null)
const userBarEl = ref(null)
const paretoEl = ref(null)
const appBarEl = ref(null)
const monthlyEl = ref(null)
const deptEl = ref(null)

const drawer = ref(false)
const drawerTitle = ref('')
const drawerLoading = ref(false)
const userTickets = ref([])

/* ---------- 超期未闭环：独立分页（默认 10 条/页，列表区固定高度滚动） ---------- */
const overdue = reactive({ list: [], total: 0, page: 1, size: 10 })
async function loadOverdue(page) {
  const p = Number(page) || 1
  try {
    const d = await R.getAnalyticsOverdue({ page: p, size: overdue.size })
    overdue.list = d.list || []
    overdue.total = Number(d.total || 0)
    overdue.page = Number(d.page || p)
    overdue.size = Number(d.size || overdue.size)
  } catch (e) { /* 分页失败保留上一页数据 */ }
}

/* ---------- 人员维度分析 ---------- */
const personId = ref(null)
const personRange = ref('month')
const personLoading = ref(false)
const personTrendEl = ref(null)
const personTypeEl = ref(null)
const person = reactive({
  range_label: '',
  user: null,
  metrics: { accepted: 0, done: 0, done_rate: 0, avg_hours: null, backlog: 0, overdue_now: 0, satisfy_avg: 0, satisfy_cnt: 0, kb_cnt: 0 },
  trend: [],
  problemRank: [],
  appRank: [],
  recent: []
})

async function loadPerson() {
  if (!personId.value) return
  personLoading.value = true
  try {
    const d = await R.getAnalyticsPerson({ user_id: personId.value, range: personRange.value })
    Object.assign(person, d)
    await nextTick()
    drawPerson()
  } catch (e) {
    ElMessage.error(e.message || '人员数据加载失败')
  } finally {
    personLoading.value = false
  }
}

function drawPerson() {
  const c = C()
  const trend = person.trend || []
  if (personTrendEl.value) {
    render(personTrendEl.value, {
      tooltip: { trigger: 'axis' },
      legend: { top: 0, itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 12, color: c.sub } },
      grid: { left: 40, right: 16, top: 34, bottom: 28 },
      xAxis: { type: 'category', data: trend.map(t => (t.key || '').slice(5)), ...axisCommon() },
      yAxis: { type: 'value', minInterval: 1, ...axisCommon() },
      series: [
        { name: '受理', type: 'bar', barMaxWidth: 16, itemStyle: { color: c.primary }, data: trend.map(t => t.accepted) },
        { name: '完成', type: 'line', smooth: true, symbolSize: 6, itemStyle: { color: c.success }, lineStyle: { color: c.success }, data: trend.map(t => t.done) }
      ]
    })
  }
  const types = [...(person.problemRank || [])].sort((a, b) => a.value - b.value)
  if (personTypeEl.value && types.length) {
    render(personTypeEl.value, {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: 30, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', minInterval: 1, ...axisCommon() },
      yAxis: { type: 'category', data: types.map(t => t.name), axisLabel: { color: c.sub, fontSize: 11, width: 88, overflow: 'truncate' } },
      series: [{ type: 'bar', barMaxWidth: 14, itemStyle: { color: c.warning, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', fontSize: 11, color: c.sub }, data: types.map(t => t.value) }]
    })
  }
}

// 数据体检（异常数据统计）
const health = reactive({ issues: 0, finish_before_happen: 0, done_without_finish: 0, happen_in_future: 0 })
const repairing = ref(false)

// 未闭环时长友好展示：分钟 / 小时 / 天+小时（不再直接抛数字和 h，避免出现「已挂 -7h」这类歧义）
function ageText(t) {
  const min = Math.max(0, Number(t.age_min || 0))
  if (min < 60) return `${min} 分钟`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh ? `${d} 天 ${rh} 小时` : `${d} 天`
}

async function loadHealth() {
  try {
    const h = await R.getDataHealth()
    Object.assign(health, h)
  } catch { /* 体检失败不阻塞主流程 */ }
}

async function onRepair() {
  repairing.value = true
  try {
    const r = await R.repairData()
    ElMessage.success(r.fixed ? `已修复 ${r.fixed} 条异常工单` : '没有需要修复的数据')
    Object.assign(health, r.health || {})
    load()
  } catch (e) { ElMessage.error(e.message) } finally { repairing.value = false }
}

/* ---------- 主题感知 ---------- */
const isDark = () => document.documentElement.classList.contains('dark')
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}
const C = () => ({
  primary: cssVar('--it-primary', '#2f6fed'),
  success: cssVar('--it-success', '#18a058'),
  warning: cssVar('--it-warning', '#f0a020'),
  danger: cssVar('--it-danger', '#e54545'),
  text: cssVar('--it-text', '#2b3245'),
  sub: isDark() ? '#93a0b5' : '#8a93a6',
  split: isDark() ? '#2e3644' : '#eef1f6'
})
function axisCommon() {
  const c = C()
  return {
    axisLine: { lineStyle: { color: c.split } },
    axisLabel: { color: c.sub, fontSize: 11 },
    splitLine: { lineStyle: { color: c.split } }
  }
}
function render(el, option) {
  if (!el) return
  let c = echarts.getInstanceByDom(el)
  if (!c) c = echarts.init(el)
  c.setOption(option, true)
}

/* ---------- 加载 ---------- */
async function load() {
  loading.value = true
  try {
    const [d] = await Promise.all([R.getAnalytics(range.value), loadHealth()])
    Object.assign(data, d)
    Object.assign(m, d.metrics)
    // 超期列表首屏直接用总览返回的第一页，之后翻页走独立接口
    overdue.list = d.overdue || []
    overdue.total = Number(d.overdue_total || 0)
    overdue.page = 1
    await nextTick()
    drawAll()
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function diffText(d) {
  const n = Number(d || 0)
  if (n > 0) return '+' + n
  return String(n)
}
// 时长环比：数值变大=更慢，变小=更快（直接显示"慢/快"比正负号更直观）
const hoursDiffText = computed(() => {
  const n = Number(m.hours_diff || 0)
  if (n > 0) return `慢 ${n} 小时`
  if (n < 0) return `快 ${Math.abs(n)} 小时`
  return '持平'
})
function rateClass(r) {
  if (r >= 90) return 'rate-good'
  if (r >= 60) return 'rate-mid'
  return 'rate-bad'
}
function rankRowClass({ rowIndex }) {
  return rowIndex < 3 ? 'rank-top-row' : ''
}

/* ---------- 图表 ---------- */
function drawTrend() {
  const c = C()
  const keys = data.trend.map(t => String(t.key))
  const label = keys.map(k => (k.length === 2 ? k + ':00' : k.length >= 10 ? k.slice(5) : k))
  const accepted = data.trend.map(t => t.accepted)
  const done = data.trend.map(t => t.done)
  render(trendEl.value, {
    tooltip: { trigger: 'axis' },
    legend: { data: ['受理', '完成'], textStyle: { color: c.sub }, right: 0, top: 0 },
    grid: { left: 44, right: 16, top: 34, bottom: 28 },
    xAxis: { type: 'category', data: label, ...axisCommon() },
    yAxis: { type: 'value', minInterval: 1, ...axisCommon() },
    series: [
      { name: '受理', type: 'bar', data: accepted, barMaxWidth: 18, itemStyle: { color: c.primary, borderRadius: [3, 3, 0, 0] } },
      { name: '完成', type: 'line', smooth: true, data: done, symbolSize: 6, itemStyle: { color: c.success }, lineStyle: { color: c.success, width: 2 } }
    ]
  })
}

function drawUserBar() {
  const c = C()
  const rows = data.userRank.filter(u => u.done_cnt > 0).slice(0, 10).reverse()
  if (!rows.length) {
    render(userBarEl.value, { title: { text: '本期暂无完成工单', left: 'center', top: 'middle', textStyle: { color: c.sub, fontSize: 13 } } })
    return
  }
  render(userBarEl.value, {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => `${p[0].name}<br/>完成 ${p[0].value} 单` },
    grid: { left: 78, right: 34, top: 8, bottom: 8 },
    xAxis: { type: 'value', minInterval: 1, ...axisCommon() },
    yAxis: { type: 'category', data: rows.map(u => u.real_name || u.username), ...axisCommon() },
    series: [{
      type: 'bar', data: rows.map(u => u.done_cnt), barMaxWidth: 16,
      itemStyle: { color: c.primary, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', color: c.sub, fontSize: 11 }
    }]
  })
}

function drawPareto() {
  const c = C()
  const list = data.problemRank.list || []
  if (!list.length) {
    render(paretoEl.value, { title: { text: '本期暂无工单', left: 'center', top: 'middle', textStyle: { color: c.sub, fontSize: 13 } } })
    return
  }
  // 只保留排名柱状图（帕累托的累计占比折线与 80% 参考线已按要求移除）
  render(paretoEl.value, {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: ps => {
        const it = list[ps[0].dataIndex]
        return it ? `${it.name}<br/>工单 ${it.value} 单（占比 ${it.ratio}%）` : ''
      }
    },
    grid: { left: 44, right: 20, top: 26, bottom: 46 },
    xAxis: {
      type: 'category', data: list.map(i => i.name),
      axisLabel: { color: c.sub, fontSize: 11, interval: 0, rotate: list.length > 6 ? 30 : 0, formatter: v => (v && v.length > 7 ? v.slice(0, 7) + '…' : v) },
      axisLine: { lineStyle: { color: c.split } }
    },
    yAxis: { type: 'value', minInterval: 1, name: '单', nameTextStyle: { color: c.sub, fontSize: 11 }, ...axisCommon() },
    series: [{
      name: '工单量',
      type: 'bar',
      barMaxWidth: 28,
      itemStyle: { color: c.primary, borderRadius: [4, 4, 0, 0] },
      label: { show: true, position: 'top', color: c.sub, fontSize: 11 },
      data: list.map(i => i.value)
    }]
  })
}

function drawAppBar() {
  const c = C()
  const list = [...(data.appRank.list || [])].slice(0, 8).reverse()
  if (!list.length) {
    render(appBarEl.value, { title: { text: '本期暂无工单', left: 'center', top: 'middle', textStyle: { color: c.sub, fontSize: 13 } } })
    return
  }
  render(appBarEl.value, {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: ps => `${ps[0].name}<br/>${ps[0].value} 单` },
    grid: { left: 96, right: 46, top: 8, bottom: 8 },
    xAxis: { type: 'value', minInterval: 1, ...axisCommon() },
    yAxis: { type: 'category', data: list.map(i => i.name), ...axisCommon() },
    series: [{
      type: 'bar', data: list.map((i, idx) => ({ value: i.value, itemStyle: { color: idx === list.length - 1 ? c.warning : c.primary, borderRadius: [0, 4, 4, 0] } })),
      barMaxWidth: 16,
      label: { show: true, position: 'right', color: c.sub, fontSize: 11, formatter: p => `${p.value} (${list[p.dataIndex].ratio}%)` }
    }]
  })
}

function drawMonthly() {
  const c = C()
  const rows = data.monthlyTrend || []
  render(monthlyEl.value, {
    tooltip: { trigger: 'axis' },
    legend: { data: ['受理', '完成'], textStyle: { color: c.sub }, right: 0, top: 0 },
    grid: { left: 44, right: 16, top: 34, bottom: 28 },
    xAxis: { type: 'category', data: rows.map(r => r.month), ...axisCommon() },
    yAxis: { type: 'value', minInterval: 1, ...axisCommon() },
    series: [
      { name: '受理', type: 'bar', data: rows.map(r => r.accepted), barMaxWidth: 22, itemStyle: { color: c.primary, borderRadius: [3, 3, 0, 0] } },
      { name: '完成', type: 'bar', data: rows.map(r => r.done), barMaxWidth: 22, itemStyle: { color: c.success, borderRadius: [3, 3, 0, 0] } }
    ]
  })
}

function drawDept() {
  const c = C()
  const list = [...(data.deptRank.list || [])].slice(0, 8).reverse()
  if (!list.length) {
    render(deptEl.value, { title: { text: '本期暂无工单', left: 'center', top: 'middle', textStyle: { color: c.sub, fontSize: 13 } } })
    return
  }
  render(deptEl.value, {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: ps => `${ps[0].name}<br/>${ps[0].value} 单` },
    grid: { left: 90, right: 42, top: 8, bottom: 8 },
    xAxis: { type: 'value', minInterval: 1, ...axisCommon() },
    yAxis: { type: 'category', data: list.map(i => i.name), ...axisCommon() },
    series: [{
      type: 'bar', data: list.map(i => i.value), barMaxWidth: 16,
      itemStyle: { color: c.primary, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', color: c.sub, fontSize: 11 }
    }]
  })
}

function drawAll() {
  drawTrend(); drawUserBar(); drawPareto(); drawAppBar(); drawMonthly(); drawDept()
}

/* ---------- 汇报要点（规则生成） ---------- */
const brief = computed(() => {
  const out = []
  const label = data.range_label || '本期'
  const prev = data.prev_label || '上期'
  // 1. 总量
  const diff = Number(m.accepted_diff || 0)
  const dir = diff > 0 ? `增加 ${diff} 单` : diff < 0 ? `减少 ${Math.abs(diff)} 单` : '与前期基本持平'
  out.push({ level: '', text: `${label}团队共受理工单 <b>${m.accepted}</b> 单，较${prev}${dir}；完成 <b>${m.done}</b> 单，完成率 <b>${m.done_rate}%</b>。` })

  // 2. 效率
  const hoursDiff = Number(m.hours_diff || 0)
  const speed = hoursDiff > 0 ? `比${prev}慢 ${hoursDiff} 小时` : hoursDiff < 0 ? `比${prev}快 ${Math.abs(hoursDiff)} 小时` : `与${prev}持平`
  out.push({ level: '', text: m.avg_hours === null
    ? `本期工单缺少完整起止时间，平均处理时长暂无法计算；人均完成 <b>${m.per_capita} 单</b>（${m.active_users} 人参与）。`
    : `平均处理时长 <b>${m.avg_hours} 小时</b>，${speed}；人均完成 <b>${m.per_capita} 单</b>（${m.active_users} 人参与）。` })

  // 3. 问题类别集中度（重点）
  const pl = data.problemRank.list || []
  const pTotal = data.problemRank.total || 0
  if (pl.length) {
    const key = []
    let cum = 0
    for (const it of pl) { key.push(it); cum = it.cum_ratio; if (cum >= 80) break }
    const names = key.map(i => `「${i.name}」`).join('、')
    const sum = key.reduce((s, i) => s + i.value, 0)
    const ratio = pTotal ? Math.round(sum / pTotal * 100) : 0
    out.push({ level: 'warn', text: `问题集中在 ${names} 共 ${key.length} 类，合计 <b>${sum}</b> 单（占 <b>${ratio}%</b>），治理这几类即可覆盖大部分工作量；其中「${pl[0].name}」最多（${pl[0].value} 单，占 ${pl[0].ratio}%）。` })
  }

  // 4. 应用系统
  const al = data.appRank.list || []
  if (al.length) {
    out.push({ level: '', text: `应用系统中「${al[0].name}」相关工单最多（<b>${al[0].value}</b> 单，占 ${al[0].ratio}%），是本期最需要关注的系统。` })
  }

  // 5. 积压（重点标记）
  if (Number(m.backlog) > 0) {
    const over = Number(m.over24 || 0)
    const over72 = Number(m.over72 || 0)
    out.push({
      level: over > 0 ? 'danger' : 'warn',
      text: `当前仍有 <b>${m.backlog}</b> 单未闭环${over > 0 ? `，其中 <b>${over}</b> 单已超过 24 小时未完成${over72 > 0 ? `（${over72} 单超 72 小时）` : ''}，需优先跟进` : '，整体风险可控'}。`
    })
  }

  // 6. 人员产出
  const ur = (data.userRank || []).filter(u => u.done_cnt > 0).slice(0, 3)
  if (ur.length) {
    out.push({ level: '', text: `个人产出前三：${ur.map(u => `${u.real_name || u.username}（${u.done_cnt} 单）`).join('、')}。` })
  }

  // 7. 知识沉淀
  if (Number(m.kb_total) > 0) {
    out.push({ level: '', text: `知识库累计 <b>${m.kb_total}</b> 条标准方案，本期新增 <b>${m.kb_new}</b> 条，重复问题可优先复用已有方案。` })
  }

  // 8. SLA 时效
  const sla = data.sla || {}
  if (Number(sla.sla_total) > 0) {
    const bad = Number(sla.sla_overdue_now || 0)
    out.push({
      level: bad > 0 ? 'warn' : '',
      text: `SLA 达成情况：响应及时率 <b>${sla.respond_rate === null ? '暂无有效样本' : sla.respond_rate + '%'}</b>（${sla.respond_base || 0} 单有接单时间），解决及时率 <b>${sla.resolve_rate === null ? '暂无有效样本' : sla.resolve_rate + '%'}</b>${bad > 0 ? `，当前仍有 <b>${bad}</b> 单已超出约定时限未完成` : '，全部在约定时限内'}。`
    })
  }

  // 9. 满意度
  const st = data.satisfy || {}
  if (Number(st.count) > 0) {
    out.push({
      level: Number(st.score) < 4 ? 'warn' : '',
      text: `员工服务满意度 <b>${st.score}</b> 分（满分 5 分，${st.count} 条评价）${st.bad > 0 ? `，其中 ${st.bad} 条为 2 分及以下差评，建议回访` : '，反馈良好'}。`
    })
  }

  // 10. 故障（没有故障记录就不写这段）
  const inc = data.incident || {}
  if (Number(inc.total) > 0) {
    out.push({
      level: Number(inc.serious) > 0 ? 'danger' : 'warn',
      text: `本期发生故障 <b>${inc.total}</b> 起${Number(inc.serious) > 0 ? `（其中 P1/P2 严重故障 <b>${inc.serious}</b> 起）` : ''}，平均恢复时长 <b>${inc.avg_hours} 小时</b>，平均响应 <b>${inc.avg_respond_min} 分钟</b>${Number(inc.ongoing) > 0 ? `，仍有 <b>${inc.ongoing}</b> 起未恢复` : '，均已恢复'}。`
    })
  }
  return out
})

async function copyBrief() {
  const text = `【${data.range_label || '本期'} IT 运维工作汇报】\n` + brief.value
    .map((b, i) => `${i + 1}. ${b.text.replace(/<[^>]+>/g, '')}`)
    .join('\n')
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('汇报要点已复制到剪贴板')
  } catch (e) {
    ElMessage.warning('浏览器不允许自动复制，请手动选择文本')
  }
}

/* ---------- 下钻 ---------- */
async function openUser(row) {
  drawerTitle.value = `${row.real_name || row.username} · ${data.range_label || '本期'}工单明细`
  drawer.value = true
  drawerLoading.value = true
  try {
    userTickets.value = await R.getAnalyticsUserTickets({ user_id: row.user_id, range: range.value })
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    drawerLoading.value = false
  }
}

function resize() {
  ;[trendEl.value, userBarEl.value, paretoEl.value, appBarEl.value, monthlyEl.value, deptEl.value,
    personTrendEl.value, personTypeEl.value].forEach(el => {
    const c = el && echarts.getInstanceByDom(el)
    if (c) c.resize()
  })
}

onMounted(() => {
  load()
  window.addEventListener('resize', resize)
})
onBeforeUnmount(() => {
  ;[trendEl.value, userBarEl.value, paretoEl.value, appBarEl.value, monthlyEl.value, deptEl.value,
    personTrendEl.value, personTypeEl.value].forEach(el => {
    const c = el && echarts.getInstanceByDom(el)
    if (c) c.dispose()
  })
  window.removeEventListener('resize', resize)
})
</script>

<style scoped>
/* 右侧浮动待办面板宽 240px，宽屏下给内容留出安全区，避免指标卡/周期切换被遮挡 */
@media (min-width: 1200px) {
  .it-page { padding-right: 272px; }
}
.page-head { margin-bottom: 14px; }
.page-sub { font-size: 12px; color: var(--it-text-sub); margin-top: 4px; }
.head-actions { display: flex; align-items: center; gap: 10px; }
.card-row { margin-bottom: 14px; }
.health-bar { margin-bottom: 14px; border-radius: 10px; }
.health-bar :deep(.el-alert__title) { font-size: 13px; line-height: 1.7; }
.metric-card { border-radius: 10px; padding: 16px; color: #fff; margin-bottom: 8px; }
.metric-card .m-val { font-size: 26px; font-weight: 700; }
.metric-card .m-val small { font-size: 12px; font-weight: 400; opacity: 0.9; }
.metric-card .m-label .sub { font-size: 11px; opacity: .85; }
.metric-card .m-label { font-size: 12px; opacity: 0.92; margin-top: 4px; }
.blue { background: linear-gradient(135deg, #2f6fed, #5b8def); }
.green { background: linear-gradient(135deg, #18a058, #36c47e); }
.orange { background: linear-gradient(135deg, #f0a020, #f7b84b); }
.purple { background: linear-gradient(135deg, #7c5cff, #9d82ff); }
.cyan { background: linear-gradient(135deg, #0fb5d6, #42c8e0); }
.teal { background: linear-gradient(135deg, #13b5b1, #3fd0c9); }
.red { background: linear-gradient(135deg, #e54545, #f37373); }

.brief-card { margin-bottom: 14px; }
.brief-list { margin: 0; padding-left: 20px; }
.brief-list li { font-size: 13px; line-height: 1.9; color: var(--it-text); }
.brief-list li.danger { color: #c0392b; }
.brief-list li.warn { color: #b4720b; }
.brief-list b { font-weight: 700; }
.brief-tag { display: inline-block; font-size: 11px; padding: 0 6px; border-radius: 8px; background: #e54545; color: #fff; margin-right: 6px; vertical-align: middle; }
.brief-tag.warn { background: #f0a020; }
.tips { margin-top: 12px; padding: 12px 14px; background: var(--it-bg); border-radius: 8px; font-size: 12.5px; line-height: 1.85; color: var(--it-text-sub); }
.tips p { margin: 0 0 6px; }
.tips p:last-child { margin-bottom: 0; }
.tips b { color: var(--it-text); }

.chart-row { margin-bottom: 14px; }
.chart { height: 300px; }
.mini-note { font-size: 12px; color: var(--it-text-sub); }
.link-name { color: var(--it-primary); cursor: pointer; }
.link-name:hover { text-decoration: underline; }
.rank-no { display: inline-block; width: 20px; text-align: center; font-weight: 700; color: var(--it-text-sub); }
.rank-no.top1 { color: #e54545; }
.rank-no.top2 { color: #f0a020; }
.rank-no.top3 { color: #2f6fed; }
.rate-good { color: var(--it-success); }
.rate-mid { color: var(--it-warning); }
.rate-bad { color: var(--it-danger); }
.danger-text { color: var(--it-danger); font-weight: 600; }
:deep(.rank-top-row) { background: var(--it-primary-light); }

.overdue-item { padding: 8px 0; border-bottom: 1px dashed var(--it-border); }
.overdue-item:last-child { border-bottom: none; }
.overdue-item.serious { background: rgba(229, 69, 69, 0.05); }
.ov-top { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.ov-hours { color: var(--it-text-sub); }
.ov-user { font-weight: 600; color: var(--it-text); }
.ov-type { margin-left: auto; background: var(--it-bg); color: var(--it-text-sub); padding: 1px 8px; border-radius: 8px; }
.ov-content { font-size: 13px; color: var(--it-text); margin: 4px 0 2px; }
.ov-meta { font-size: 11.5px; color: var(--it-text-sub); }
.empty { color: var(--it-text-sub); font-size: 13px; padding: 14px 0; text-align: center; }

/* 超期工单：固定高度内部滚动（约 5 条）+ 底部分页 */
.ov-list { max-height: 330px; overflow-y: auto; padding-right: 4px; }
.ov-list::-webkit-scrollbar { width: 6px; }
.ov-list::-webkit-scrollbar-thumb { background: var(--it-border); border-radius: 3px; }
.ov-list::-webkit-scrollbar-track { background: transparent; }
.ov-page { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--it-border); }

/* 人员数据分析 */
.person-head { margin-bottom: 12px; flex-wrap: wrap; gap: 10px; }
.person-tools { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pm-row { display: grid; grid-template-columns: repeat(8, 1fr); gap: 10px; margin-bottom: 12px; }
.pm-item { background: var(--it-bg); border-radius: 8px; padding: 10px 12px; }
.pm-item .pm-val { font-size: 19px; font-weight: 700; color: var(--it-text); line-height: 1.2; }
.pm-item .pm-val small { font-size: 11px; font-weight: 500; color: var(--it-text-sub); }
.pm-item .pm-label { font-size: 11.5px; color: var(--it-text-sub); margin-top: 3px; }
.chart-sub { border: 1px dashed var(--it-border); border-radius: 8px; padding: 10px 12px 4px; }
.sub-title { font-size: 13px; font-weight: 600; color: var(--it-text); margin: 0 0 6px; }
@media (max-width: 1200px) { .pm-row { grid-template-columns: repeat(4, 1fr); } }
@media (max-width: 768px) {
  .head-actions { flex-wrap: wrap; }
  .chart { height: 240px; }
  .pm-row { grid-template-columns: repeat(2, 1fr); }
}
</style>
