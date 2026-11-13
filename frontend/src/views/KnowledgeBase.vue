<!--
  知识库 —— IT 运维工单台账与日报自动管理系统
  运维知识检索、录入、AI 整理与附件解析

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.2
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page">
    <!-- 顶部两个入口：AI 整理把已完成工单聚类成知识点；新增支持手写或上传文档解析 -->
    <div class="it-between" style="margin-bottom:14px">
      <h3 class="it-section-title" style="margin:0">个人运维知识库</h3>
      <div>
        <el-button type="success" :loading="organizing" @click="organize"><el-icon><MagicStick /></el-icon> AI 自动整理（从工单生成知识点）</el-button>
        <el-button type="primary" @click="openAdd"><el-icon><Plus /></el-icon> 新增条目</el-button>
      </div>
    </div>

    <!-- 检索三件套：应用系统、问题类别、关键词，都由后端过滤，前端不做本地筛选 -->
    <div class="it-card" style="margin-bottom:14px">
      <el-form :inline="true" :model="filters">
        <el-form-item label="应用系统">
          <el-select v-model="filters.app_system" placeholder="全部" clearable style="width:150px">
            <el-option v-for="d in dicts.app_system" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
          </el-select>
        </el-form-item>
        <el-form-item label="问题类别">
          <el-select v-model="filters.problem_type" placeholder="全部" clearable style="width:150px">
            <el-option v-for="d in dicts.problem_type" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="filters.keyword" placeholder="搜索摘要/方案" clearable style="width:200px" @keyup.enter="load" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="load"><el-icon><Search /></el-icon> 搜索</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="it-card">
      <el-table :data="rows" stripe v-loading="loading">
        <el-table-column prop="app_system" label="应用系统" width="130" />
        <el-table-column prop="problem_type" label="问题类别" width="120" />
        <el-table-column prop="problem_summary" label="问题摘要" min-width="220" show-overflow-tooltip />
        <el-table-column prop="keyword" label="关键词" width="160" show-overflow-tooltip />
        <!-- 对外公开：打开即出现在员工自助门户，建议只放通用问题的标准解法 -->
        <el-table-column label="对外公开" width="96">
          <template #default="{ row }">
            <el-switch :model-value="!!row.is_public" size="small" @change="(v) => togglePublic(row, v)" />
          </template>
        </el-table-column>
        <el-table-column prop="view_count" label="浏览" width="80" />
        <el-table-column label="来源工单" width="100">
          <template #default="{ row }">
            <span v-if="row.source_ticket_id">#{{ row.source_ticket_id }}</span><span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openDetail(row)">查看</el-button>
            <el-button size="small" text type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 新增 -->
    <!-- 处理方案可手写，也可上传文档由后端解析成文本回填，追加而不覆盖 -->
    <el-dialog v-model="addVisible" title="新增知识库条目" width="680px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="应用系统">
          <el-select v-model="form.app_system" filterable style="width:100%"><el-option v-for="d in dicts.app_system" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" /></el-select>
        </el-form-item>
        <el-form-item label="问题类别">
          <el-select v-model="form.problem_type" filterable style="width:100%"><el-option v-for="d in dicts.problem_type" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" /></el-select>
        </el-form-item>
        <el-form-item label="问题摘要"><el-input v-model="form.problem_summary" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="处理方案">
          <el-input v-model="form.solution" type="textarea" :rows="5" placeholder="可上传文档自动解析回填" />
        </el-form-item>
        <el-form-item label="文档解析">
          <el-upload :action="parseUrl" :headers="uploadHeaders" :show-file-list="false" :on-success="onParsed" accept=".txt,.md,.csv,.pdf,.docx">
            <el-button type="primary" plain><el-icon><Upload /></el-icon> 上传文档自动解析</el-button>
          </el-upload>
          <span class="tip">支持 txt/md/csv/pdf/docx，解析文本回填到方案</span>
        </el-form-item>
        <el-form-item label="关键词"><el-input v-model="form.keyword" placeholder="留空自动提取" /></el-form-item>
        <el-form-item label="对外公开">
          <el-switch v-model="form.is_public" />
          <span class="pub-tip">开启后会出现在员工「常见问题自助门户」里，建议只公开通用问题的标准解法</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 详情 -->
    <!-- 来源工单为空表示手动录入，用来追溯这条知识点是怎么来的 -->
    <el-dialog v-model="detailVisible" title="知识库详情" width="680px">
      <template v-if="detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="应用系统">{{ detail.app_system }}</el-descriptions-item>
          <el-descriptions-item label="问题类别">{{ detail.problem_type }}</el-descriptions-item>
          <el-descriptions-item label="浏览次数" :span="2">{{ detail.view_count }}</el-descriptions-item>
          <el-descriptions-item label="问题摘要" :span="2">{{ detail.problem_summary }}</el-descriptions-item>
          <el-descriptions-item label="处理方案" :span="2">{{ detail.solution }}</el-descriptions-item>
          <el-descriptions-item label="关键词" :span="2">{{ detail.keyword }}</el-descriptions-item>
          <el-descriptions-item label="来源工单" :span="2">
            <span v-if="detail.source_ticket_id">工单 #{{ detail.source_ticket_id }}</span><span v-else>手动录入</span>
          </el-descriptions-item>
        </el-descriptions>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Plus, Search, Upload, MagicStick } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import R from '../api'

// 列表数据与 loading 分离，检索时保留旧数据避免闪空
const rows = ref([])
const loading = ref(false)
// AI 整理可能跑几十秒，按钮进 loading 防重复触发
const organizing = ref(false)
// 只用应用系统与问题类别两类字典，做筛选条件与表单下拉
const dicts = reactive({ dept: [], app_system: [], problem_type: [] })
// 检索条件：空值表示不限，整体透传给后端
const filters = reactive({ app_system: '', problem_type: '', keyword: '' })
// 新增弹窗、详情弹窗、保存中状态
const addVisible = ref(false)
const detailVisible = ref(false)
const saving = ref(false)
const detail = ref(null)
// 文档解析接口与请求头：el-upload 不走 axios 拦截器，token 必须手写
const parseUrl = '/api/knowledge/parse'
const uploadHeaders = { Authorization: `Bearer ${localStorage.getItem('itops_token')}` }
// is_public 默认 false：知识库默认私有，要出现在员工门户必须显式打开
const form = reactive({ app_system: '', problem_type: '', problem_summary: '', solution: '', keyword: '', is_public: false })

// 字典只取启用项；失败静默，下拉为空时仍可用关键词检索
async function loadDicts() {
  const data = await R.getDicts(false)
  dicts.app_system = data.app_system; dicts.problem_type = data.problem_type
}
// 检索列表：筛选对象整体透传，后端按空值忽略该项
async function load() {
  loading.value = true
  try { rows.value = await R.listKnowledge({ ...filters }) } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}
// 开关先请求成功再改本地值：请求失败时界面不能先跳过去，否则和库里不一致
async function togglePublic(row, v) {
  try {
    await R.updateKnowledge(row.kb_id, { is_public: v ? 1 : 0 })
    row.is_public = v ? 1 : 0
    ElMessage.success(v ? '已公开到自助门户' : '已取消公开')
  } catch (e) { ElMessage.error(e.message) }
}

// 清空检索条件后立即重查
function resetFilters() { Object.assign(filters, { app_system: '', problem_type: '', keyword: '' }); load() }

// AI 整理：按「应用系统 + 问题类别」聚类已完成工单，自动总结处理方案并生成/更新知识点。
// 会写库且耗时，所以先二次确认，确认文案里写清按什么维度聚类
async function organize() {
  try {
    await ElMessageBox.confirm('将把你的「已完成工单」按 应用系统+问题类别 聚类，自动总结处理方案并生成/更新知识条目。是否继续？', 'AI 整理知识库', { type: 'info' })
  } catch (e) { return }
  organizing.value = true
  try {
    const res = await R.aiOrganizeKnowledge()
    ElMessage.success((res && res.__message) || '知识库已整理')
    load()
  } catch (e) { ElMessage.error(e.message) } finally { organizing.value = false }
}

// 打开前清空表单，防止上一次的输入残留到新条目里
function openAdd() {
  Object.assign(form, { app_system: '', problem_type: '', problem_summary: '', solution: '', keyword: '', is_public: false })
  addVisible.value = true
}
// 解析结果追加到已有方案后面：用户可能已经手写了一部分，不能直接覆盖
function onParsed(res) {
  if (res && res.code === 0) {
    form.solution = (form.solution ? form.solution + '\n' : '') + res.data.text
    ElMessage.success('文档已解析，文本已回填到处理方案')
  }
}
// 这里只有新增：编辑走「对外公开」开关与工单详情里的知识库同步
async function onSave() {
  saving.value = true
  try {
    await R.createKnowledge({ ...form })
    ElMessage.success('已保存'); addVisible.value = false; load()
  } catch (e) { ElMessage.error(e.message) } finally { saving.value = false }
}
// 详情单独请求：列表接口不返回完整 solution，只带摘要
async function openDetail(row) {
  try { detail.value = await R.getKnowledge(row.kb_id); detailVisible.value = true } catch (e) { ElMessage.error(e.message) }
}
// 删除不可恢复，二次确认后才调接口
async function onDelete(row) {
  // 点「取消」时 confirm 会 reject，不接住会抛未捕获的 Promise 异常
  try { await ElMessageBox.confirm('确认删除该知识条目？', '提示', { type: 'warning' }) } catch { return }
  try { await R.deleteKnowledge(row.kb_id); ElMessage.success('已删除'); load() } catch (e) { ElMessage.error(e.message) }
}

// 字典与列表并行拉：字典只影响下拉候选，慢一点也不挡列表展示
onMounted(() => { loadDicts(); load() })
</script>

<style scoped>
.pub-tip { font-size: 12px; color: var(--it-text-sub); margin-left: 10px; }
.tip { font-size: 12px; color: var(--it-text-sub); margin-left: 10px; }
</style>
