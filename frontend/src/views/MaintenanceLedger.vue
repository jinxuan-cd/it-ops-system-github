<!--
  服务器维护台账 —— IT 运维工单台账与日报自动管理系统
  计划 → 实施 → 结果三段式记录，支持现场照片上传留档与后续调取

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-11-04　　版本：1.3.0
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page">
    <div class="it-between page-head">
      <div>
        <h3 class="it-section-title" style="margin:0">服务器维护台账</h3>
        <div class="page-sub">每次维护按「计划 → 实施 → 结果」留痕，照片随单归档，日后可随时调取现场记录</div>
      </div>
      <div class="head-actions">
        <el-button v-if="canWrite" type="primary" size="small" @click="openCreate"><el-icon><Plus /></el-icon> 登记维护</el-button>
      </div>
    </div>

    <el-row :gutter="14" class="card-row">
      <el-col v-for="c in cards" :key="c.key" :xs="12" :sm="6">
        <div class="sum-card" :class="c.key" @click="quickFilter(c)">
          <div class="s-name">{{ c.label }}</div>
          <div class="s-val">{{ c.value }}</div>
        </div>
      </el-col>
    </el-row>

    <div class="it-card" style="margin-bottom:14px">
      <el-form :inline="true">
        <el-form-item label="服务器">
          <el-input v-model="filters.keyword" placeholder="名称/计划/实施/结果" clearable style="width:180px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="filters.maint_type" placeholder="全部" clearable style="width:120px">
            <el-option v-for="t in meta.types" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.maint_status" placeholder="全部" clearable style="width:120px">
            <el-option label="待实施" value="planned" />
            <el-option label="进行中" value="processing" />
            <el-option label="已完成" value="done" />
          </el-select>
        </el-form-item>
        <el-form-item label="结果">
          <el-select v-model="filters.result_state" placeholder="全部" clearable style="width:120px">
            <el-option v-for="s in meta.states" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search"><el-icon><Search /></el-icon> 查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="it-card">
      <el-table :data="rows" stripe border v-loading="loading" :max-height="520" empty-text="暂无维护记录">
        <el-table-column prop="plan_date" label="计划日期" width="110" />
        <el-table-column prop="server_name" label="服务器" width="150" show-overflow-tooltip />
        <el-table-column prop="maint_type" label="类型" width="100" />
        <el-table-column label="计划 / 实施 / 结果" min-width="260">
          <!-- 三段合一列：悬停看全文，省得为每段都占一列把表格挤爆 -->
          <template #default="{ row }">
            <div class="tri-cell">
              <div class="tri-line"><span class="tri-tag plan">计划</span><span>{{ row.plan_content || '—' }}</span></div>
              <div class="tri-line"><span class="tri-tag exec">实施</span><span>{{ row.exec_content || '待实施' }}</span></div>
              <div class="tri-line"><span class="tri-tag res">结果</span><span>{{ row.result_content || (row.result_state ? row.result_state : '未填写') }}</span></div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="92">
          <template #default="{ row }">
            <el-tag size="small" :type="row.maint_status === 'done' ? 'success' : row.maint_status === 'processing' ? 'warning' : 'info'" effect="plain">
              {{ row.maint_status === 'done' ? '已完成' : row.maint_status === 'processing' ? '进行中' : '待实施' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="结果" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.result_state" size="small" :type="row.result_state === '成功' ? 'success' : row.result_state === '失败' ? 'danger' : 'warning'">{{ row.result_state }}</el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="照片" width="70">
          <template #default="{ row }">
            <el-badge v-if="row.photos && row.photos.length" :value="row.photos.length" type="info">
              <el-icon class="photo-icon" @click="openDetail(row)"><Camera /></el-icon>
            </el-badge>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="real_name" label="登记人" width="90" />
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <template v-if="canWrite">
              <el-button size="small" text type="primary" @click="openDetail(row)">详情</el-button>
              <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button size="small" text type="danger" @click="onDelete(row)">删除</el-button>
            </template>
            <el-button v-else size="small" text type="primary" @click="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
      <!-- 分页：服务端分页，每页条数固定默认 10，避免记录多了整页卡死 -->
      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="load"
          @size-change="() => { page = 1; load() }"
        />
      </div>
    </div>

    <!-- 新增 / 编辑弹窗 -->
    <el-dialog v-model="formVisible" :title="form.maint_id ? '编辑维护记录' : '登记维护'" width="680px" top="6vh">
      <el-form :model="form" label-width="92px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="服务器">
              <el-input v-model="form.server_name" placeholder="主机名 / IP，如 app-01 / 192.168.1.10" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="维护类型">
              <el-select v-model="form.maint_type" style="width:100%">
                <el-option v-for="t in meta.types" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="计划日期">
              <el-date-picker v-model="form.plan_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="实施日期">
              <el-date-picker v-model="form.exec_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="维护计划">
          <el-input v-model="form.plan_content" type="textarea" :rows="3" placeholder="要做什么：维护内容、范围、预计影响" />
        </el-form-item>
        <el-form-item label="实施过程">
          <el-input v-model="form.exec_content" type="textarea" :rows="4" placeholder="怎么做的：执行步骤、变更命令、遇到的情况" />
        </el-form-item>
        <el-form-item label="维护结果">
          <el-input v-model="form.result_content" type="textarea" :rows="3" placeholder="做得怎么样：结果、验证情况、遗留问题" />
        </el-form-item>
        <el-form-item label="结果结论">
          <el-radio-group v-model="form.result_state">
            <el-radio value="">未出结果</el-radio>
            <el-radio v-for="s in meta.states" :key="s" :value="s">{{ s }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="现场照片">
          <div class="photo-row">
            <div v-for="(p, i) in form.photos" :key="p" class="thumb">
              <img :src="p" alt="现场照片" @click="previewPhoto(form.photos, i)" />
              <el-icon class="thumb-del" @click="form.photos.splice(i, 1)"><CircleCloseFilled /></el-icon>
            </div>
            <div v-if="form.photos.length < 9" class="thumb add" :class="{ busy: uploading }" @click="pickPhoto">
              <el-icon v-if="!uploading"><Camera /></el-icon>
              <span>{{ uploading ? '上传中' : '添加照片' }}</span>
            </div>
          </div>
          <div class="photo-tip">支持 jpg/png/webp 等图片，最多 9 张；大图会自动压缩后上传</div>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 详情弹窗：三段全文 + 照片大图 -->
    <el-dialog v-model="detailVisible" :title="detail.server_name ? detail.server_name + ' · 维护详情' : '维护详情'" width="640px" top="6vh">
      <el-descriptions :column="2" border size="small" style="margin-bottom:12px">
        <el-descriptions-item label="类型">{{ detail.maint_type }}</el-descriptions-item>
        <el-descriptions-item label="登记人">{{ detail.real_name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="计划日期">{{ detail.plan_date || '—' }}</el-descriptions-item>
        <el-descriptions-item label="实施日期">{{ detail.exec_date || '—' }}</el-descriptions-item>
      </el-descriptions>
      <div class="d-block">
        <div class="d-title"><span class="tri-tag plan">计划</span></div>
        <div class="d-text">{{ detail.plan_content || '—' }}</div>
      </div>
      <div class="d-block">
        <div class="d-title"><span class="tri-tag exec">实施</span></div>
        <div class="d-text pre">{{ detail.exec_content || '待实施' }}</div>
      </div>
      <div class="d-block">
        <div class="d-title">
          <span class="tri-tag res">结果</span>
          <el-tag v-if="detail.result_state" size="small" :type="detail.result_state === '成功' ? 'success' : detail.result_state === '失败' ? 'danger' : 'warning'">{{ detail.result_state }}</el-tag>
        </div>
        <div class="d-text pre">{{ detail.result_content || '未填写' }}</div>
      </div>
      <div v-if="detail.photos && detail.photos.length" class="d-block">
        <div class="d-title"><span class="tri-tag">现场照片（{{ detail.photos.length }}）</span></div>
        <div class="photo-row">
          <img v-for="(p, i) in detail.photos" :key="p" :src="p" class="d-photo" alt="现场照片" @click="previewPhoto(detail.photos, i)" />
        </div>
      </div>
      <div v-if="detail.remark" class="d-block">
        <div class="d-title"><span class="tri-tag">备注</span></div>
        <div class="d-text">{{ detail.remark }}</div>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button v-if="canWrite" type="primary" @click="detailVisible = false; openEdit(detail)">补录 / 编辑</el-button>
      </template>
    </el-dialog>

    <!-- 照片大图预览 -->
    <el-image-viewer
      v-if="viewer.visible"
      :url-list="viewer.urls"
      :initial-index="viewer.index"
      @close="viewer.visible = false"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Plus, Search, Camera, CircleCloseFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import R from '../api'
import { useUserStore } from '../store/user'

const userStore = useUserStore()
// 审计员只读，但保留「详情」入口 —— 留档的意义就是事后能查
const canWrite = computed(() => !userStore.isAuditor)

const rows = ref([])
const loading = ref(false)
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
// 类型/结果枚举从后端取，避免前后端各写一份取值漂移
const meta = reactive({ types: [], states: [] })
const filters = reactive({ keyword: '', maint_type: '', maint_status: '', result_state: '' })

const formVisible = ref(false)
const detailVisible = ref(false)
const saving = ref(false)
const uploading = ref(false)
const form = reactive({})
const detail = reactive({})
const viewer = reactive({ visible: false, urls: [], index: 0 })

// 顶部统计卡：按状态统计本次筛选范围内的记录数（走同一次请求的 total 之外再拉一次汇总）
const cards = computed(() => {
  const byStatus = summary.value
  return [
    { key: 'planned', label: '待实施', value: byStatus.planned || 0, status: 'planned' },
    { key: 'processing', label: '进行中', value: byStatus.processing || 0, status: 'processing' },
    { key: 'done', label: '已完成', value: byStatus.done || 0, status: 'done' },
    { key: 'total', label: '全部记录', value: byStatus.total || 0, status: '' }
  ]
})
const summary = ref({})

// 组装查询参数：空值不下发；all=1 只给能看全公司的角色
function params() {
  const p = { page: page.value, pageSize: pageSize.value }
  if (userStore.canViewAll) p.all = 1
  Object.keys(filters).forEach(k => { if (filters[k]) p[k] = filters[k] })
  return p
}

async function load() {
  loading.value = true
  try {
    const r = await R.listMaintenances(params())
    rows.value = r.rows || []
    total.value = r.total || 0
  } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}

// 统计卡数字：列表筛选条件相同（不带分页），拿每页首条不划算，干脆按状态各查一次 count。
// 数据量小（维护台账月增十几条），四个 count 查询开销可以忽略
async function loadSummary() {
  try {
    const base = params()
    delete base.page; delete base.pageSize
    const out = { total: 0 }
    for (const st of ['planned', 'processing', 'done']) {
      const r = await R.listMaintenances({ ...base, maint_status: st, pageSize: 1 })
      out[st] = r.total || 0
      out.total += r.total || 0
    }
    summary.value = out
  } catch { /* 统计失败不影响列表 */ }
}

function search() { page.value = 1; load(); loadSummary() }
function resetFilters() {
  Object.assign(filters, { keyword: '', maint_type: '', maint_status: '', result_state: '' })
  search()
}
// 点统计卡直接按状态过滤，少一次下拉选择
function quickFilter(c) {
  filters.maint_status = c.status
  search()
}

// 清空后再赋默认值：不先清空的话上一条的 maint_id 会残留，保存会误走更新分支
function openCreate() {
  Object.keys(form).forEach(k => delete form[k])
  const d = new Date(); const p = n => String(n).padStart(2, '0')
  form.maint_type = '例行巡检'
  form.result_state = ''
  form.photos = []
  form.plan_date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  formVisible.value = true
}
function openEdit(row) {
  Object.keys(form).forEach(k => delete form[k])
  Object.assign(form, JSON.parse(JSON.stringify(row)))
  form.photos = Array.isArray(row.photos) ? [...row.photos] : []
  formVisible.value = true
}
function openDetail(row) {
  Object.keys(detail).forEach(k => delete detail[k])
  Object.assign(detail, row)
  detailVisible.value = true
}

async function onSave() {
  if (!form.server_name) return ElMessage.warning('请填写服务器名称')
  if (!form.plan_content) return ElMessage.warning('请填写维护计划')
  saving.value = true
  try {
    // 只提交 /uploads/ 下的地址，过滤掉本地 blob 预览地址
    const payload = { ...form, photos: (form.photos || []).filter(u => u.startsWith('/uploads/')) }
    if (form.maint_id) await R.updateMaintenance(form.maint_id, payload)
    else await R.createMaintenance(payload)
    ElMessage.success('已保存')
    formVisible.value = false
    load(); loadSummary()
  } catch (e) { ElMessage.error(e.message) } finally { saving.value = false }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`确认删除「${row.server_name}」的这条维护记录？照片归档也会一并解除关联。`, '提示', { type: 'warning' })
  } catch { return }
  try {
    await R.deleteMaintenance(row.maint_id)
    ElMessage.success('已删除')
    load(); loadSummary()
  } catch (e) { ElMessage.error(e.message) }
}

// ---- 照片上传（复用巡检页的「压缩后上传」方案：手机原图 5MB 压到 200KB 左右）----
// 大于 300KB 的图压缩到 1600px / JPEG；非图片或压不动直接放行
function compress(file, max = 1600, quality = 0.82) {
  return new Promise(resolve => {
    if (!/^image\//.test(file.type) || file.size < 300 * 1024) return resolve(file)
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const cv = document.createElement('canvas')
      cv.width = Math.round(img.width * scale)
      cv.height = Math.round(img.height * scale)
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
      cv.toBlob(b => {
        URL.revokeObjectURL(url)
        resolve(b ? new File([b], 'photo.jpg', { type: 'image/jpeg' }) : file)
      }, 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

// 隐藏 input 选文件：比 el-upload 可控，压缩逻辑插得上手
function pickPhoto() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.onchange = () => { const fs = [...input.files]; if (fs.length) uploadPhotos(fs) }
  input.click()
}

async function uploadPhotos(files) {
  uploading.value = true
  try {
    const room = 9 - form.photos.length
    const pick = files.slice(0, room)
    const compressed = await Promise.all(pick.map(f => compress(f)))
    const fd = new FormData()
    compressed.forEach(f => fd.append('files', f, f.name || 'photo.jpg'))
    const urls = await R.maintenanceUpload(fd)
    if (urls && urls.length) form.photos.push(...urls)
    else ElMessage.error('上传失败，请重试')
  } catch (e) {
    ElMessage.error(e.message || '上传失败，请检查网络')
  } finally { uploading.value = false }
}

function previewPhoto(urls, index) {
  viewer.urls = urls.filter(u => u.startsWith('/uploads/') || u.startsWith('blob:'))
  viewer.index = Math.max(0, viewer.urls.indexOf(urls[index]))
  viewer.visible = true
}

onMounted(async () => {
  try {
    const m = await R.maintenanceMeta()
    meta.types = m.types || []
    meta.states = m.states || []
  } catch { /* 枚举取不到时下拉为空，不阻塞列表 */ }
  load()
  loadSummary()
})
</script>

<style scoped>
@media (min-width: 1200px) { .it-page { padding-right: 272px; } }
.page-head { margin-bottom: 14px; }
.page-sub { font-size: 12px; color: var(--it-text-sub); margin-top: 4px; }
.head-actions { display: flex; gap: 10px; }
.card-row { margin-bottom: 14px; }
.sum-card { background: var(--it-card); border: 1px solid var(--it-border); border-radius: 10px; padding: 12px 16px; cursor: pointer; }
.sum-card:hover { border-color: var(--it-primary); }
.sum-card .s-name { font-size: 12px; color: var(--it-text-sub); }
.sum-card .s-val { font-size: 22px; font-weight: 700; color: var(--it-primary); margin-top: 2px; }
.sum-card.done .s-val { color: var(--it-success, #67c23a); }
.sum-card.processing .s-val { color: var(--it-warning, #e6a23c); }
.pager { display: flex; justify-content: flex-end; padding-top: 12px; }
.muted { color: var(--it-text-sub); font-size: 12px; }

/* 三段合一列 */
.tri-cell { line-height: 1.6; }
.tri-line { display: flex; gap: 6px; align-items: flex-start; font-size: 12px; color: #4a5266; }
.tri-line span:last-child { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.tri-tag { flex-shrink: 0; font-size: 11px; padding: 0 5px; border-radius: 4px; line-height: 18px; background: #eef1f7; color: #6b7392; }
.tri-tag.plan { background: #e8f1fd; color: #2f6fd6; }
.tri-tag.exec { background: #fdf3e6; color: #c07b1d; }
.tri-tag.res { background: #e9f7ee; color: #2f9e57; }

/* 照片缩略图 */
.photo-row { display: flex; flex-wrap: wrap; gap: 8px; }
.thumb { position: relative; width: 74px; height: 74px; border-radius: 8px; overflow: hidden; border: 1px solid var(--it-border); }
.thumb img { width: 100%; height: 100%; object-fit: cover; cursor: zoom-in; }
.thumb-del { position: absolute; top: 2px; right: 2px; color: #fff; background: rgba(0,0,0,.45); border-radius: 50%; cursor: pointer; font-size: 16px; }
.thumb.add { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; color: var(--it-text-sub); cursor: pointer; border-style: dashed; background: #fafbfd; }
.thumb.add:hover { color: var(--it-primary); border-color: var(--it-primary); }
.thumb.add span { font-size: 11px; }
.photo-tip { font-size: 11px; color: var(--it-text-sub); margin-top: 6px; }
.photo-icon { cursor: pointer; font-size: 16px; color: var(--it-primary); }

/* 详情弹窗 */
.d-block { margin-bottom: 12px; }
.d-title { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.d-text { font-size: 13px; color: #4a5266; line-height: 1.7; }
.d-text.pre { white-space: pre-wrap; }
.d-photo { width: 100px; height: 100px; object-fit: cover; border-radius: 8px; border: 1px solid var(--it-border); cursor: zoom-in; }
</style>
