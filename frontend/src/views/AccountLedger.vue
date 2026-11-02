<!--
  账号台账 —— IT 运维工单台账与日报自动管理系统
  客户与系统账号登记、密码保管与到期提醒

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.1
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page">
    <div class="it-between page-head">
      <div>
        <h3 class="it-section-title" style="margin:0">账号与权限台账</h3>
        <div class="page-sub">记录各业务系统账号的开通、变更与注销，离职核查与合规审计时可追溯</div>
      </div>
      <div class="head-actions">
        <el-button v-if="canWrite" type="primary" size="small" @click="openCreate"><el-icon><Plus /></el-icon> 登记账号</el-button>
      </div>
    </div>

    <el-row v-if="summary.length" :gutter="14" class="card-row">
      <!-- 汇总只取前 4 个系统：卡片是概览用途，系统多了会挤成两行，明细看下方表格 -->
      <el-col v-for="s in summary.slice(0, 4)" :key="s.name" :xs="12" :sm="6">
        <div class="sum-card">
          <div class="s-name">{{ s.name }}</div>
          <div class="s-val">{{ s.active }}<small> / {{ s.value }} 在用</small></div>
        </div>
      </el-col>
    </el-row>

    <div class="it-card" style="margin-bottom:14px">
      <el-form :inline="true">
        <el-form-item label="系统">
          <el-select v-model="filters.system_name" placeholder="全部" clearable filterable allow-create style="width:140px">
            <el-option v-for="d in dicts.app_system" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
          </el-select>
        </el-form-item>
        <el-form-item label="动作">
          <el-select v-model="filters.action" placeholder="全部" clearable style="width:110px">
            <el-option label="开通" value="开通" />
            <el-option label="变更" value="变更" />
            <el-option label="注销" value="注销" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部" clearable style="width:110px">
            <el-option label="在用" value="active" />
            <el-option label="已注销" value="closed" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-input v-model="filters.keyword" placeholder="账号/使用人/部门" clearable style="width:170px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="load"><el-icon><Search /></el-icon> 查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="it-card">
      <el-table :data="rows" stripe border v-loading="loading" :max-height="520" empty-text="暂无台账记录">
        <el-table-column prop="operate_date" label="操作日期" width="120" />
        <el-table-column prop="system_name" label="所属系统" width="130" />
        <el-table-column prop="account_name" label="账号" width="140" />
        <el-table-column prop="owner_name" label="使用人" width="100" />
        <el-table-column prop="dept" label="部门" width="110" />
        <el-table-column prop="permission_desc" label="权限说明" min-width="180" show-overflow-tooltip />
        <el-table-column label="动作" width="90">
          <!-- 注销用灰色、变更用黄色、开通用绿色：tag 颜色按动作直接定，不走状态字段 -->
          <template #default="{ row }">
            <el-tag size="small" :type="row.action === '注销' ? 'info' : row.action === '变更' ? 'warning' : 'success'">{{ row.action }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'active' ? 'primary' : 'info'" effect="plain">
              {{ row.status === 'active' ? '在用' : '已注销' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <!-- 审计员只读：台账里有账号与权限说明，不给写入口，避免审计角色顺手改台账 -->
          <template #default="{ row }">
            <template v-if="canWrite">
              <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button size="small" text type="danger" @click="onDelete(row)">删除</el-button>
            </template>
            <span v-else class="muted">只读</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="formVisible" :title="form.account_id ? '编辑账号' : '登记账号'" width="620px">
      <el-form :model="form" label-width="92px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="所属系统">
              <el-select v-model="form.system_name" filterable allow-create style="width:100%" placeholder="如 ERP / OA">
                <el-option v-for="d in dicts.app_system" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="账号"><el-input v-model="form.account_name" /></el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="使用人"><el-input v-model="form.owner_name" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="部门">
              <el-select v-model="form.dept" filterable allow-create style="width:100%">
                <el-option v-for="d in dicts.dept" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="操作类型">
              <el-select v-model="form.action" style="width:100%">
                <el-option label="开通" value="开通" />
                <el-option label="变更" value="变更" />
                <el-option label="注销" value="注销" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="操作日期">
              <el-date-picker v-model="form.operate_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="权限说明">
          <el-input v-model="form.permission_desc" type="textarea" :rows="2" placeholder="如：财务模块只读、可导出报表" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="active">在用</el-radio>
            <el-radio value="closed">已注销</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Plus, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import R from '../api'
import { useUserStore } from '../store/user'

const userStore = useUserStore()
// 审计员只读：台账涉及账号与权限，不开放写入
const canWrite = computed(() => !userStore.isAuditor)

const rows = ref([])
// 按系统聚合的「在用 / 总数」，给顶部卡片用；与列表共用同一组筛选条件
const summary = ref([])
const loading = ref(false)
// 下拉字典（应用系统、部门）：只读基础数据，取不到也不影响表格
const dicts = reactive({ app_system: [], dept: [] })
const filters = reactive({ system_name: '', action: '', status: '', keyword: '' })

// 新增/编辑共用同一个表单对象，用 account_id 有无区分模式
const formVisible = ref(false)
const saving = ref(false)
const form = reactive({})

// 组装查询参数：空字符串不下发（后端按「没有该条件」处理，不要传空串当筛选值）；
// all=1 只给能看全公司的角色，普通用户不传，由后端限定本人范围
function params() {
  const p = {}
  if (userStore.canViewAll) p.all = 1
  Object.keys(filters).forEach(k => { if (filters[k]) p[k] = filters[k] })
  return p
}

// 列表与汇总用同一组参数串行请求：汇总卡片的数字必须和表格是同一次筛选的结果，
// 否则会出现「卡片显示 8 个在用、表格只列出 3 条」的对不上
async function load() {
  loading.value = true
  try {
    rows.value = await R.listAccounts(params())
    summary.value = await R.accountSummary(params())
  } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}

function resetFilters() {
  Object.assign(filters, { system_name: '', action: '', status: '', keyword: '' })
  load()
}

// 清空后再赋默认值：不先清空的话，上一条记录的 account_id 会残留，
// 点「登记账号」保存时会走进更新分支，把别人的记录改掉
function openCreate() {
  Object.keys(form).forEach(k => delete form[k])
  const d = new Date(); const p = n => String(n).padStart(2, '0')
  form.action = '开通'
  form.status = 'active'
  form.operate_date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  formVisible.value = true
}
// 同样先清空再整体覆盖：直接 assign 会把上次新增留下的默认动作/状态带进来
function openEdit(row) {
  Object.keys(form).forEach(k => delete form[k])
  Object.assign(form, row)
  formVisible.value = true
}
// 有 account_id 走更新，没有走新增；成功后关窗并重新取数（汇总卡片也要跟着变）
async function onSave() {
  saving.value = true
  try {
    if (form.account_id) await R.updateAccount(form.account_id, form)
    else await R.createAccount(form)
    ElMessage.success('已保存')
    formVisible.value = false
    load()
  } catch (e) { ElMessage.error(e.message) } finally { saving.value = false }
}
// 二次确认再删：ElMessageBox.confirm 取消时会 reject，catch 后直接返回，不弹错误提示
async function onDelete(row) {
  try {
    await ElMessageBox.confirm('确认删除该台账记录？', '提示', { type: 'warning' })
  } catch { return }
  try {
    await R.deleteAccount(row.account_id)
    ElMessage.success('已删除')
    load()
  } catch (e) { ElMessage.error(e.message) }
}

// 先取字典再取列表：字典失败只影响下拉可选项，台账本身照常展示
onMounted(async () => {
  try {
    const d = await R.getDicts(false)
    dicts.app_system = d.app_system
    dicts.dept = d.dept
  } catch { /* ignore */ }
  load()
})
</script>

<style scoped>
@media (min-width: 1200px) { .it-page { padding-right: 272px; } }
.page-head { margin-bottom: 14px; }
.page-sub { font-size: 12px; color: var(--it-text-sub); margin-top: 4px; }
.head-actions { display: flex; gap: 10px; }
.card-row { margin-bottom: 14px; }
.sum-card { background: var(--it-card); border: 1px solid var(--it-border); border-radius: 10px; padding: 12px 16px; }
.sum-card .s-name { font-size: 12px; color: var(--it-text-sub); }
.sum-card .s-val { font-size: 22px; font-weight: 700; color: var(--it-primary); margin-top: 2px; }
.sum-card .s-val small { font-size: 12px; font-weight: 500; color: var(--it-text-sub); }
.muted { color: var(--it-text-sub); font-size: 12px; }
</style>
