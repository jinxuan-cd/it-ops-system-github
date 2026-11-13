<!--
  故障事件管理 —— IT 运维工单台账与日报自动管理系统
  重大故障登记、影响范围与处理过程记录

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.2
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page">
    <div class="it-between page-head">
      <div>
        <h3 class="it-section-title" style="margin:0">故障管理</h3>
        <div class="page-sub">记录影响面较大的故障（断网、服务器宕机、核心业务中断），沉淀原因与复盘</div>
      </div>
      <div class="head-actions">
        <el-button size="small" @click="load"><el-icon><Refresh /></el-icon> 刷新</el-button>
        <el-button v-if="canWrite" type="primary" size="small" @click="openCreate"><el-icon><Plus /></el-icon> 登记故障</el-button>
      </div>
    </div>

    <!-- 统计（没有故障记录时整块不显示） -->
    <!-- 统计与下方列表共用同一套筛选参数，保证数字和记录对得上 -->
    <el-row v-if="stats.total > 0" :gutter="14" class="card-row">
      <el-col :xs="12" :sm="6">
        <div class="metric-card blue">
          <div class="m-val">{{ stats.total }}</div>
          <div class="m-label">本期故障总数</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="metric-card" :class="stats.ongoing > 0 ? 'red' : 'green'">
          <div class="m-val">{{ stats.ongoing }}</div>
          <div class="m-label">未恢复</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="metric-card orange">
          <div class="m-val">{{ stats.serious }}</div>
          <div class="m-label">P1 / P2 严重故障</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="metric-card purple">
          <div class="m-val">{{ stats.avg_hours }}<small> h</small></div>
          <div class="m-label">平均恢复时长</div>
        </div>
      </el-col>
    </el-row>

    <!-- 筛选：时间按「发生时间」过滤，级别/状态/关键词可叠加 -->
    <div class="it-card" style="margin-bottom:14px">
      <el-form :inline="true">
        <el-form-item label="时间">
          <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" />
        </el-form-item>
        <el-form-item label="级别">
          <el-select v-model="filters.level" placeholder="全部" clearable style="width:110px">
            <el-option v-for="l in LEVELS" :key="l.value" :label="l.label" :value="l.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部" clearable style="width:110px">
            <el-option label="未恢复" value="ongoing" />
            <el-option label="已恢复" value="resolved" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-input v-model="filters.keyword" placeholder="标题/原因/系统" clearable style="width:180px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="load"><el-icon><Search /></el-icon> 查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="it-card">
            <!-- 移动端：卡片列表，避免宽表格在窄屏被挤压 -->
      <div v-if="isMobile" class="m-list" v-loading="loading">
        <div v-for="row in rows" :key="row.incident_id" class="m-item">
          <div class="m-head">
            <el-tag size="small" :type="levelType(row.level)" effect="dark">{{ row.level }}</el-tag>
            <span class="m-title">{{ row.title }}</span>
          </div>
          <div class="m-meta">
            <span>{{ fmt(row.start_time) }} 发生</span>
            <span v-if="row.accept_time">{{ fmt(row.accept_time) }} 接单</span>
            <span v-if="row.finish_time">{{ fmt(row.finish_time) }} 恢复</span>
          </div>
          <div class="m-tags">
            <el-tag size="small" :type="row.status === 'resolved' ? 'success' : 'danger'">
              {{ row.status === 'resolved' ? '已恢复' : '未恢复' }}
            </el-tag>
            <span v-if="row.duration_minutes" class="m-dur">历时 {{ durText(row.duration_minutes) }}</span>
            <span v-if="row.scope" class="m-dur">{{ row.scope }}</span>
          </div>
          <div class="m-ops">
            <el-button size="small" text type="primary" @click="openDetail(row)">详情</el-button>
            <template v-if="canWrite">
              <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button size="small" text type="danger" @click="onDelete(row)">删除</el-button>
            </template>
          </div>
        </div>
        <el-empty v-if="!rows.length && !loading" description="暂无故障记录" :image-size="70" />
      </div>

      <el-table v-else :data="rows" stripe border v-loading="loading" :max-height="520" empty-text="暂无故障记录">
        <el-table-column label="故障 / 编号" min-width="190">
          <template #default="{ row }">
            <div class="cell-2">{{ row.title }}</div>
            <div class="cell-sub">{{ row.incident_no }}</div>
          </template>
        </el-table-column>
        <el-table-column label="级别" width="64">
          <template #default="{ row }">
            <el-tag size="small" :type="levelType(row.level)" effect="dark">{{ row.level }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="影响范围" width="100" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="cell-2">{{ row.scope || '—' }}</div>
            <div class="cell-sub">{{ row.affected_systems || '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="发生 / 接单 / 恢复" width="148">
          <template #default="{ row }">
            <div class="cell-2">{{ fmt(row.start_time) }}</div>
            <div class="cell-sub">接 {{ fmt(row.accept_time) }}</div>
            <div class="cell-sub">恢 {{ fmt(row.finish_time) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态 / 历时" width="104">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'resolved' ? 'success' : 'danger'">
              {{ row.status === 'resolved' ? '已恢复' : '未恢复' }}
            </el-tag>
            <div class="cell-sub">{{ row.duration_minutes ? durText(row.duration_minutes) : '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="118">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openDetail(row)">详情</el-button>
            <template v-if="canWrite">
              <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button size="small" text type="danger" @click="onDelete(row)">删除</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 新增 / 编辑 -->
    <!-- 恢复时间被清空时状态会自动回退为「未恢复」，提示见 onFinishChange -->
    <el-dialog v-model="formVisible" :title="form.incident_id ? '编辑故障' : '登记故障'" width="720px" top="6vh">
      <el-form :model="form" label-width="96px">
        <el-form-item label="故障标题" required>
          <el-input v-model="form.title" placeholder="例如：机房核心交换机宕机导致全公司断网" maxlength="200" show-word-limit />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="故障级别">
              <el-select v-model="form.level" style="width:100%">
                <el-option v-for="l in LEVELS" :key="l.value" :label="l.label" :value="l.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="16">
            <!-- 影响范围是固定枚举而非自由文本：否则同一件事会被写成七八种说法，统计无法归口 -->
            <el-form-item label="影响范围">
              <el-select v-model="form.scope" placeholder="选择影响范围" clearable style="width:100%">
                <el-option v-for="s in SCOPES" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="受影响系统">
          <el-input v-model="form.affected_systems" placeholder="例如：OA、ERP、企业微信" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="发生时间">
              <el-date-picker v-model="form.start_time" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="接单时间">
              <el-date-picker v-model="form.accept_time" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="恢复时间">
              <el-date-picker v-model="form.finish_time" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" style="width:100%" @change="onFinishChange" />
            </el-form-item>
          </el-col>
        </el-row>
        <div v-if="finishCleared" class="dirty-tip">
          <el-icon><WarningFilled /></el-icon>
          已清空恢复时间：保存后状态会自动改回「未恢复」，避免出现「已恢复却没有恢复时间」的脏数据
        </div>
        <el-form-item label="故障原因">
          <el-input v-model="form.cause" type="textarea" :rows="2" placeholder="根因分析：为什么会发生" />
        </el-form-item>
        <el-form-item label="处理过程">
          <el-input v-model="form.process" type="textarea" :rows="3" placeholder="从发现到恢复做了什么（临时措施 / 最终解决）" />
        </el-form-item>
        <el-form-item label="复盘总结">
          <el-input v-model="form.review" type="textarea" :rows="3" placeholder="后续改进项、责任分工、如何避免再次发生" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 详情 -->
    <!-- 抽屉里把原因 / 处理过程 / 复盘拆成三段，方便事后复盘与向上汇报 -->
    <el-drawer v-model="detailVisible" title="故障详情" size="520px" direction="rtl">
      <template v-if="detail">
        <div class="d-title">{{ detail.title }}</div>
        <div class="d-tags">
          <el-tag size="small" :type="levelType(detail.level)" effect="dark">{{ detail.level }}</el-tag>
          <el-tag size="small" :type="detail.status === 'resolved' ? 'success' : 'danger'">
            {{ detail.status === 'resolved' ? '已恢复' : '未恢复' }}
          </el-tag>
          <span class="d-no">{{ detail.incident_no }}</span>
        </div>
        <el-descriptions :column="1" border size="small" style="margin-top:14px">
          <el-descriptions-item label="影响范围">{{ detail.scope || '—' }}</el-descriptions-item>
          <el-descriptions-item label="受影响系统">{{ detail.affected_systems || '—' }}</el-descriptions-item>
          <el-descriptions-item label="发生时间">{{ detail.start_time || '—' }}</el-descriptions-item>
          <el-descriptions-item label="接单时间">{{ detail.accept_time || '—' }}</el-descriptions-item>
          <el-descriptions-item label="恢复时间">{{ detail.finish_time || '—' }}</el-descriptions-item>
          <el-descriptions-item label="登记人">{{ detail.real_name || '—' }}</el-descriptions-item>
        </el-descriptions>
        <div class="d-block">
          <h4>故障原因</h4>
          <p>{{ detail.cause || '（未填写）' }}</p>
        </div>
        <div class="d-block">
          <h4>处理过程</h4>
          <p class="pre">{{ detail.process || '（未填写）' }}</p>
        </div>
        <div class="d-block">
          <h4>复盘总结</h4>
          <p class="pre">{{ detail.review || '（未填写）' }}</p>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { Refresh, Plus, Search, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import R from '../api'
import { useUserStore } from '../store/user'

const userStore = useUserStore()
// 审计员只读：登记、编辑、删除三个入口都由它控制显隐
const canWrite = computed(() => !userStore.isAuditor)

// 影响范围固定为选项，便于统计（人数规模 / 部门范围两类，二选一）
const SCOPES = ['5人以下', '5-10人', '10-30人', '30人以上', '单部门', '全公司']

// 故障等级：只在展示层做文案与配色映射，库里存的是 P1~P4 字符串
const LEVELS = [
  { value: 'P1', label: 'P1 致命（业务全停）' },
  { value: 'P2', label: 'P2 严重（核心业务受损）' },
  { value: 'P3', label: 'P3 一般（局部影响）' },
  { value: 'P4', label: 'P4 轻微（几乎无感）' }
]

// 列表数据与 loading 分离，刷新时保留旧数据避免闪空
const rows = ref([])
const loading = ref(false)
// 窄屏隐藏次要列，避免表格横向溢出（时间列已合并发生/接单/恢复三段）
// 断点与其它列表页保持一致（820px）
const isMobile = ref(window.innerWidth <= 820)
function onResize() { isMobile.value = window.innerWidth <= 820 }
// 时间区间与级别/状态/关键词筛选
const range = ref([])
const filters = reactive({ level: '', status: '', keyword: '' })
// 顶部四个统计数字，与列表同一次查询条件算出来的
const stats = reactive({ total: 0, ongoing: 0, serious: 0, avg_hours: 0 })

// 弹窗显隐与保存中状态
const formVisible = ref(false)
const saving = ref(false)
// 空对象起步：新增/编辑都先清空再赋值，避免残留上一条记录的字段
const form = reactive({})
// 可编辑字段白名单（其余字段是后端推导出来的，不参与提交）
const SAVE_FIELDS = ['title', 'level', 'scope', 'affected_systems', 'start_time', 'accept_time', 'finish_time', 'cause', 'process', 'review']
// 恢复时间被清空 → 提示保存后状态会回退，避免「已恢复却没有恢复时间」
// 只做提示不做拦截：用户确实可能先清空再重填
const finishCleared = ref(false)
function onFinishChange(v) { finishCleared.value = !v }

// 详情抽屉的数据与显隐
const detailVisible = ref(false)
const detail = ref(null)

// 级别染色：P1 红 / P2 橙 / P3 蓝 / P4 灰，列表与详情共用一套
function levelType(l) {
  return l === 'P1' ? 'danger' : l === 'P2' ? 'warning' : l === 'P3' ? 'primary' : 'info'
}
// 列表里的时间只留 MM-DD HH:mm，年份由筛选区间隐含，省横向空间
function fmt(t) { return t ? String(t).slice(5, 16) : '—' }
// 历时统一成「x 小时 y 分」；超过一小时不再只显示分钟数，便于对外说明
function durText(min) {
  if (min == null) return '—'
  if (min < 60) return min + ' 分钟'
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
}

// 查询参数：只有能看全员的人才带 all=1，普通账号由后端限定为本人登记
function params() {
  const p = {}
  if (userStore.canViewAll) p.all = 1
  if (range.value && range.value.length === 2) { p.start = range.value[0]; p.end = range.value[1] }
  if (filters.level) p.level = filters.level
  if (filters.status) p.status = filters.status
  if (filters.keyword) p.keyword = filters.keyword
  return p
}

// 列表与统计并行请求：任一失败都提示，避免出现「有数字没记录」的半更新状态
async function load() {
  loading.value = true
  try {
    const [list, st] = await Promise.all([R.listIncidents(params()), R.incidentStats(params())])
    rows.value = list
    Object.assign(stats, st)
  } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}

// 清空全部筛选条件后立即重查
function resetFilters() {
  range.value = []
  Object.assign(filters, { level: '', status: '', keyword: '' })
  load()
}

// 新建默认 P3、发生时间取当前分钟：符合「先登记、细节后补」的实际习惯，
// 也避免用户为了填一个时间字段放弃登记
function openCreate() {
  Object.keys(form).forEach(k => delete form[k])
  finishCleared.value = false
  const now = new Date()
  const p = n => String(n).padStart(2, '0')
  form.level = 'P3'
  form.start_time = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:00`
  formVisible.value = true
}
// 编辑直接回填整行，提交时再按白名单裁剪（见 onSave 里的说明）
function openEdit(row) {
  Object.keys(form).forEach(k => delete form[k])
  Object.assign(form, row)
  finishCleared.value = false
  formVisible.value = true
}
// 业务口径：恢复时间不得早于发生时间。前端不重复拦截，由后端在保存时
// 把早于发生时间的恢复时间纠正为发生时间，否则平均恢复时长会被算成负数
async function onSave() {
  if (!form.title) return ElMessage.warning('请填写故障标题')
  saving.value = true
  try {
    // 只提交可编辑字段：整条记录（含 status / incident_no / 只读统计列）原样提交时，
    // 带上来的旧 status='ongoing' 会让后端把刚填的恢复时间又清空
    const payload = {}
    SAVE_FIELDS.forEach(k => { if (form[k] !== undefined) payload[k] = form[k] })
    if (form.incident_id) await R.updateIncident(form.incident_id, payload)
    else await R.createIncident(payload)
    ElMessage.success('已保存')
    formVisible.value = false
    load()
  } catch (e) { ElMessage.error(e.message) } finally { saving.value = false }
}
// 物理删除：带标题二次确认，避免和「已恢复」这条记录混淆
async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`确认删除故障「${row.title}」？`, '提示', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch { return }
  try {
    await R.deleteIncident(row.incident_id)
    ElMessage.success('已删除')
    load()
  } catch (e) { ElMessage.error(e.message) }
}
// 详情直接用列表行：列表已返回原因/过程/复盘全文
function openDetail(row) {
  detail.value = row
  detailVisible.value = true
}

onMounted(() => { window.addEventListener('resize', onResize); load() })
onUnmounted(() => window.removeEventListener('resize', onResize))
</script>

<style scoped>
@media (min-width: 1200px) { .it-page { padding-right: 272px; } }
.page-head { margin-bottom: 14px; }
.page-sub { font-size: 12px; color: var(--it-text-sub); margin-top: 4px; }
.head-actions { display: flex; gap: 10px; }
.card-row { margin-bottom: 14px; }

.metric-card { background: var(--it-card); border: 1px solid var(--it-border); border-radius: 10px; padding: 14px 16px; }
.metric-card .m-val { font-size: 26px; font-weight: 700; line-height: 1.2; }
.metric-card .m-val small { font-size: 13px; font-weight: 500; }
.metric-card .m-label { font-size: 12px; color: var(--it-text-sub); margin-top: 4px; }
.metric-card.blue .m-val { color: var(--it-primary); }
.metric-card.green .m-val { color: var(--it-success); }
.metric-card.red .m-val { color: var(--it-danger); }
.metric-card.orange .m-val { color: var(--it-warning); }
.metric-card.purple .m-val { color: #7a5af8; }

.cell-2 { font-size: 12px; line-height: 1.5; }
.cell-sub { font-size: 11px; color: var(--it-text-sub); line-height: 1.5; }
.d-title { font-size: 16px; font-weight: 600; line-height: 1.5; }
.d-tags { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.d-no { font-size: 12px; color: var(--it-text-sub); }
.d-block { margin-top: 16px; }
.d-block h4 { font-size: 13px; margin: 0 0 6px; color: var(--it-primary); }
.d-block p { margin: 0; font-size: 13px; line-height: 1.8; color: var(--it-text); }
.pre { white-space: pre-wrap; }


/* 移动端卡片列表 */
.m-list { display: flex; flex-direction: column; gap: 10px; }
.m-item { border: 1px solid var(--it-border); border-radius: 8px; padding: 10px 12px; }
.m-head { display: flex; align-items: flex-start; gap: 8px; }
.m-head .m-title { flex: 1; font-size: 14px; font-weight: 600; line-height: 1.4; word-break: break-all; }
.m-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; font-size: 12px; }
.m-meta span { background: rgba(125, 125, 125, 0.12); border-radius: 4px; padding: 1px 6px; }
.m-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.m-dur { font-size: 12px; color: var(--it-text-sub); }
.m-ops { display: flex; justify-content: flex-end; gap: 2px; margin-top: 6px; border-top: 1px dashed var(--it-border); padding-top: 6px; }

/* 恢复时间被清空时的提醒：状态会一起回退 */
.dirty-tip {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--it-warning); line-height: 1.6;
  background: rgba(240, 160, 32, 0.1); border-radius: 6px;
  padding: 7px 10px; margin: -6px 0 12px 96px;
}
@media (max-width: 820px) { .dirty-tip { margin-left: 0; } }
</style>
