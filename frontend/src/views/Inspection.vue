<!--
  巡检管理 —— IT 运维工单台账与日报自动管理系统
  巡检项配置、执行上报与异常转工单

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.2
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page insp-page">
    <div class="it-between page-head">
      <div>
        <h3 class="it-section-title" style="margin:0">机房巡检</h3>
        <div class="page-sub">巡检逐项打卡，支持现场拍照留底；异常项可一键转工单</div>
      </div>
      <div class="head-actions">
        <!-- 今日是否已巡检：一天一条是业务口径，顶部直接给结论，减少重复提交 -->
        <el-tag v-if="todayDone" type="success" size="large" effect="plain">今日已巡检</el-tag>
        <el-tag v-else type="warning" size="large" effect="plain">今日未巡检</el-tag>
        <el-button v-if="canWrite" type="primary" :size="isMobile ? 'default' : 'small'" @click="openCreate">
          <el-icon><Camera /></el-icon> 开始巡检
        </el-button>
      </div>
    </div>

    <!-- 筛选：时间按巡检日期取区间，结果按整单结论，关键词匹配区域与备注 -->
    <div class="it-card filter-card" style="margin-bottom:14px">
      <el-form :inline="!isMobile" :model="filters" size="small">
        <el-form-item label="时间">
          <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" range-separator="至"
            start-placeholder="开始日期" end-placeholder="结束日期" style="width:100%" />
        </el-form-item>
        <el-form-item label="结果">
          <el-select v-model="filters.result" placeholder="全部" clearable style="width:100%">
            <el-option label="全部正常" value="normal" />
            <el-option label="存在异常" value="abnormal" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-input v-model="filters.keyword" placeholder="区域/备注" clearable />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="load"><el-icon><Search /></el-icon> 查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 移动端：卡片列表 -->
    <!-- 卡片只留结论与进度，详情/转工单/删除收进底部操作区，避免误触 -->
    <div v-if="isMobile" class="it-card m-list" v-loading="loading">
      <div v-for="row in rows" :key="row.inspection_id" class="m-item" @click="openDetail(row)">
        <div class="m-head">
          <el-tag size="small" :type="row.result === 'normal' ? 'success' : 'danger'">
            {{ row.result === 'normal' ? '正常' : '有异常' }}
          </el-tag>
          <span class="m-area">{{ row.area || '—' }}</span>
          <span class="m-date">{{ row.insp_date }}</span>
        </div>
        <div class="m-progress">
          <el-progress :percentage="row.item_total ? Math.round(row.item_done / row.item_total * 100) : 0"
            :stroke-width="8" :show-text="false" :color="row.result === 'normal' ? 'var(--it-success)' : 'var(--it-warning)'" />
          <span class="pc-text">{{ row.item_done }}/{{ row.item_total }}</span>
          <span v-if="photoCount(row)" class="m-photo-num"><el-icon><Picture /></el-icon>{{ photoCount(row) }}</span>
        </div>
        <div v-if="row.abnormal_names.length" class="m-bads">
          <el-tag v-for="n in row.abnormal_names" :key="n" size="small" type="warning">{{ n }}</el-tag>
        </div>
        <div class="m-ops" @click.stop>
          <el-button size="small" text type="primary" @click="openDetail(row)">详情</el-button>
          <el-button v-if="canWrite && row.result === 'abnormal' && !row.ticket_id" size="small" text type="warning" @click="toTicket(row)">转工单</el-button>
          <el-tag v-if="row.ticket_id" size="small" type="info">已转单</el-tag>
          <el-button v-if="canWrite" size="small" text type="danger" @click="onDelete(row)">删除</el-button>
        </div>
      </div>
      <el-empty v-if="!rows.length && !loading" description="暂无巡检记录" :image-size="70" />
    </div>

    <!-- 桌面端：表格 -->
    <!-- 桌面端表格：异常项与拍照张数直接展开，减少进详情的次数 -->
    <div v-else class="it-card">
      <el-table :data="rows" stripe border v-loading="loading" :max-height="560" empty-text="暂无巡检记录">
        <el-table-column prop="insp_date" label="巡检日期" width="120" />
        <el-table-column prop="area" label="巡检区域" width="130" />
        <el-table-column label="完成情况" width="150">
          <template #default="{ row }">
            <div class="progress-cell">
              <el-progress :percentage="row.item_total ? Math.round(row.item_done / row.item_total * 100) : 0"
                :stroke-width="10" :show-text="false" :color="row.result === 'normal' ? 'var(--it-success)' : 'var(--it-warning)'" />
              <span class="pc-text">{{ row.item_done }}/{{ row.item_total }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="结果" width="92">
          <template #default="{ row }">
            <el-tag size="small" :type="row.result === 'normal' ? 'success' : 'danger'">
              {{ row.result === 'normal' ? '正常' : '有异常' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="异常项" min-width="180">
          <template #default="{ row }">
            <span v-if="!row.abnormal_names.length" class="muted">—</span>
            <el-tag v-for="n in row.abnormal_names" :key="n" size="small" type="warning" style="margin-right:4px">{{ n }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="拍照" width="86">
          <template #default="{ row }">
            <span v-if="photoCount(row)" class="photo-num"><el-icon><Picture /></el-icon>{{ photoCount(row) }} 张</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
        <el-table-column prop="real_name" label="巡检人" width="92" />
        <el-table-column label="操作" width="184" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openDetail(row)">详情</el-button>
            <el-button v-if="canWrite && row.result === 'abnormal' && !row.ticket_id" size="small" text type="warning" @click="toTicket(row)">转工单</el-button>
            <el-tag v-if="row.ticket_id" size="small" type="info">已转单</el-tag>
            <el-button v-if="canWrite" size="small" text type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 巡检表单 -->
    <!-- 检查项来自模板但可临时增删；未勾选即异常，需拍照项缺图会二次确认 -->
    <el-dialog v-model="formVisible" title="机房巡检" :width="isMobile ? '94vw' : '660px'" :fullscreen="isMobile" top="5vh">
      <el-form label-width="82px" :label-position="isMobile ? 'top' : 'right'">
        <el-row :gutter="12">
          <el-col :xs="24" :sm="12">
            <el-form-item label="巡检日期">
              <el-date-picker v-model="form.insp_date" type="date" value-format="YYYY-MM-DD" style="width:100%" :clearable="false" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item label="巡检区域">
              <el-select v-model="form.area" placeholder="选择巡检区域" filterable allow-create default-first-option style="width:100%">
                <el-option v-for="a in config.areas" :key="a" :label="a" :value="a" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="巡检项">
          <div class="items">
            <div v-for="(it, i) in form.items" :key="i" class="item-row" :class="{ bad: !it.done }">
              <div class="item-line">
                <el-checkbox v-model="it.done" size="large" />
                <div class="item-main">
                  <div class="item-name">
                    {{ it.name }}
                    <el-tag v-if="it.need_photo" size="small" type="danger" effect="plain" style="margin-left:4px">需拍照</el-tag>
                  </div>
                </div>
                <el-button size="small" text type="danger" :icon="Delete" @click="form.items.splice(i, 1)" />
              </div>

              <el-input v-model="it.note" size="small" :placeholder="it.done ? '补充说明（选填）' : '异常说明（选填）'" style="margin-top:6px" />

              <div class="photo-box">
                <div v-for="(u, pi) in it.photos" :key="u" class="thumb">
                  <el-image :src="u" fit="cover" :preview-src-list="it.photos" :initial-index="pi" preview-teleported />
                  <el-icon class="thumb-del" @click="it.photos.splice(pi, 1)"><CircleCloseFilled /></el-icon>
                </div>
                <div v-if="it.photos.length < 4" class="thumb add" :class="{ busy: uploading === it }" @click="pickPhoto(it)">
                  <el-icon v-if="uploading !== it"><Camera /></el-icon>
                  <el-icon v-else class="spin"><Loading /></el-icon>
                  <span>{{ uploading === it ? '上传中' : '拍照' }}</span>
                </div>
              </div>
            </div>
            <el-button size="small" @click="addItem"><el-icon><Plus /></el-icon> 添加检查项</el-button>
          </div>
        </el-form-item>

        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="其他需要说明的情况" />
        </el-form-item>
        <el-alert v-if="abnormalCount" :title="`有 ${abnormalCount} 项未勾选，提交后记录为「存在异常」`" type="warning" :closable="false" show-icon />
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">提交巡检</el-button>
      </template>
    </el-dialog>

    <!-- 详情 -->
    <!-- 只读展示：逐项列出正常/异常、补充说明与现场照片，异常项标红叉 -->
    <el-dialog v-model="detailVisible" title="巡检详情" :width="isMobile ? '94vw' : '560px'" :fullscreen="isMobile">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="日期">{{ detail.insp_date }}</el-descriptions-item>
          <el-descriptions-item label="区域">{{ detail.area }}</el-descriptions-item>
          <el-descriptions-item label="巡检人">{{ detail.real_name || '—' }}</el-descriptions-item>
          <el-descriptions-item label="结果">{{ detail.result === 'normal' ? '全部正常' : '存在异常' }}</el-descriptions-item>
        </el-descriptions>
        <div class="d-list">
          <div v-for="(it, i) in detail.items" :key="i" class="d-item">
            <div class="d-line">
              <el-icon :color="it.done ? 'var(--it-success)' : 'var(--it-danger)'">
                <component :is="it.done ? 'CircleCheck' : 'CircleClose'" />
              </el-icon>
              <span class="d-name">{{ it.name }}</span>
              <span v-if="it.note" class="d-note">{{ it.note }}</span>
            </div>
            <div v-if="it.photos && it.photos.length" class="d-photos">
              <el-image v-for="(u, pi) in it.photos" :key="u" :src="u" fit="cover" class="d-img"
                :preview-src-list="it.photos" :initial-index="pi" preview-teleported />
            </div>
          </div>
        </div>
        <p v-if="detail.remark" class="d-remark">备注：{{ detail.remark }}</p>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { Plus, Search, Delete, Camera, Picture, CircleCloseFilled, Loading } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import R from '../api'
import { useUserStore } from '../store/user'

const userStore = useUserStore()
// 审计员只读：新增、删除、转工单三个入口统一由它控制显隐
const canWrite = computed(() => !userStore.isAuditor)

// 列表数据与 loading 分离，刷新时先留住旧数据，避免表格闪空
const rows = ref([])
const loading = ref(false)
// 时间区间与结果/关键词筛选，最终由 params() 组装成查询参数
const range = ref([])
const filters = reactive({ result: '', keyword: '' })
// 今天是否已有巡检记录，决定顶部显示「今日已巡检」还是「今日未巡检」
const todayDone = ref(false)

// 巡检模板：区域候选 + 检查项定义，来自「巡检设置」，没配时用后端默认项
const config = reactive({ areas: [], items: [] })

// 巡检表单的显隐与提交中状态
const formVisible = ref(false)
const saving = ref(false)
// 一次巡检的临时表单；items 每项含 done/note/photos，提交时整体序列化
const form = reactive({ insp_date: '', area: '', items: [], remark: '' })
// 未勾选即计为异常：实时提示整单结论，避免提交完才发现漏项
const abnormalCount = computed(() => (form.items || []).filter(x => !x.done).length)
// 正在上传的巡检项引用，只在那一个缩略块显示转圈，不锁住整个弹窗
const uploading = ref(null)

// 详情弹窗的数据与显隐
const detailVisible = ref(false)
const detail = ref(null)

// 窄屏用卡片列表（巡检主要在手机上做）
// 断点与其它页面保持一致（820px），保证同一入口在手机上的呈现统一
const isMobile = ref(window.innerWidth <= 820)
function onResize() { isMobile.value = window.innerWidth <= 820 }

// 组装查询参数：能看全员的人才带 all=1，普通账号由后端收口只看本人
function params() {
  const p = {}
  if (userStore.canViewAll) p.all = 1
  if (range.value && range.value.length === 2) { p.start = range.value[0]; p.end = range.value[1] }
  if (filters.result) p.result = filters.result
  if (filters.keyword) p.keyword = filters.keyword
  return p
}

// 汇总一张巡检单下所有检查项的照片总数，列表里只显示这个数
function photoCount(row) {
  return (row.items || []).reduce((n, it) => n + ((it.photos && it.photos.length) || 0), 0)
}

// 先取模板再开表单：区域与检查项都依赖它，取不到就退化成内置默认项
async function loadConfig() {
  try {
    const c = await R.getInspectionConfig()
    config.areas = c.areas || []
    config.items = c.items || []
  } catch { /* 用后端默认值兜底 */ }
}

// 列表与「今日是否已巡检」一起刷新，保证顶部状态和下方记录不打架
async function load() {
  loading.value = true
  try {
    rows.value = await R.listInspections(params())
    const t = await R.inspectionToday()
    todayDone.value = !!t.done
  } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}

// 清空筛选条件后立刻重查，不停留在上一次的筛选结果上
function resetFilters() {
  range.value = []
  filters.result = ''
  filters.keyword = ''
  load()
}

// 本地时区拼 YYYY-MM-DD；用 toISOString 会因 UTC 偏移差一天
function today() {
  const d = new Date(), p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 默认日期取今天、区域取模板第一项，检查项统一重置为未勾选
function openCreate() {
  form.insp_date = today()
  form.area = config.areas[0] || '机房'
  form.remark = ''
  // 巡检项来自设置页配置（没有配置时后端返回默认项）
  form.items = (config.items.length ? config.items : [{ name: '机房温湿度（拍照记录读数）', need_photo: true }])
    .map(x => ({ name: x.name, need_photo: !!x.need_photo, done: false, note: '', photos: [] }))
  formVisible.value = true
}
// 现场发现模板外的项目时临时补一条，只对本次巡检有效，不回写模板
function addItem() {
  form.items.push({ name: '新增检查项', need_photo: false, done: false, note: '', photos: [] })
}

// ===== 拍照：手机点「拍照」直接调起相机（input capture），桌面端选文件 =====
// 桌面端浏览器不认 capture，会退化成选文件，后续上传流程完全一致
function pickPhoto(item) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.setAttribute('capture', 'environment')
  input.style.display = 'none'
  document.body.appendChild(input)
  input.onchange = () => {
    const f = input.files && input.files[0]
    document.body.removeChild(input)
    if (f) uploadPhoto(item, f)
  }
  input.click()
}

// 压缩到 1600px / JPEG，手机原图 5MB 压到 200KB 左右，弱网也能传
// 小于 300KB 的图直接放行，不做无谓的重编码
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

// 压缩后上传，成功后只取第一张 url 塞进该项；失败只提示，不中断其它项的填写
async function uploadPhoto(item, file) {
  uploading.value = item
  try {
    const f = await compress(file)
    const fd = new FormData()
    fd.append('files', f, f.name || 'photo.jpg')
    const urls = await R.inspectionUpload(fd)
    if (urls && urls.length) item.photos.push(urls[0])
    else ElMessage.error('上传失败，请重试')
  } catch (e) {
    ElMessage.error(e.message || '上传失败，请检查网络')
  } finally { uploading.value = null }
}

// 需拍照项缺图只提示不硬拦：现场可能拍不了，允许人工确认后带缺口提交
async function onSave() {
  const missing = form.items.filter(x => x.need_photo && !x.photos.length)
  if (missing.length) {
    try {
      await ElMessageBox.confirm(`「${missing.map(x => x.name).join('、')}」还没有拍照留底，确认直接提交？`, '缺少照片', {
        type: 'warning', confirmButtonText: '仍然提交', cancelButtonText: '回去拍照'
      })
    } catch { return }
  }
  saving.value = true
  try {
    // 只提交 /uploads/ 下的地址：过滤掉本地 blob 预览地址，避免后端存下无效路径
    const payload = {
      insp_date: form.insp_date,
      area: form.area,
      remark: form.remark,
      items: form.items.map(x => ({
        name: x.name, done: !!x.done, note: x.note || '',
        need_photo: !!x.need_photo, photos: (x.photos || []).filter(u => u.startsWith('/uploads/'))
      }))
    }
    const r = await R.createInspection(payload)
    ElMessage.success(r && r.result === 'abnormal' ? '已记录，存在异常项，建议转工单跟进' : '巡检已记录')
    formVisible.value = false
    load()
  } catch (e) { ElMessage.error(e.message) } finally { saving.value = false }
}

// 异常巡检一键转工单：后端按异常项拼出工单内容并回写 ticket_id，转过后按钮自动消失
async function toTicket(row) {
  try {
    await ElMessageBox.confirm('把异常巡检项生成一条工单？', '转工单', { type: 'info' })
  } catch { return }
  try {
    await R.inspectionToTicket(row.inspection_id)
    ElMessage.success('已生成工单，可在工单记录管理中查看')
    load()
  } catch (e) { ElMessage.error(e.message) }
}

// 物理删除：二次确认通过后才调接口，成功后刷新列表
async function onDelete(row) {
  try {
    await ElMessageBox.confirm('确认删除该巡检记录？', '提示', { type: 'warning' })
  } catch { return }
  try {
    await R.deleteInspection(row.inspection_id)
    ElMessage.success('已删除')
    load()
  } catch (e) { ElMessage.error(e.message) }
}

// 详情直接用列表行数据：列表已返回完整 items 与照片，不必再请求一次
function openDetail(row) {
  detail.value = row
  detailVisible.value = true
}

// 先拿模板再拉列表：开表单时要立刻有区域与检查项可选
onMounted(async () => {
  window.addEventListener('resize', onResize)
  await loadConfig()
  load()
})
// resize 监听必须在卸载时摘掉，否则来回切页面会重复绑定
onUnmounted(() => window.removeEventListener('resize', onResize))
</script>

<style scoped>
@media (min-width: 1200px) { .it-page { padding-right: 272px; } }
.page-head { margin-bottom: 14px; }
.page-sub { font-size: 12px; color: var(--it-text-sub); margin-top: 4px; }
.head-actions { display: flex; gap: 10px; align-items: center; }
.progress-cell { display: flex; align-items: center; gap: 8px; }
.progress-cell .el-progress { flex: 1; }
.pc-text { font-size: 12px; color: var(--it-text-sub); }
.muted { color: var(--it-text-sub); }
.photo-num { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; color: var(--it-primary); }

.items { width: 100%; }
.item-row {
  padding: 10px 12px; border: 1px solid var(--it-border); border-radius: 10px; margin-bottom: 10px;
  background: var(--it-card-bg, #fff);
}
.item-row.bad { border-color: var(--it-warning); background: rgba(240, 160, 32, 0.06); }
.item-line { display: flex; align-items: center; gap: 8px; }
.item-main { flex: 1; min-width: 0; }
.item-name { font-size: 14px; line-height: 1.4; word-break: break-all; }

.photo-box { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.thumb {
  position: relative; width: 64px; height: 64px; border-radius: 8px; overflow: hidden;
  border: 1px dashed var(--it-border); background: rgba(125, 125, 125, 0.06);
}
.thumb .el-image { width: 100%; height: 100%; display: block; }
.thumb-del {
  position: absolute; top: 2px; right: 2px; font-size: 16px; color: #fff;
  background: rgba(0, 0, 0, 0.45); border-radius: 50%;
}
.thumb.add {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2px; font-size: 11px; color: var(--it-text-sub); cursor: pointer; border-style: solid;
}
.thumb.add:active { background: rgba(64, 158, 255, 0.12); }
.thumb.add .el-icon { font-size: 18px; }
.thumb.add.busy { pointer-events: none; opacity: 0.7; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.d-list { margin-top: 12px; }
.d-item { padding: 9px 0; border-bottom: 1px dashed var(--it-border); }
.d-line { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.d-name { flex: 1; }
.d-note { color: var(--it-warning); font-size: 12px; }
.d-photos { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 0 24px; }
.d-img { width: 72px; height: 72px; border-radius: 6px; }
.d-remark { font-size: 13px; color: var(--it-text-sub); margin-top: 12px; }

/* 移动端卡片列表 */
.m-list { display: flex; flex-direction: column; gap: 10px; }
.m-item { border: 1px solid var(--it-border); border-radius: 10px; padding: 10px 12px; }
.m-head { display: flex; align-items: center; gap: 8px; }
.m-area { flex: 1; font-size: 14px; font-weight: 600; }
.m-date { font-size: 12px; color: var(--it-text-sub); }
.m-progress { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.m-progress .el-progress { flex: 1; }
.m-photo-num { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; color: var(--it-primary); }
.m-bads { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.m-ops { display: flex; justify-content: flex-end; align-items: center; gap: 2px; margin-top: 6px;
  border-top: 1px dashed var(--it-border); padding-top: 6px; }

@media (max-width: 820px) {
  .page-head { flex-direction: column; align-items: flex-start; gap: 10px; }
  .head-actions { width: 100%; justify-content: space-between; }
  .filter-card :deep(.el-form-item) { margin-right: 0; margin-bottom: 10px; width: 100%; }
  .filter-card :deep(.el-form-item__content) { width: 100%; }
  .item-row { padding: 12px; }
  .thumb, .thumb.add { width: 72px; height: 72px; }
}
</style>
