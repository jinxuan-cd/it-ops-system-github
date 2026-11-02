<template>
  <div class="it-page">
    <div class="it-between" style="margin-bottom:14px">
      <div>
        <h3 class="it-section-title" style="margin:0">常见问题管理（FAQ）</h3>
        <div class="tip">这里的条目会直接出现在员工自助门户的「常见问题」页，员工可搜索、展开查看解决方案。</div>
      </div>
      <div>
        <el-button plain size="small" @click="openPortal"><el-icon><Link /></el-icon> 打开员工门户</el-button>
        <el-button v-if="canWrite" type="primary" size="small" @click="openAdd"><el-icon><Plus /></el-icon> 新增问答</el-button>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat-item">
        <div class="s-val">{{ rows.length }}</div>
        <div class="s-label">已公开条目</div>
      </div>
      <div class="stat-item">
        <div class="s-val">{{ totalHits }}</div>
        <div class="s-label">门户累计查看</div>
      </div>
      <div class="stat-item">
        <div class="s-val">{{ portalReady ? '正常' : '未配置' }}</div>
        <div class="s-label">公网门户地址</div>
      </div>
    </div>

    <div class="it-card" style="margin-bottom:14px">
      <el-form :inline="true" :model="filters">
        <el-form-item label="应用系统">
          <el-select v-model="filters.app_system" placeholder="全部" clearable filterable style="width:150px">
            <el-option v-for="d in dicts.app_system" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
          </el-select>
        </el-form-item>
        <el-form-item label="问题类别">
          <el-select v-model="filters.problem_type" placeholder="全部" clearable filterable style="width:150px">
            <el-option v-for="d in dicts.problem_type" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="filters.keyword" placeholder="搜索摘要 / 方案 / 关键词" clearable style="width:220px" @keyup.enter="load" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="load"><el-icon><Search /></el-icon> 搜索</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="it-card">
      <el-table :data="rows" stripe v-loading="loading" empty-text="还没有公开的常见问题，点右上角「新增问答」开始添加">
        <el-table-column label="问题" min-width="300">
          <template #default="{ row }">
            <div class="q-main">{{ row.problem_summary }}</div>
            <div class="q-sub">
              {{ row.app_system || '—' }} · {{ row.problem_type || '未分类' }}
              <span v-if="row.keyword"> · 关键词 {{ row.keyword }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="faq_hits" label="门户查看" width="90" align="center" />
        <el-table-column label="更新时间" width="150">
          <template #default="{ row }">
            <span class="q-time">{{ (row.update_time || row.create_time || '').slice(0, 16) }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="canWrite" label="操作" width="220" fixed="right" class-name="op-col">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text type="warning" @click="unpublish(row)">取消公开</el-button>
            <el-button size="small" text type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 新增 / 编辑 -->
    <el-dialog v-model="dialogVisible" :title="form.kb_id ? '编辑问答' : '新增问答'" width="720px" destroy-on-close>
      <el-form :model="form" label-width="90px">
        <el-form-item label="应用系统">
          <el-select v-model="form.app_system" filterable allow-create default-first-option clearable placeholder="选择或直接输入" style="width:100%">
            <el-option v-for="d in dicts.app_system" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
          </el-select>
        </el-form-item>
        <el-form-item label="问题类别">
          <el-select v-model="form.problem_type" filterable allow-create default-first-option clearable placeholder="选择或直接输入" style="width:100%">
            <el-option v-for="d in dicts.problem_type" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
          </el-select>
        </el-form-item>
        <el-form-item label="问题" required>
          <el-input v-model="form.problem_summary" type="textarea" :rows="2" maxlength="300" show-word-limit placeholder="一句话描述员工遇到的问题，例如：VPN 连接提示证书错误" />
        </el-form-item>
        <el-form-item label="解决方案" required>
          <el-input v-model="form.solution" type="textarea" :rows="7" placeholder="分步骤写清楚怎么做，员工照着做就能解决" />
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="form.keyword" placeholder="留空自动提取；多个关键词用逗号分隔" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存并公开</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Plus, Search, Link } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import R from '../api'
import { useUserStore } from '../store/user'

const userStore = useUserStore()
const canWrite = computed(() => !userStore.isAuditor)

const rows = ref([])
const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const dicts = reactive({ app_system: [], problem_type: [] })
const filters = reactive({ app_system: '', problem_type: '', keyword: '' })
const form = reactive({ kb_id: null, app_system: '', problem_type: '', problem_summary: '', solution: '', keyword: '' })

const portalBase = ref('')
const portalKey = ref('')
const portalReady = computed(() => !!portalBase.value)
const totalHits = computed(() => rows.value.reduce((s, r) => s + Number(r.faq_hits || 0), 0))

async function loadDicts() {
  try {
    const d = await R.getDicts(false)
    dicts.app_system = d.app_system || []
    dicts.problem_type = d.problem_type || []
  } catch { /* 字典失败不影响列表 */ }
}

async function loadPortal() {
  try {
    const c = await R.getPublicSettings()
    portalBase.value = c.public_base_url || ''
    portalKey.value = c.report_key || ''
  } catch { /* ignore */ }
}

function openPortal() {
  if (!portalReady.value || !portalKey.value) {
    ElMessage.warning('还没有配置公网门户地址，请到「系统设置 → 自助服务入口」填写')
    return
  }
  window.open(`${portalBase.value.replace(/\/+$/, '')}/faq?k=${portalKey.value}`, '_blank')
}

async function load() {
  loading.value = true
  try {
    // 管理员看全部公开条目；普通账号只能看到自己的（后端按角色收口）
    const params = { public: 1, ...filters }
    if (userStore.canViewAll) params.all = 1
    rows.value = await R.listKnowledge(params)
  } catch (e) {
    ElMessage.error('读取常见问题失败：' + (e.__message || e.message))
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  Object.assign(filters, { app_system: '', problem_type: '', keyword: '' })
  load()
}

function openAdd() {
  Object.assign(form, { kb_id: null, app_system: '', problem_type: '', problem_summary: '', solution: '', keyword: '' })
  dialogVisible.value = true
}

function openEdit(row) {
  Object.assign(form, {
    kb_id: row.kb_id,
    app_system: row.app_system || '',
    problem_type: row.problem_type || '',
    problem_summary: row.problem_summary || '',
    solution: row.solution || '',
    keyword: row.keyword || ''
  })
  dialogVisible.value = true
}

async function onSave() {
  if (!form.problem_summary.trim()) return ElMessage.warning('请填写问题描述')
  if (!form.solution.trim()) return ElMessage.warning('请填写解决方案')
  saving.value = true
  try {
    const payload = {
      app_system: form.app_system,
      problem_type: form.problem_type,
      problem_summary: form.problem_summary,
      solution: form.solution,
      keyword: form.keyword,
      is_public: 1
    }
    if (form.kb_id) await R.updateKnowledge(form.kb_id, payload)
    else await R.createKnowledge(payload)
    ElMessage.success('已保存，员工门户立即可见')
    dialogVisible.value = false
    load()
  } catch (e) {
    ElMessage.error(e.__message || e.message)
  } finally {
    saving.value = false
  }
}

async function unpublish(row) {
  try { await ElMessageBox.confirm('取消公开后，员工门户将看不到这条问答。确认继续？', '取消公开', { type: 'warning' }) } catch { return }
  try {
    await R.updateKnowledge(row.kb_id, { is_public: 0 })
    ElMessage.success('已取消公开')
    load()
  } catch (e) { ElMessage.error(e.__message || e.message) }
}

async function onDelete(row) {
  try { await ElMessageBox.confirm('删除后不可恢复，确认删除这条问答？', '删除', { type: 'warning' }) } catch { return }
  try {
    await R.deleteKnowledge(row.kb_id)
    ElMessage.success('已删除')
    load()
  } catch (e) { ElMessage.error(e.__message || e.message) }
}

onMounted(() => { loadDicts(); loadPortal(); load() })
</script>

<style scoped>
.tip { font-size: 12.5px; color: var(--it-text-sub); margin-top: 4px; }
.stat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 14px; }
.stat-item { background: var(--it-card); border: 1px solid var(--it-border); border-radius: 10px; padding: 14px 16px; }
.stat-item .s-val { font-size: 22px; font-weight: 700; color: var(--it-text); line-height: 1.2; }
.stat-item .s-label { font-size: 12px; color: var(--it-text-sub); margin-top: 4px; }
@media (max-width: 640px) { .stat-row { grid-template-columns: 1fr; } }
/* 操作列三个文字按钮不换行，否则会挤成两行 */
:deep(.op-col .cell) { white-space: nowrap; display: flex; align-items: center; gap: 2px; }
:deep(.op-col .cell .el-button) { margin-left: 0; padding: 4px 5px; }
/* 问题列：主标题 + 副信息，省掉三列横向空间 */
.q-main { font-size: 13px; color: var(--it-text); line-height: 1.4; }
.q-sub { font-size: 11.5px; color: var(--it-text-sub); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q-time { font-size: 12px; color: var(--it-text-sub); }
</style>
