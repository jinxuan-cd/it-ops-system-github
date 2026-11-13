<!--
  工单录入 —— IT 运维工单台账与日报自动管理系统
  录入工单，部门/系统/类别支持可选可写并校验基础字典，可粘贴故障截图

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.2
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page">
    <div class="it-between" style="margin-bottom: 14px">
      <h3 class="it-section-title" style="margin:0">工单录入</h3>
      <!-- 标准录入带状态、处理说明、附件与知识库推荐；快捷录入只留必填项，用于现场快速补录 -->
      <el-radio-group v-model="mode" size="small">
        <el-radio-button value="standard">标准录入</el-radio-button>
        <el-radio-button value="quick">快捷录入</el-radio-button>
      </el-radio-group>
    </div>

    <div class="create-layout">
      <!-- 表单区（支持 Ctrl+V 直接粘贴截图为附件） -->
      <div class="it-card form-area" @paste="onPaste">
        <el-form :model="form" label-width="92px" label-position="right">
          <!-- 部门 / 应用系统 / 问题类别是「可选可写」：不必先展开下拉，能直接打字，但值必须命中基础字典 -->
          <el-row :gutter="16">
            <el-col :span="mode === 'quick' ? 12 : 24">
              <el-form-item label="发生时间" required>
                <el-date-picker v-model="form.happen_time" type="datetime" placeholder="选择时间" style="width:100%" value-format="YYYY-MM-DD HH:mm:ss" />
                <div class="pool-tip">补单可填实际发生时刻（可早于现在）。响应时间由系统按录入时刻自动生成，不会用完成时间代替。</div>
              </el-form-item>
            </el-col>
            <el-col :span="mode === 'quick' ? 12 : 12">
              <el-form-item label="部门">
                <el-select v-model="form.dept" placeholder="选择或输入部门（须为字典项）" filterable allow-create default-first-option clearable style="width:100%" @change="v => guardDict('dept', v)">
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
                <el-select v-model="form.app_system" placeholder="选择或输入系统（须为字典项）" filterable allow-create default-first-option clearable style="width:100%" @change="v => guardDict('app_system', v)">
                  <el-option v-for="d in dicts.app_system" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="mode === 'quick' ? 12 : 12">
              <el-form-item label="问题类别">
                <el-select v-model="form.problem_type" placeholder="选择或输入类别（须为字典项）" filterable allow-create default-first-option clearable style="width:100%" @change="v => guardDict('problem_type', v)">
                  <el-option v-for="d in dicts.problem_type" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item label="服务内容" required>
            <el-input v-model="form.service_content" type="textarea" :rows="3" placeholder="运维服务内容描述" />
          </el-form-item>

          <!-- 以下字段只在标准录入出现：完成时间、处理状态、处理说明与附件 -->
          <template v-if="mode === 'standard'">
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="结束时间">
                  <el-date-picker v-model="form.finish_time" type="datetime" placeholder="处理完结时刻" style="width:100%" value-format="YYYY-MM-DD HH:mm:ss" />
                  <div class="pool-tip">填实际处理完结的时刻。允许早于录入时刻（现场处理完回来补单），不会拿它当响应时间。</div>
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

        <!-- 历史处理方式：取自已完成的同类工单，点一下即可把当时的做法回填到处理说明 -->
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

        <!-- 知识库方案：人工沉淀或 AI 整理出的标准解法，与历史工单互为补充 -->
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
// 入口可带 ?mode=quick 直接进快捷录入，其余情况一律进标准录入
const mode = ref(route.query.mode === 'quick' ? 'quick' : 'standard')
// 基础字典候选值（只含启用项）：下拉选项与 guardDict 校验都以这份数据为准
const dicts = reactive({ dept: [], app_system: [], problem_type: [] })
// 推荐结果分两路存：知识库方案与历史工单处理方式，各自渲染、互不覆盖
const knowledgeList = ref([])
const historyList = ref([])
// 关键词兜底检索框：留空时自动拿「服务内容」参与匹配
const kw = ref('')
// 提交中置灰按钮，避免手快点出两条重复工单
const submitting = ref(false)

// 附件上传地址与请求头：el-upload 不走 axios 拦截器，token 必须在这里手写
const uploadUrl = '/api/tickets/upload'
const uploadHeaders = { Authorization: `Bearer ${localStorage.getItem('itops_token')}` }
// 已上传文件列表，仅用于界面回显；真正提交的数据在 form.attachment
const fileList = ref([])

// 一张工单的全部录入字段；attachment 存后端返回的 url 数组，不是 File 对象
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

// 推荐接口按 400ms 防抖：边打字边请求会把后端打满，也容易出现结果乱序
let timer = null
function debounceRecommend() {
  clearTimeout(timer)
  timer = setTimeout(fetchRecommend, 400)
}

// 拉基础字典（只取启用项）；失败不阻断录入，没有候选值时校验会自动跳过
async function fetchDicts() {
  try {
    const data = await R.getDicts(false)
    dicts.dept = data.dept
    dicts.app_system = data.app_system
    dicts.problem_type = data.problem_type
  } catch (e) { /* 字典加载失败不阻断录入 */ }
}

// 按「系统 + 类别 + 关键词」拉历史工单与知识库推荐，三者全空时清空列表并不再请求
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
// 选中系统或类别后立即重算推荐，不用用户再点一次搜索
function onPick() { fetchRecommend() }

// ---------------------------------------------------------------------------
// 部门 / 应用系统 / 问题类别：可以打字输入（不必先展开下拉），
// 但值必须命中「基础字典」。命中就保留（顺带纠正多余空格、大小写），
// 没命中立刻清空并提示去字典里维护，避免录入出字典外的脏数据。
// ---------------------------------------------------------------------------
const DICT_NAME = { dept: '部门', app_system: '应用系统', problem_type: '问题类别' }

// 严格按标签文本全等比对；归一化只用于下一步「纠偏」，不参与命中判断
function dictHas(field, v) {
  return (dicts[field] || []).some(d => d.dict_label === v)
}

// 录入时的守门人：命中字典就直接用；只是空格/大小写不一致就按字典纠正回填；
// 完全对不上则清空字段并提示去「基础字典」维护，不让字典外的脏值流进台账
function guardDict(field, v) {
  if (!v) return
  const list = dicts[field] || []
  if (!list.length) return // 字典没加载出来时不阻断录入
  if (dictHas(field, v)) { if (field !== 'dept') onPick(); return }

  const norm = String(v).replace(/\s+/g, '').toLowerCase()
  const hit = list.find(d => String(d.dict_label).replace(/\s+/g, '').toLowerCase() === norm)
  if (hit) {
    form[field] = hit.dict_label
    ElMessage.info(`已按字典纠正为「${hit.dict_label}」`)
    if (field !== 'dept') onPick()
    return
  }
  const bad = v
  form[field] = ''
  ElMessage.warning(`${DICT_NAME[field]}「${bad}」不在基础字典中，请从下拉列表选择；需要新增请先到「基础字典」维护。`)
}

// onSubmit 前的最后一道闸：guardDict 可能被绕过（程序回填、浏览器自动填充），
// 提交前再全量比对一次，防止字典外的值写进台账
// 提交前兜底再校验一次
function checkDicts() {
  for (const f of ['dept', 'app_system', 'problem_type']) {
    const v = form[f]
    if (!v) continue
    const list = dicts[f] || []
    if (!list.length) continue
    if (!dictHas(f, v)) {
      ElMessage.warning(`${DICT_NAME[f]}「${v}」不在基础字典中，请重新选择`)
      return false
    }
  }
  return true
}

// 输入服务内容时自动（防抖）触发推荐——实现「关键字自动识别服务内容」
watch(() => form.service_content, debounceRecommend)

// 追加而非覆盖：用户可能已经写了一半处理说明，直接替换会把已写内容冲掉
function applySolutionText(text) {
  if (!text) return
  form.handle_desc = (form.handle_desc ? form.handle_desc + '\n' : '') + text
  ElMessage.success('已应用到处理说明')
}

// 上传成功只认 code === 0，避免把失败响应里的错误信息当成附件地址存下来
function onUploadSuccess(res, file) {
  if (res && res.code === 0) {
    form.attachment.push(...res.data)
  }
}
// 移除附件时同步摘掉 form.attachment 里的 url，否则提交仍会带上已删掉的文件
function onUploadRemove(file) {
  const url = file.response && file.response.data ? file.response.data[0] : null
  if (url) form.attachment = form.attachment.filter(u => u !== url)
}

// Ctrl+V 粘贴截图 → 自动上传为附件
// 只认剪贴板里的 image/* 文件；纯文本粘贴原样交给输入框，不拦默认行为
// 粘贴计数仅用于给回显项起个不重复的名字
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
    // 直接拿剪贴板里的 File 上传，不必先存盘再点选文件；成功后补一条回显记录
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

// 标准录入分两步：先建工单，状态为已完成时再调 completeTicket 补完成信息与知识库同步；
// 快捷录入只落一条「处理中」的草稿，细节留到工单记录里补
async function onSubmit() {
  if (!form.happen_time || !form.service_content) {
    ElMessage.warning('请填写发生时间与服务内容')
    return
  }
  if (!checkDicts()) return
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

// 重置只清字段与附件，保留当前录入模式，避免被弹回标准录入
function resetForm() {
  Object.assign(form, {
    happen_time: '', contact: '', dept: '', service_content: '',
    app_system: '', problem_type: '', finish_time: '', handle_desc: '',
    status: 'processing', sync_kb: false, pool: false, attachment: []
  })
  fileList.value = []
}

// 字典必须先到，后面 guardDict 才有比对依据
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
