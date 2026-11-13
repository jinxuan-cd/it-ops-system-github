<!--
  日报月报查阅 —— IT 运维工单台账与日报自动管理系统
  管理员与审计员查看全员提交情况与内容

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.2
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page">
    <div class="it-between page-head">
      <h3 class="it-section-title" style="margin:0">日报月报查阅</h3>
      <el-button :loading="loading" @click="reload"><el-icon><Refresh /></el-icon> 刷新</el-button>
    </div>

    <!-- 提交情况概览（仅日报维度，管理员/审计员关心谁没交） -->
    <!-- 概览只统计日报：管理员/审计员最关心「今天谁没交」，月报份数只作参考 -->
    <div class="it-card stat-card">
      <div class="stat">
        <div class="stat-num">{{ summary.today_submitted }}<span class="stat-sub">/ {{ summary.expected }}</span></div>
        <div class="stat-label">今日已提交日报</div>
      </div>
      <div class="stat">
        <div class="stat-num">{{ summary.month_count }}</div>
        <div class="stat-label">本月日报份数</div>
      </div>
      <div class="stat">
        <div class="stat-num" :class="{ warn: missing.length > 0 }">{{ missing.length }}</div>
        <div class="stat-label">今日未提交人数</div>
      </div>
      <!-- 近 7 天提交人数：柱高按当期最大值归一，当天 0 人也占位不消失 -->
      <div class="stat trend">
        <div class="trend-bars">
          <div v-for="t in summary.trend" :key="t.date" class="bar-wrap" :title="`${t.date}：${t.count} 人`">
            <div class="bar" :style="{ height: barH(t.count) + 'px' }"></div>
            <span class="bar-x">{{ t.date.slice(5) }}</span>
          </div>
          <div v-if="!summary.trend || !summary.trend.length" class="trend-empty">暂无数据</div>
        </div>
        <div class="stat-label">最近 7 天每日提交人数</div>
      </div>
    </div>

    <!-- 未提交名单单独成块：不用点进列表就能直接点名催交 -->
    <div v-if="missing.length" class="it-card miss-card">
      <div class="miss-head">
        <span class="miss-title">今日未提交（{{ missing.length }}）</span>
        <span class="miss-tip">{{ missingDate }}</span>
      </div>
      <div class="miss-list">
        <el-tag v-for="m in missing" :key="m.user_id" size="small" type="warning" effect="plain">
          {{ m.real_name || m.username }}
        </el-tag>
      </div>
    </div>

    <div class="it-card">
      <el-tabs v-model="tab" @tab-change="onTabChange">
        <!-- ============ 日报 ============ -->
        <el-tab-pane label="团队日报" name="daily">
          <div class="filters">
            <!-- 日报筛选：人员 / 日期区间 / 正文关键词，任一变化都回到第一页重查 -->
            <el-select v-model="f.user_id" placeholder="全部人员" clearable filterable style="width:150px" @change="searchDaily">
              <el-option v-for="u in staff" :key="u.user_id" :label="u.real_name || u.username" :value="u.user_id" />
            </el-select>
            <el-date-picker
              v-model="f.range" type="daterange" value-format="YYYY-MM-DD"
              start-placeholder="开始日期" end-placeholder="结束日期" style="width:240px"
              @change="searchDaily"
            />
            <el-input v-model="f.keyword" placeholder="搜索日报内容" clearable style="width:180px" @keyup.enter="searchDaily" @clear="searchDaily" />
            <el-button type="primary" @click="searchDaily"><el-icon><Search /></el-icon> 查询</el-button>
            <el-button @click="resetDaily">重置</el-button>
          </div>

          <!-- 桌面：表格 -->
          <el-table v-if="!isMobile" :data="daily.list" stripe v-loading="loading" class="daily-table">
            <el-table-column prop="report_date" label="日期" width="110" />
            <el-table-column label="提交人" width="100">
              <template #default="{ row }">
                <span>{{ row.real_name || row.username }}</span>
              </template>
            </el-table-column>
            <el-table-column label="今日工作" min-width="260">
              <template #default="{ row }">
                <div class="cell-text">{{ oneLine(row.today_work) }}</div>
              </template>
            </el-table-column>
            <el-table-column label="需协调" min-width="140">
              <template #default="{ row }">
                <div class="cell-text">{{ oneLine(row.need_help) || '—' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="明日计划" min-width="160">
              <template #default="{ row }">
                <div class="cell-text">{{ oneLine(row.tomorrow_plan) || '—' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="86" class-name="col-ops">
              <template #default="{ row }">
                <el-button size="small" text type="primary" @click="openDaily(row)">查看</el-button>
              </template>
            </el-table-column>
          </el-table>

          <!-- 手机：卡片 -->
          <div v-else class="m-list" v-loading="loading">
            <div v-for="row in daily.list" :key="row.report_id" class="m-item" @click="openDaily(row)">
              <div class="m-head">
                <span class="m-name">{{ row.real_name || row.username }}</span>
                <span class="m-date">{{ row.report_date }}</span>
              </div>
              <div class="m-body">{{ oneLine(row.today_work) }}</div>
              <div class="m-foot">
                <span v-if="row.need_help" class="m-flag">需协调</span>
                <span class="m-more">查看全文 ›</span>
              </div>
            </div>
            <el-empty v-if="!daily.list.length && !loading" description="暂无日报" :image-size="80" />
          </div>

          <!-- 分页只在总数超过一页时出现，数据少的时候不占版面 -->
          <div class="pager" v-if="daily.total > daily.size">
            <el-pagination
              background layout="prev, pager, next, sizes, total"
              :total="daily.total" :current-page="daily.page" :page-size="daily.size"
              :page-sizes="[10, 20, 50]"
              @current-change="onPage" @size-change="onSize"
            />
          </div>
        </el-tab-pane>

        <!-- ============ 月报 ============ -->
        <el-tab-pane label="团队月报" name="monthly">
          <div class="filters">
            <el-date-picker v-model="m.month" type="month" value-format="YYYY-MM" placeholder="选择月份" style="width:150px" @change="loadMonthly" />
            <el-select v-model="m.user_id" placeholder="全部人员" clearable filterable style="width:150px" @change="loadMonthly">
              <el-option v-for="u in staff" :key="u.user_id" :label="u.real_name || u.username" :value="u.user_id" />
            </el-select>
            <el-input v-model="m.keyword" placeholder="搜索月报内容" clearable style="width:180px" @keyup.enter="loadMonthly" @clear="loadMonthly" />
            <el-button type="primary" @click="loadMonthly"><el-icon><Search /></el-icon> 查询</el-button>
          </div>

          <!-- 月报顶部直接给「已提交 / 应交」与未提交名单，月度考核口径一眼可查 -->
          <div class="mon-summary">
            本月已提交 <strong>{{ mon.total }}</strong> 份 / 应提交 <strong>{{ mon.expected }}</strong> 人
            <span v-if="mon.missing && mon.missing.length" class="mon-miss">
              未提交：{{ mon.missing.map(x => x.real_name || x.username).join('、') }}
            </span>
          </div>

          <div class="mon-grid" v-loading="loading">
            <div v-for="row in mon.list" :key="row.report_id" class="mon-item" @click="openMonthly(row)">
              <div class="mon-head">
                <span class="mon-name">{{ row.real_name || row.username }}</span>
                <span class="mon-month">{{ row.report_month }}</span>
              </div>
              <div class="mon-preview">{{ oneLine(row.preview) }}</div>
              <div class="mon-foot">
                <span>{{ row.content_len || 0 }} 字</span>
                <span>{{ (row.update_time || '').slice(0, 16) }}</span>
              </div>
            </div>
            <el-empty v-if="!mon.list.length && !loading" description="该月暂无月报" :image-size="80" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 详情弹窗（纯文本，等宽排版，可直接复制） -->
    <el-dialog v-model="detailVisible" :title="detailTitle" width="680px" class="report-detail">
      <div v-if="detail" class="detail-wrap">
        <div class="detail-meta">
          <span>{{ detail.real_name || detail.username }}</span>
          <span>{{ detail.report_date || detail.report_month }}</span>
          <el-button size="small" text type="primary" @click="copyDetail"><el-icon><CopyDocument /></el-icon> 复制</el-button>
        </div>
        <template v-if="tab === 'daily'">
          <div class="d-sec">
            <div class="d-title">今日工作</div>
            <pre class="d-text">{{ detail.today_work || '—' }}</pre>
          </div>
          <div class="d-sec">
            <div class="d-title">需协调解决的问题</div>
            <pre class="d-text">{{ detail.need_help || '无' }}</pre>
          </div>
          <div class="d-sec">
            <div class="d-title">明日工作计划</div>
            <pre class="d-text">{{ detail.tomorrow_plan || '无' }}</pre>
          </div>
        </template>
        <pre v-else class="d-text full">{{ detail.content || '—' }}</pre>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { Search, Refresh, CopyDocument } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import R from '../api'

// 窄屏切卡片视图：日报正文长，表格在手机上挤不开
const isMobile = ref(window.innerWidth <= 820)
// 日报与月报共用一个 loading，切 tab 时统一遮罩
const loading = ref(false)
// 人员下拉数据源：全量账号，用于按人筛选
const staff = ref([])
// 当前 tab 决定详情弹窗按日报还是月报结构渲染
const tab = ref('daily')

// 概览数字：expected 应交人数、today_submitted 今日已交、month_count 本月份数、trend 近 7 天曲线
const summary = reactive({ expected: 0, today_submitted: 0, month_count: 0, trend: [] })
// 今日未提交人员；有人缺交时概览里的「未提交人数」标黄
const missing = ref([])
// 未提交名单对应的日期，由后端按服务器时间给，避免前后端时区不一致
const missingDate = ref('')

// 日报筛选条件：人员 / 日期区间 / 正文关键词
const f = reactive({ user_id: null, range: [], keyword: '' })
// 日报分页状态：page 或 size 变化都要重新拉取
const daily = reactive({ list: [], total: 0, page: 1, size: 20 })

// 月报筛选条件：月份 / 人员 / 关键词
const m = reactive({ month: '', user_id: null, keyword: '' })
// 月报列表，加上后端算好的应交人数与未提交名单
const mon = reactive({ list: [], total: 0, expected: 0, missing: [] })

// 详情弹窗的数据与显隐
const detailVisible = ref(false)
const detail = ref(null)
// 标题按当前 tab 拼「谁 · 哪天 日报/月报」，避免月报详情显示成日报日期
const detailTitle = computed(() => {
  if (!detail.value) return '报告详情'
  const who = detail.value.real_name || detail.value.username || ''
  return tab.value === 'daily' ? `${who} · ${detail.value.report_date} 日报` : `${who} · ${detail.value.report_month} 月报`
})

// 列表只显示前 90 字：日报正文可能几千字，全量渲染会明显拖慢表格
function oneLine(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > 90 ? t.slice(0, 90) + '…' : t
}
// 柱高按 7 天内最大值归一，最小 4px 保证 0 提交那天也能看见一根线
function barH(n) {
  const max = Math.max(1, ...(summary.trend || []).map(x => x.count))
  return Math.max(4, Math.round((n / max) * 46))
}

// 概览与未提交名单分两步取：概览失败不阻断列表，数字缺失好过整页空白
async function loadSummary() {
  try {
    const d = await R.teamDailySummary()
    Object.assign(summary, d)
    const miss = await R.teamDailyMissing(d.report_date)
    missing.value = miss.list || []
    missingDate.value = miss.date || ''
  } catch (e) { /* 概览失败不影响列表 */ }
}

// 分页与三个筛选条件一起下发；total 用 Number 兜底，防后端返回字符串导致分页算错
async function loadDaily() {
  loading.value = true
  try {
    const params = { page: daily.page, page_size: daily.size }
    if (f.user_id) params.user_id = f.user_id
    if (f.range && f.range.length === 2) { params.from = f.range[0]; params.to = f.range[1] }
    if (f.keyword) params.keyword = f.keyword
    const d = await R.teamDailyList(params)
    daily.list = d.list || []
    daily.total = Number(d.total || 0)
  } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}

// 月报不分页，一次拉全月；missing 由后端按「应交人数 - 已提交」算好，前端不重复统计
async function loadMonthly() {
  loading.value = true
  try {
    const params = {}
    if (m.month) params.month = m.month
    if (m.user_id) params.user_id = m.user_id
    if (m.keyword) params.keyword = m.keyword
    const d = await R.teamMonthlyList(params)
    mon.list = d.list || []
    mon.total = Number(d.total || 0)
    mon.expected = Number(d.expected || 0)
    mon.missing = d.missing || []
  } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}

// 改筛选一律回第一页，否则会停在越界页码上看到空列表
function searchDaily() { daily.page = 1; loadDaily() }
// 翻页只换页码，沿用当前筛选条件
function onPage(p) { daily.page = p; loadDaily() }
// 改每页条数后回到第一页，避免页码越界
function onSize(s) { daily.size = s; daily.page = 1; loadDaily() }
function resetDaily() {
  f.user_id = null; f.range = []; f.keyword = ''
  daily.page = 1
  loadDaily()
}
// 月报只在第一次切过去时加载，来回切 tab 不重复请求
function onTabChange(name) {
  if (name === 'daily') loadDaily()
  else if (!mon.list.length) loadMonthly()
}
// 刷新按钮同时刷概览与当前 tab 的列表，保证数字和内容一致
function reload() {
  loadSummary()
  if (tab.value === 'daily') loadDaily()
  else loadMonthly()
}

// 先用列表行立即渲染，再请求详情覆盖：详情接口失败也能看到列表里的内容
async function openDaily(row) {
  detail.value = row
  detailVisible.value = true
  // 详情接口返回完整内容（列表里已是全文，这里仍走一次以兼容分页裁剪）
  try { detail.value = await R.teamDailyDetail(row.report_id) } catch { /* 用列表数据兜底 */ }
}
// 同 openDaily：先渲染再取详情，失败时回落到列表数据
async function openMonthly(row) {
  detail.value = row
  detailVisible.value = true
  try { detail.value = await R.teamMonthlyDetail(row.report_id) } catch { /* 用列表数据兜底 */ }
}

// 优先用 Clipboard API；非 https 环境退回 textarea + execCommand，两种都失败才提示手动复制。
// 复制出去的是纯文本带段落标题，方便直接贴到周会记录里
async function copyDetail() {
  if (!detail.value) return
  const d = detail.value
  const text = tab.value === 'daily'
    ? `【今日工作】\n${d.today_work || ''}\n\n【需协调】\n${d.need_help || '无'}\n\n【明日计划】\n${d.tomorrow_plan || '无'}`
    : (d.content || '')
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    ElMessage.success('已复制到剪贴板')
  } catch { ElMessage.warning('复制失败，请手动选择文本复制') }
}

// resize 监听在卸载时统一摘掉
function onResize() { isMobile.value = window.innerWidth <= 820 }

// 首屏三件事：人员下拉（筛选用）、概览数字、当前 tab 的列表；人员接口失败不影响后两者
onMounted(async () => {
  window.addEventListener('resize', onResize)
  try { staff.value = await R.listStaff() } catch { /* ignore */ }
  loadSummary()
  loadDaily()
})
onBeforeUnmount(() => window.removeEventListener('resize', onResize))
</script>

<style scoped>
.page-head { margin-bottom: 14px; }

/* 概览 */
.stat-card {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 1fr)) 1.6fr;
  gap: 18px;
  align-items: center;
  margin-bottom: 14px;
}
.stat-num { font-size: 26px; font-weight: 700; color: var(--it-primary); line-height: 1.2; }
.stat-num.warn { color: #e6a23c; }
.stat-sub { font-size: 14px; font-weight: 500; color: var(--it-text-sub); margin-left: 2px; }
.stat-label { font-size: 12px; color: var(--it-text-sub); margin-top: 4px; }
.trend-bars { display: flex; align-items: flex-end; gap: 5px; height: 56px; }
.bar-wrap { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; height: 100%; width: 26px; }
.bar { width: 60%; background: linear-gradient(180deg, var(--it-primary), #8ab4ff); border-radius: 4px 4px 2px 2px; min-height: 4px; }
.bar-x { font-size: 10px; color: var(--it-text-sub); white-space: nowrap; }
.trend-empty { font-size: 12px; color: var(--it-text-sub); }

/* 未提交名单 */
.miss-card { margin-bottom: 14px; }
.miss-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.miss-title { font-size: 13px; font-weight: 600; color: #e6a23c; }
.miss-tip { font-size: 12px; color: var(--it-text-sub); }
.miss-list { display: flex; flex-wrap: wrap; gap: 6px; }

/* 筛选 */
.filters { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }

/* 表格 */
.daily-table :deep(.cell) { line-height: 1.5; }
.cell-text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
:deep(.col-ops .cell) { display: flex; flex-wrap: nowrap; gap: 2px; }
:deep(.col-ops .el-button) { margin-left: 0; padding: 0 4px; }

/* 分页 */
.pager { display: flex; justify-content: flex-end; margin-top: 12px; }

/* 月报卡片 */
.mon-summary { font-size: 13px; color: var(--it-text-sub); margin-bottom: 12px; }
.mon-summary strong { color: var(--it-text); }
.mon-miss { margin-left: 8px; color: #e6a23c; }
.mon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.mon-item { border: 1px solid var(--it-border); border-radius: 10px; padding: 12px 14px; cursor: pointer; transition: box-shadow .15s, border-color .15s; background: var(--it-card); }
.mon-item:hover { border-color: var(--it-primary); box-shadow: 0 4px 14px rgba(64, 128, 255, 0.12); }
.mon-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.mon-name { font-weight: 600; }
.mon-month { font-size: 12px; color: var(--it-text-sub); }
.mon-preview { font-size: 13px; color: var(--it-text-sub); line-height: 1.6; height: 42px; overflow: hidden; }
.mon-foot { display: flex; justify-content: space-between; font-size: 11px; color: var(--it-text-sub); margin-top: 8px; }

/* 手机卡片 */
.m-list { display: flex; flex-direction: column; gap: 10px; }
.m-item { border: 1px solid var(--it-border); border-radius: 10px; padding: 10px 12px; background: var(--it-card); }
.m-head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
.m-name { font-weight: 600; }
.m-date { color: var(--it-text-sub); }
.m-body { font-size: 13px; line-height: 1.6; color: var(--it-text-sub); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.m-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 12px; }
.m-flag { color: #e6a23c; }
.m-more { color: var(--it-primary); }

/* 详情 */
.detail-wrap { max-height: 62vh; overflow: auto; }
.detail-meta { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--it-text-sub); margin-bottom: 10px; }
.d-sec { margin-bottom: 14px; }
.d-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.d-text {
  margin: 0; white-space: pre-wrap; word-break: break-word;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", monospace;
  font-size: 13px; line-height: 1.85;
  background: var(--it-bg); border: 1px solid var(--it-border); border-radius: 8px;
  padding: 10px 12px;
}
.d-text.full { max-height: 56vh; overflow: auto; }

@media (max-width: 820px) {
  /* 顶部导航已经显示页面名，页内标题不再重复 */
  .page-head h3 { display: none; }
  .stat-card { grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .stat.trend { grid-column: 1 / -1; }
  .stat-num { font-size: 22px; }
  .filters :deep(.el-select), .filters :deep(.el-date-editor), .filters :deep(.el-input) { width: 100% !important; }
  .filters :deep(.el-button) { flex: 1; }
  .mon-grid { grid-template-columns: 1fr; }
  .pager { justify-content: center; }
}
</style>
