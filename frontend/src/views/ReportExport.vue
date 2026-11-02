<!--
  报表导出 —— IT 运维工单台账与日报自动管理系统
  按条件导出工单与统计报表

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.1
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page">
    <h3 class="it-section-title">报表导出</h3>

    <div class="it-card">
      <!-- 列顺序固定沿用原 Excel 台账：运维同事拿到文件就能接着往下录，不用再对表头 -->
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:16px"
        title="导出字段严格沿用原有 Excel 表格格式：时间、联系人、部门、运维服务内容、应用系统、问题类别、完成时间、处理说明" />

      <!-- 筛选条件全部可留空，留空即不限制；部门/系统/类别都从字典取，避免手填出同义词 -->
      <el-form :inline="true" :model="filters">
        <el-form-item label="时间段">
          <el-date-picker v-model="filters.range" type="daterange" value-format="YYYY-MM-DD" range-separator="~" start-placeholder="开始" end-placeholder="结束" />
        </el-form-item>
        <el-form-item label="部门">
          <el-select v-model="filters.dept" placeholder="全部" clearable style="width:130px">
            <el-option v-for="d in dicts.dept" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
          </el-select>
        </el-form-item>
        <el-form-item label="应用系统">
          <el-select v-model="filters.app_system" placeholder="全部" clearable style="width:140px">
            <el-option v-for="d in dicts.app_system" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
          </el-select>
        </el-form-item>
        <el-form-item label="问题类别">
          <el-select v-model="filters.problem_type" placeholder="全部" clearable style="width:140px">
            <el-option v-for="d in dicts.problem_type" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部" clearable style="width:120px">
            <el-option label="待接单" value="pending" />
            <el-option label="处理中" value="processing" />
            <el-option label="已完成" value="done" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <!-- 先数条数再导出：条件写错时能立刻发现，不至于拉出几万行才发现要重来 -->
          <el-button type="primary" @click="preview"><el-icon><Search /></el-icon> 预览数量</el-button>
          <el-button type="success" @click="onExport"><el-icon><Download /></el-icon> 导出 Excel</el-button>
        </el-form-item>
      </el-form>

      <el-divider />
      <!-- 条数独立展示：导出前先看这里，0 条说明筛选条件写反了 -->
      <div class="count">当前筛选条件下工单数量：<b>{{ count }}</b> 条</div>
    </div>

    <!-- 历史工单导入 -->
    <!-- 老台账一次性搬进来用，不逐条手录；导入归属当前登录账号，所以数据隔离跟普通建单一致 -->
    <div class="it-card" style="margin-top:14px">
      <h4 class="it-section-title">导入历史工单</h4>
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px"
        title="支持沿用原 Excel 表格直接导入：具体时间、联系人、部门、运维服务内容、应用系统、问题类别、服务完成时间、处理说明。仅支持 .xlsx（旧 .xls 请先另存为 .xlsx）；导入的数据归属当前登录账号，有完成时间的自动标记为已完成。" />
      <!-- 用 http-request 接管上传，为了自己校验扩展名并自定义失败明细回显，不用组件默认请求 -->
      <el-upload
        drag
        accept=".xlsx"
        :show-file-list="false"
        :http-request="onImport"
        :disabled="importing"
      >
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">{{ importing ? '正在导入…' : '将历史工单 Excel 拖到此处，或点击选择文件' }}</div>
        <template #tip>
          <div class="el-upload__tip">导入完成后可在「工单记录管理」中查看</div>
        </template>
      </el-upload>
      <!-- 导入结果：只要有一条失败就转 warning，并把行号+原因列出来，方便回 Excel 改完再导 -->
      <div v-if="importResult" class="import-result">
        <el-alert
          :type="importResult.failed.length ? 'warning' : 'success'"
          :closable="false"
          show-icon
          :title="`成功导入 ${importResult.inserted} 条${importResult.failed.length ? '，失败 ' + importResult.failed.length + ' 条' : ''}`"
        />
        <el-table v-if="importResult.failed.length" :data="importResult.failed" size="small" style="margin-top:10px" max-height="220">
          <el-table-column prop="row" label="行号" width="80" />
          <el-table-column prop="reason" label="失败原因" />
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Search, Download, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import R from '../api'

// 字典分三类缓存在同一个对象里，模板按 dicts.xxx 直接遍历，省掉三份独立的 ref
const dicts = reactive({ dept: [], app_system: [], problem_type: [] })
// 筛选条件。range 是日期数组 [start, end]，其余是字典标签的字符串
const filters = reactive({ range: [], dept: '', app_system: '', problem_type: '', status: '' })
// 预览到的条数，仅用于导出前确认
const count = ref(0)

// 拉字典：传 false 表示取启用项即可，停用的旧值不该再出现在筛选里
async function loadDicts() {
  const data = await R.getDicts(false)
  dicts.dept = data.dept; dicts.app_system = data.app_system; dicts.problem_type = data.problem_type
}
// 只把有值的条件拼进参数。后端是按真值判断的（空串等于没选），
// 所以留空的筛选项不必下发：参数干净，出问题时看请求就能还原当时的口径。
function buildParams() {
  const p = {}
  if (filters.range && filters.range.length === 2) { p.start = filters.range[0]; p.end = filters.range[1] }
  if (filters.dept) p.dept = filters.dept
  if (filters.app_system) p.app_system = filters.app_system
  if (filters.problem_type) p.problem_type = filters.problem_type
  if (filters.status) p.status = filters.status
  return p
}
// 预览条数：复用列表接口，只取 length 不渲染，口径与导出的过滤条件完全一致
async function preview() {
  try { const rows = await R.listTickets(buildParams()); count.value = rows.length; ElMessage.success('已统计') } catch (e) { ElMessage.error(e.message) }
}
// 用临时 <a download> 触发下载，最后必须 revokeObjectURL，
// 否则连续导出几次会在内存里堆着几个完整的 xlsx blob。
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
// 导出 Excel。接口返回的是二进制流，交给 downloadBlob 落地，不能按 JSON 解析；
// 文件名带导出日期，同一天导多次也能在下载目录里区分开。
async function onExport() {
  try {
    const blob = await R.exportTicketsBlob(buildParams())
    const d = new Date()
    const p = n => String(n).padStart(2, '0')
    const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    downloadBlob(blob, `it_tickets_${day}.xlsx`)
    ElMessage.success('导出成功')
  } catch (e) { ElMessage.error('导出失败：' + e.message) }
}

// 导入历史工单
const importing = ref(false)
// 导入结果：{ inserted, failed: [{ row, reason }] }，failed 非空时表格列出明细
const importResult = ref(null)
// 自定义上传。前端先按扩展名挡一道（accept 只是提示，用户可以强行选别的文件），
// 后端还会再校验一次内容，两层都过不了就不会写库。
async function onImport({ file }) {
  const isXlsx = /\.xlsx$/i.test(file.name)
  if (!isXlsx) { ElMessage.error('仅支持 .xlsx 文件，旧 .xls 请先在 Excel 中另存为 .xlsx'); return }
  importing.value = true
  importResult.value = null
  try {
    const data = await R.importTickets(file)
    importResult.value = data
    ElMessage.success((data && data.__message) || '导入完成')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    importing.value = false
  }
}

// 进页面先把字典备好，筛选下拉才有选项可选
onMounted(loadDicts)
</script>

<style scoped>
.count { font-size: 14px; color: #4a5266; }
.count b { color: var(--it-primary); font-size: 18px; }
.import-result { margin-top: 12px; }
</style>
