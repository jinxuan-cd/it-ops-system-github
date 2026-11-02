<template>
  <div class="it-page">
    <div class="it-between" style="margin-bottom: 14px">
      <h3 class="it-section-title" style="margin:0">工单录入</h3>
      <el-radio-group v-model="mode" size="small">
        <el-radio-button value="standard">标准录入</el-radio-button>
        <el-radio-button value="quick">快捷录入</el-radio-button>
      </el-radio-group>
    </div>

    <div class="create-layout">
      <!-- 表单区（支持 Ctrl+V 直接粘贴截图为附件） -->
      <div class="it-card form-area" @paste="onPaste">
        <el-form :model="form" label-width="92px" label-position="right">
          <el-row :gutter="16">
            <el-col :span="mode === 'quick' ? 12 : 24">
              <el-form-item label="发生时间" required>
                <el-date-picker v-model="form.happen_time" type="datetime" placeholder="选择时间" style="width:100%" value-format="YYYY-MM-DD HH:mm:ss" />
              </el-form-item>
            </el-col>
            <el-col :span="mode === 'quick' ? 12 : 12">
              <el-form-item label="部门">
                <el-select v-model="form.dept" placeholder="选择或直接输入部门" filterable allow-create default-first-option clearable style="width:100%">
                  <el-option v-for="d in dicts.dept" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="mode === 'quick' ? 12 : 12">
              <el-form-item label="联系人">
                <el-input v-model="form.contact" placeholder="联系人" />
              </el-form-item>
            </el-col>
            <el-col :span="mode === 'quick' ? 12 : 12">
              <el-form-item label="应用系统">
                <el-select v-model="form.app_system" placeholder="选择或直接输入系统" filterable allow-create default-first-option clearable style="width:100%" @change="onPick">
                  <el-option v-for="d in dicts.app_system" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="mode === 'quick' ? 12 : 12">
              <el-form-item label="问题类别">
                <el-select v-model="form.problem_type" placeholder="选择或直接输入类别" filterable allow-create default-first-option clearable style="width:100%" @change="onPick">
                  <el-option v-for="d in dicts.problem_type" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item label="服务内容" required>
            <el-input v-model="form.service_content" type="textarea" :rows="3" placeholder="运维服务内容描述" />
          </el-form-item>

          <template v-if="mode === 'standard'">
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="完成时间">
                  <el-date-picker v-model="form.finish_time" type="datetime" placeholder="完成后填写" style="width:100%" value-format="YYYY-MM-DD HH:mm:ss" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="处理状态">
                  <el-radio-group v-model="form.status">
                    <el-radio value="processing">处理中</el-radio>
                    <el-radio value="done">已完成</el-radio>
                  </el-radio-group>
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="接单方式">
              <div>
                <el-checkbox v-model="form.pool" :disabled="form.status === 'done'">
                  投入待接单池，由运维抢单（不指定处理人）
                </el-checkbox>
                <div class="pool-tip">勾选后工单状态为「待接单」，所有运维账号会收到待办与右下角接单提醒，谁先接取谁负责。</div>
              </div>
            </el-form-item>
            <el-form-item label="处理说明">
              <el-input v-model="form.handle_desc" type="textarea" :rows="4" placeholder="处理过程与结果说明" />
            </el-form-item>
            <el-form-item label="同步知识库" v-if="form.status === 'done'">
              <el-checkbox v-model="form.sync_kb">完成后同步到个人知识库</el-checkbox>
            </el-form-item>
            <el-form-item label="附件">
              <el-upload
                :action="uploadUrl"
                :headers="uploadHeaders"
                :file-list="fileList"
                multiple
                :on-success="onUploadSuccess"
                :on-remove="onUploadRemove"
                list-type="text"
              >
                <el-button type="primary" plain><el-icon><Upload /></el-icon> 上传截图/日志</el-button>
                <template #tip>
                  <div class="paste-tip">支持直接 Ctrl+V 粘贴钉钉/微信等截图，自动上传为附件</div>
                </template>
              </el-upload>
            </el-form-item>
          </template>

          <el-form-item>
            <el-button type="primary" :loading="submitting" @click="onSubmit">
              {{ mode === 'quick' ? '保存草稿（处理中）' : '提交工单' }}
            </el-button>
            <el-button @click="resetForm">重置</el-button>
          </el-form-item>
        </el-form>
      </div>

      <!-- 知识库推荐区 -->
      <div class="it-card kb-area" v-if="mode === 'standard'">
        <div class="it-between" style="margin-bottom:10px">
          <h4 class="it-section-title" style="margin:0">历史方案推荐</h4>
          <el-input v-model="kw" size="small" placeholder="关键词兜底检索" style="width:160px" @keyup.enter="fetchRecommend" @input="debounceRecommend">
            <template #append><el-button :icon="Search" @click="fetchRecommend" /></template>
          </el-input>
        </div>
        <div v-if="!knowledgeList.length && !historyList.length" class="kb-empty">
          选择「应用系统 + 问题类别」或在左侧填写「服务内容」后，将自动匹配历史处理方式与知识库方案
        </div>

        <div v-if="historyList.length" class="kb-group">
          <div class="kb-group-title"><el-icon><Clock /></el-icon> 历史处理方式（来自已完成工单）</div>
          <div v-for="h in historyList" :key="'h'+h.ticket_id" class="kb-item">
            <div class="kb-meta">
              <el-tag size="small" type="info">{{ h.app_system }}</el-tag>
              <el-tag size="small" type="warning">{{ h.problem_type }}</el-tag>
              <span class="kb-view">{{ (h.happen_time || '').slice(0, 10) }}</span>
            </div>
            <div class="kb-sum">{{ h.service_content }}</div>
            <div class="kb-sol"><b>处理方式：</b>{{ h.handle_desc }}</div>
            <el-button size="small" text type="primary" @click="applySolutionText(h.handle_desc)">应用到处理说明</el-button>
          </div>
        </div>

        <div v-if="knowledgeList.length" class="kb-group">
          <div class="kb-group-title"><el-icon><Reading /></el-icon> 知识库方案</div>
          <div v-for="k in knowledgeList" :key="'k'+k.kb_id" class="kb-item">
            <div class="kb-meta">
              <el-tag size="small" type="info">{{ k.app_system }}</el-tag>
              <el-tag size="small" type="warning">{{ k.problem_type }}</el-tag>
              <span class="kb-view">浏览 {{ k.view_count }}</span>
            </div>
            <div class="kb-sum">{{ k.problem_summary }}</div>
            <div class="kb-sol">{{ k.solution }}</div>
            <el-button size="small" text type="primary" @click="applySolutionText(k.solution)">应用到处理说明</el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Search, Upload, Clock, Reading } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import R from '../api'

const route = useRoute()
const mode = ref(route.query.mode === 'quick' ? 'quick' : 'standard')
const dicts = reactive({ dept: [], app_system: [], problem_type: [] })
const knowledgeList = ref([])
const historyList = ref([])
const kw = ref('')
const submitting = ref(false)

const uploadUrl = '/api/tickets/upload'
const uploadHeaders = { Authorization: `Bearer ${localStorage.getItem('itops_token')}` }
const fileList = ref([])

const form = reactive({
  happen_time: '',
  contact: '',
  dept: '',
  service_content: '',
  app_system: '',
  problem_type: '',
  finish_time: '',
  handle_desc: '',
  status: 'processing',
  sync_kb: false,
  pool: false,
  attachment: []
})

let timer = null
function debounceRecommend() {
  clearTimeout(timer)
  timer = setTimeout(fetchRecommend, 400)
}

async function fetchDicts() {
  try {
    const data = await R.getDicts(false)
    dicts.dept = data.dept
    dicts.app_system = data.app_system
    dicts.problem_type = data.problem_type
  } catch (e) { /* 字典加载失败不阻断录入 */ }
}

async function fetchRecommend() {
  // 关键字未填时，自动用「服务内容」参与匹配
  const keyword = kw.value || form.service_content.trim()
  if (!form.app_system && !form.problem_type && !keyword) {
    knowledgeList.value = []; historyList.value = []; return
  }
  try {
    const data = await R.recommend({
      app_system: form.app_system,
      problem_type: form.problem_type,
      keyword
    })
    knowledgeList.value = data.knowledge || []
    historyList.value = data.history || []
  } catch (e) { /* 静默，避免录入干扰 */ }
}
function onPick() { fetchRecommend() }

// 输入服务内容时自动（防抖）触发推荐——实现「关键字自动识别服务内容」
watch(() => form.service_content, debounceRecommend)

function applySolutionText(text) {
  if (!text) return
  form.handle_desc = (form.handle_desc ? form.handle_desc + '\n' : '') + text
  ElMessage.success('已应用到处理说明')
}

function onUploadSuccess(res, file) {
  if (res && res.code === 0) {
    form.attachment.push(...res.data)
  }
}
function onUploadRemove(file) {
  const url = file.response && file.response.data ? file.response.data[0] : null
  if (url) form.attachment = form.attachment.filter(u => u !== url)
}

// Ctrl+V 粘贴截图 → 自动上传为附件
let pasteSeq = 0
async function onPaste(e) {
  if (mode.value !== 'standard') return
  const items = (e.clipboardData && e.clipboardData.items) || []
  const files = []
  for (const it of items) {
    if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
      const f = it.getAsFile()
      if (f) files.push(f)
    }
  }
  if (!files.length) return
  e.preventDefault()
  try {
    const fd = new FormData()
    files.forEach((f, i) => fd.append('files', f, f.name || `paste-${Date.now()}-${i}.png`))
    const urls = await R.uploadFiles(fd)
    form.attachment.push(...urls)
    urls.forEach(u => fileList.value.push({ name: `粘贴截图-${++pasteSeq}.png`, response: { code: 0, data: [u] } }))
    ElMessage.success(`已粘贴上传 ${urls.length} 张截图`)
  } catch (err) {
    ElMessage.error('粘贴上传失败：' + err.message)
  }
}

async function onSubmit() {
  if (!form.happen_time || !form.service_content) {
    ElMessage.warning('请填写发生时间与服务内容')
    return
  }
  submitting.value = true
  try {
    const payload = {
      happen_time: form.happen_time,
      contact: form.contact,
      dept: form.dept,
      service_content: form.service_content,
      app_system: form.app_system,
      problem_type: form.problem_type,
      attachment: form.attachment
    }
    if (mode.value === 'standard') {
      payload.status = form.status
      payload.finish_time = form.finish_time
      payload.handle_desc = form.handle_desc
      // 投入待接单池：由运维抢单，不在这里直接标记完成
      if (form.pool && form.status !== 'done') payload.pool = true
      const created = await R.createTicket(payload)
      if (form.status === 'done') {
        await R.completeTicket(created.ticket_id, {
          finish_time: form.finish_time,
          handle_desc: form.handle_desc,
          sync_kb: form.sync_kb,
          app_system: form.app_system,
          problem_type: form.problem_type,
          service_content: form.service_content,
          solution: form.handle_desc
        })
      }
    } else {
      payload.status = 'processing'
      await R.createTicket(payload)
    }
    ElMessage.success('工单已保存')
    resetForm()
    knowledgeList.value = []
    historyList.value = []
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    submitting.value = false
  }
}

function resetForm() {
  Object.assign(form, {
    happen_time: '', contact: '', dept: '', service_content: '',
    app_system: '', problem_type: '', finish_time: '', handle_desc: '',
    status: 'processing', sync_kb: false, pool: false, attachment: []
  })
  fileList.value = []
}

onMounted(fetchDicts)
</script>

<style scoped>
.create-layout { display: flex; gap: 16px; align-items: flex-start; }
.form-area { flex: 1; min-width: 0; }
.kb-area { width: 320px; flex-shrink: 0; max-height: 78vh; overflow-y: auto; }
.kb-empty { color: var(--it-text-sub); font-size: 13px; padding: 20px 0; text-align: center; }
.paste-tip { font-size: 12px; color: var(--it-text-sub); margin-top: 6px; }
.pool-tip { font-size: 12px; color: var(--it-text-sub); line-height: 1.6; margin-top: 4px; }
.kb-item { border: 1px solid var(--it-border); border-radius: 8px; padding: 10px; margin-bottom: 10px; }
.kb-meta { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.kb-view { margin-left: auto; font-size: 12px; color: var(--it-text-sub); }
.kb-sum { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
.kb-sol { font-size: 13px; color: #4a5266; white-space: pre-wrap; margin-bottom: 6px; }
.kb-group { margin-bottom: 14px; }
.kb-group-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: #2b3245; margin-bottom: 8px; }

@media (max-width: 1100px) {
  .create-layout { flex-direction: column; }
  .kb-area { width: 100%; }
}
</style>
