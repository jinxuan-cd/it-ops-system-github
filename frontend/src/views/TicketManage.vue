<!--
  工单管理 —— IT 运维工单台账与日报自动管理系统
  工单列表检索、抢单派单、完成、批量操作与导出

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.1
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page ticket-page">
    <h3 class="it-section-title">工单记录管理</h3>

    <!-- 筛选
         范围三档：mine=只看指派给自己的；all=全员（仅管理员/能看全部的人可见）；pool=待接单池 -->
    <div class="it-card" style="margin-bottom:14px">
      <el-form :inline="true" :model="filters" size="small">
        <el-form-item label="范围">
          <el-radio-group v-model="filters.scope" size="small" @change="search">
            <el-radio-button value="mine">我的工单</el-radio-button>
            <el-radio-button v-if="userStore.canViewAll || userStore.isService" value="all">全部员工</el-radio-button>
            <el-radio-button value="pool">{{ poolLabel }}<template v-if="poolCount"> ({{ poolCount }})</template></el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="时间段">
          <el-date-picker v-model="filters.range" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" style="width:236px" />
        </el-form-item>
        <el-form-item v-show="showMore" label="部门">
          <el-select v-model="filters.dept" placeholder="全部" clearable style="width:130px">
            <el-option v-for="d in dicts.dept" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
          </el-select>
        </el-form-item>
        <el-form-item v-show="showMore" label="应用系统">
          <el-select v-model="filters.app_system" placeholder="全部" clearable style="width:140px">
            <el-option v-for="d in dicts.app_system" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
          </el-select>
        </el-form-item>
        <el-form-item v-show="showMore" label="问题类别">
          <el-select v-model="filters.problem_type" placeholder="全部" clearable style="width:140px">
            <el-option v-for="d in dicts.problem_type" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
          </el-select>
        </el-form-item>
        <el-form-item v-show="showMore" label="状态">
          <el-select v-model="filters.status" placeholder="全部" clearable style="width:110px">
            <el-option label="待接单" value="pending" />
            <el-option label="处理中" value="processing" />
            <el-option label="已完成" value="done" />
          </el-select>
        </el-form-item>
        <el-form-item v-show="showMore" label="优先级">
          <el-select v-model="filters.priority" placeholder="全部" clearable style="width:100px">
            <el-option label="紧急" value="urgent" />
            <el-option label="高" value="high" />
            <el-option label="普通" value="normal" />
            <el-option label="低" value="low" />
          </el-select>
        </el-form-item>
        <el-form-item v-show="showMore" label="时效">
          <el-select v-model="filters.sla" placeholder="全部" clearable style="width:120px">
            <el-option label="仅看超时未完成" value="overdue" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-input v-model="filters.keyword" placeholder="联系人/内容搜索" clearable style="width:150px" />
        </el-form-item>
        <!-- 关键词需要点「查询」才生效（避免每敲一个字就请求一次）；导出走当前筛选条件 -->
        <el-form-item>
          <el-button type="primary" @click="search"><el-icon><Search /></el-icon> 查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
          <el-button link type="primary" @click="showMore = !showMore">
            {{ showMore ? '收起筛选' : '更多筛选' }}
            <el-icon><ArrowUp v-if="showMore" /><ArrowDown v-else /></el-icon>
          </el-button>
          <el-button type="success" @click="onExport"><el-icon><Download /></el-icon> 导出 Excel</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 列表 -->
    <div ref="cardRef" class="it-card ticket-table-card">
      <!-- 批量操作条（与表格同卡片，省出一屏高度）
           批量改状态/删除受 canWrite 限制（审计员只读），导出不限；
           选中项跨页保留（表格 reserve-selection），但改筛选条件后会被清空 -->
      <div class="batch-bar">
        <div class="batch-left">
          <span class="batch-count">已选 <b>{{ selected.length }}</b> 条</span>
          <el-button size="small" text @click="selectAll" :disabled="!rows.length">全选本页</el-button>
          <el-button size="small" text @click="clearSelection" :disabled="!selected.length">清空选择</el-button>
        </div>
        <div class="batch-right">
          <el-button size="small" type="success" :disabled="!selected.length || !canWrite" @click="onBatchComplete">
            <el-icon><Select /></el-icon> 标记完成
          </el-button>
          <el-button size="small" :disabled="!selected.length" @click="onBatchExport">
            <el-icon><Download /></el-icon> 导出选中
          </el-button>
          <el-button size="small" type="danger" :disabled="!selected.length || !canWrite" @click="onBatchDelete">
            <el-icon><Delete /></el-icon> 批量删除
          </el-button>
        </div>
      </div>

      <!-- 移动端：卡片列表（表格在窄屏只能横向滚动，关键信息看不全） -->
      <div v-if="isMobile" class="m-list" v-loading="loading">
        <div v-for="row in rows" :key="row.ticket_id" class="m-item" :class="{ picked: isPicked(row) }">
          <div class="m-head">
            <el-checkbox :model-value="isPicked(row)" @change="v => pick(row, v)" />
            <span class="m-time">{{ row.happen_time }}</span>
            <el-tag size="small" :type="stMeta(row.status).type">{{ stMeta(row.status).label }}</el-tag>
          </div>
          <div class="m-title">{{ row.service_content || '（未填写服务内容）' }}</div>
          <div class="m-meta">
            <span v-if="row.dept">{{ row.dept }}</span>
            <span v-if="row.contact">{{ row.contact }}</span>
            <span v-if="row.app_system">{{ row.app_system }}</span>
            <span v-if="row.problem_type">{{ row.problem_type }}</span>
          </div>
          <div class="m-tags">
            <el-tag size="small" :type="priType(row.priority)" effect="plain">{{ priLabel(row.priority) }}</el-tag>
            <el-tag size="small" :type="slaType(row)">{{ slaText(row) }}</el-tag>
            <span v-if="row.assignee_name" class="m-assignee">负责人 {{ row.assignee_name }}</span>
          </div>
          <div class="m-ops">
            <!-- 只在 pending 时给「接取」；已指派的单子按钮变成「转单」，走同一个派单弹窗 -->
            <el-button size="small" text type="primary" @click="openDetail(row)">详情</el-button>
            <el-button v-if="canWrite && row.status === 'pending'" size="small" text type="success" @click="onClaim(row)">接取</el-button>
            <el-button v-if="canWrite" size="small" text type="primary" @click="openAssign(row)">{{ row.assignee_id ? '转单' : '派单' }}</el-button>
            <el-button v-if="canWrite" size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="canWrite" size="small" text type="danger" @click="onDelete(row)">删除</el-button>
          </div>
        </div>
        <el-empty v-if="!rows.length && !loading" description="暂无工单" :image-size="70" />
      </div>

      <el-table v-else ref="tableRef" :data="rows" stripe border v-loading="loading" :height="tableH"
        row-key="ticket_id" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="44" fixed="left" reserve-selection />
        <el-table-column prop="happen_time" label="时间" width="158" />
        <el-table-column label="状态" width="88">
          <template #default="{ row }">
            <el-tag :type="stMeta(row.status).type" size="small">{{ stMeta(row.status).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="contact" label="联系人" width="88" />
        <el-table-column prop="dept" label="部门" width="96" show-overflow-tooltip />
        <el-table-column prop="service_content" label="运维服务内容" min-width="220" show-overflow-tooltip />
        <el-table-column prop="app_system" label="应用系统" width="104" show-overflow-tooltip />
        <el-table-column prop="problem_type" label="问题类别" width="96" show-overflow-tooltip />
        <el-table-column label="优先级 / 时效" width="150">
          <template #default="{ row }">
            <div class="pri-sla">
              <el-tag size="small" :type="priType(row.priority)" effect="plain">{{ priLabel(row.priority) }}</el-tag>
              <el-tooltip :content="slaTip(row)" placement="top">
                <el-tag size="small" :type="slaType(row)" effect="light">{{ slaText(row) }}</el-tag>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="负责人" width="84">
          <template #default="{ row }">
            <span v-if="row.assignee_name">{{ row.assignee_name }}</span>
            <el-tag v-else-if="row.status === 'pending'" size="small" type="warning" effect="plain">{{ poolLabel }}</el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="finish_time" label="完成时间" width="158" />
        <el-table-column v-if="filters.scope === 'all'" prop="real_name" label="提单人" width="86" />
        <el-table-column label="操作" width="212" fixed="right" class-name="col-ops">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openDetail(row)">详情</el-button>
            <el-button v-if="canWrite && row.status === 'pending'" size="small" text type="success" @click="onClaim(row)">接取</el-button>
            <el-button v-if="canWrite" size="small" text type="primary" @click="openAssign(row)">{{ row.assignee_id ? '转单' : '派单' }}</el-button>
            <el-button v-if="canWrite" size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="canWrite" size="small" text type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页：每页条数可调，翻页才向后端请求下一页 -->
      <div class="pager">
        <el-pagination
          v-model:current-page="pager.page"
          v-model:page-size="pager.size"
          :page-sizes="[10, 20, 50, 100]"
          :total="pager.total"
          :layout="isMobile ? 'prev, pager, next' : 'total, sizes, prev, pager, next, jumper'"
          :pager-count="isMobile ? 5 : 7"
          :small="isMobile"
          background
          @size-change="onSizeChange"
          @current-change="onPageChange" />
      </div>
    </div>

    <!-- 详情 -->
    <el-dialog v-model="detailVisible" title="工单详情" width="640px">
      <el-descriptions :column="2" border v-if="detail">
        <el-descriptions-item label="发生时间">{{ detail.happen_time }}</el-descriptions-item>
        <el-descriptions-item label="联系人">{{ detail.contact }}</el-descriptions-item>
        <el-descriptions-item label="部门">{{ detail.dept }}</el-descriptions-item>
        <el-descriptions-item label="应用系统">{{ detail.app_system }}</el-descriptions-item>
        <el-descriptions-item label="问题类别">{{ detail.problem_type }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag size="small" :type="stMeta(detail.status).type">{{ stMeta(detail.status).label }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="负责人">{{ detail.assignee_name || '未分配' }}</el-descriptions-item>
        <el-descriptions-item label="指派时间">{{ detail.assign_time || '—' }}</el-descriptions-item>
        <el-descriptions-item label="完成时间" :span="2">{{ detail.finish_time || '—' }}</el-descriptions-item>
        <el-descriptions-item label="服务内容" :span="2">{{ detail.service_content }}</el-descriptions-item>
        <el-descriptions-item label="处理说明" :span="2">{{ detail.handle_desc }}</el-descriptions-item>
        <el-descriptions-item label="附件" :span="2">
          <div v-if="detail.attachment && detail.attachment.length" class="att-wrap">
            <template v-for="(a, i) in detail.attachment" :key="i">
              <el-image
                v-if="isImage(a)"
                :src="a"
                :preview-src-list="detail.attachment.filter(isImage)"
                :initial-index="detail.attachment.filter(isImage).indexOf(a)"
                fit="cover"
                class="att-thumb"
                preview-teleported
                hide-on-click-modal />
              <a v-else :href="a" target="_blank" class="att-link">附件{{ i + 1 }}</a>
            </template>
          </div>
          <span v-else>无</span>
        </el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <div class="detail-foot">
          <div class="df-left">
            <!-- 接取：仅「待接单且未指派且本账号能抢单」；派单/转单：未完成时（已指派的按钮文案变转单）；
                 退回池子：已指派、未完成（派单权限或本人负责的单子） -->
            <el-button v-if="detailCanClaim" type="success" :loading="claiming" @click="onClaim(detail)">接取这张工单</el-button>
            <el-button v-if="canWrite && detail && detail.status !== 'done'" @click="openAssign(detail)">
              {{ detail.assignee_id ? '转单' : '派单' }}
            </el-button>
            <el-button v-if="detailCanRelease" type="warning" plain @click="onRelease(detail)">退回待接单池</el-button>
          </div>
          <el-button @click="detailVisible = false">关闭</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 编辑 -->
    <el-dialog v-model="editVisible" title="编辑工单" width="640px">
      <el-form :model="editForm" label-width="90px">
        <el-form-item label="发生时间"><el-date-picker v-model="editForm.happen_time" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" style="width:100%" /></el-form-item>
        <el-form-item label="联系人"><el-input v-model="editForm.contact" /></el-form-item>
        <el-form-item label="部门"><el-select v-model="editForm.dept" filterable style="width:100%"><el-option v-for="d in dicts.dept" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" /></el-select></el-form-item>
        <el-form-item label="应用系统"><el-select v-model="editForm.app_system" filterable style="width:100%"><el-option v-for="d in dicts.app_system" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" /></el-select></el-form-item>
        <el-form-item label="问题类别"><el-select v-model="editForm.problem_type" filterable style="width:100%"><el-option v-for="d in dicts.problem_type" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" /></el-select></el-form-item>
        <el-form-item label="服务内容"><el-input v-model="editForm.service_content" type="textarea" :rows="2" /></el-form-item>
        <!-- 完成时间与状态双向联动：
             选「已完成」自动补当前时间；清空完成时间则状态回落为处理中（见 onEditStatusChange / onEditFinishChange） -->
        <el-form-item label="完成时间">
          <el-date-picker v-model="editForm.finish_time" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" style="width:100%" @change="onEditFinishChange" />
        </el-form-item>
        <el-form-item label="处理说明"><el-input v-model="editForm.handle_desc" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="优先级">
          <el-radio-group v-model="editForm.priority">
            <el-radio value="urgent">紧急</el-radio><el-radio value="high">高</el-radio>
            <el-radio value="normal">普通</el-radio><el-radio value="low">低</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="状态">
          <!-- 这里只放开处理中/已完成：把单子改回待接单走详情里的「退回待接单池」，避免绕过通知逻辑 -->
          <el-radio-group v-model="editForm.status" @change="onEditStatusChange">
            <el-radio value="processing">处理中</el-radio><el-radio value="done">已完成</el-radio>
          </el-radio-group>
          <span class="status-hint">{{ editForm.status === 'done' ? '保存后按完成时间计入完成量' : '保存后清空完成时间' }}</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSaveEdit">保存</el-button>
      </template>
    </el-dialog>
    <!-- 派单 / 转单
         同一个弹窗：工单原本没负责人叫「派单」，已有负责人叫「转单」；派单后待接单直接转处理中 -->
    <el-dialog v-model="assignVisible" :title="assignForm.isTransfer ? '转单给其他工程师' : '派单给工程师'" width="440px">
      <el-form label-width="80px">
        <el-form-item label="工单">
          <div class="assign-ticket">{{ (assignForm.content || '').slice(0, 60) }}</div>
        </el-form-item>
        <el-form-item label="指派给">
          <el-select v-model="assignForm.assignee_id" filterable placeholder="选择工程师" style="width:100%">
            <el-option v-for="u in staff" :key="u.user_id" :label="`${u.real_name || u.username}${u.role === 'admin' ? '（管理员）' : ''}${u.role === 'service' ? '（服务台）' : ''}`" :value="u.user_id" />
          </el-select>
        </el-form-item>
        <el-alert type="info" :closable="false" show-icon
          title="对方会立即收到待办与实时提醒，并记为已响应（用于 SLA）；待接单的工单会直接转为处理中，其他人不能再接。" />
      </el-form>
      <template #footer>
        <el-button @click="assignVisible = false">取消</el-button>
        <el-button type="primary" :loading="assigning" @click="onAssign">确认{{ assignForm.isTransfer ? '转单' : '派单' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search, Download, Delete, Select, ArrowUp, ArrowDown } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import R from '../api'
import { useUserStore } from '../store/user'
import { workflow, loadWorkflow } from '../utils/workflow'

const userStore = useUserStore()
const route = useRoute()
const router = useRouter()
// 列表数据与加载态：数据始终来自后端分页，前端不做二次切片
const rows = ref([])
const loading = ref(false)
// 部门 / 应用系统 / 问题类别三本基础字典，筛选项和编辑弹窗共用
const dicts = reactive({ dept: [], app_system: [], problem_type: [] })
const filters = reactive({ scope: 'mine', range: [], dept: '', app_system: '', problem_type: '', status: '', priority: '', sla: '', keyword: '' })
// 高级筛选项默认收起，给列表留出高度
const showMore = ref(false)

// 待接单池：不开服务台时叫「待接单」，开了服务台叫「待指派」
const poolCount = ref(0)
const claiming = ref(false)
const poolLabel = computed(() => (workflow.service_desk_enable ? '待指派' : '待接单'))

// 状态文案与颜色（待接单 / 处理中 / 已完成）
function stMeta(s) {
  if (s === 'done') return { label: '已完成', type: 'success' }
  if (s === 'pending') return { label: '待接单', type: 'info' }
  return { label: '处理中', type: 'warning' }
}

// 审计员只读：不显示会写数据的按钮
const canWrite = computed(() => !userStore.isAuditor)

const tableRef = ref(null)
// selected 与表格勾选保持同步（移动端卡片列表则手动 pick），批量操作都以它为准
const selected = ref([])
// 服务端分页：默认每页 20 条，翻页/改每页条数才重新请求，不再一次性拉全量
const pager = reactive({ page: 1, size: window.innerWidth <= 820 ? 10 : 20, total: 0 })
// 表格高度随窗口自适应，让列表区尽量占满页面
const cardRef = ref(null)
const tableH = ref(420)
let ro = null
// 按容器实际高度算出表格高度：固定高度会导致页面出现两条滚动条
function measure() {
  if (!cardRef.value) return
  const h = cardRef.value.clientHeight
  if (h <= 0) return
  const bar = cardRef.value.querySelector('.batch-bar')
  const pager = cardRef.value.querySelector('.pager')
  const barH = bar ? bar.offsetHeight + 8 : 0
  const pagerH = pager ? pager.offsetHeight + 10 : 54
  // 减去卡片上下内边距 + 批量条 + 分页条 + 边框，剩下的全部给表格
  tableH.value = Math.max(240, h - 34 - pagerH - barH)
}
// 窄屏用卡片列表代替表格（表格只能横向滚动，关键字段看不全）
const isMobile = ref(window.innerWidth <= 820)
function onResize() { isMobile.value = window.innerWidth <= 820; measure() }

function onSelectionChange(list) { selected.value = list }
function isPicked(row) { return selected.value.some(r => r.ticket_id === row.ticket_id) }
// 移动端没有 el-table 的 selection 列，自己维护勾选；用新数组赋值而不是 push，保证响应式更新
function pick(row, on) {
  if (on) { if (!isPicked(row)) selected.value = [...selected.value, row] }
  else selected.value = selected.value.filter(r => r.ticket_id !== row.ticket_id)
}
// 「全选本页」只选当前页，不跨页累加：跨页全选在服务端分页下容易误删
function selectAll() {
  if (isMobile.value) { selected.value = rows.value.slice(); return }
  if (tableRef.value) rows.value.forEach(r => tableRef.value.toggleRowSelection(r, true))
}
function clearSelection() {
  if (tableRef.value) tableRef.value.clearSelection()
  selected.value = []
}

// 公共查询参数（管理员/审计员选“全部员工”时带 all=1；待接单池走 pool=1）
function baseParams() {
  const p = {}
  if (filters.scope === 'all') p.all = 1
  if (filters.scope === 'pool') p.pool = 1
  // 服务台账号默认能看全部工单，「我的工单」要显式只看指派给自己的
  if (filters.scope === 'mine' && userStore.isService) p.mine = 1
  if (filters.range && filters.range.length === 2) { p.start = filters.range[0]; p.end = filters.range[1] }
  if (filters.dept) p.dept = filters.dept
  if (filters.app_system) p.app_system = filters.app_system
  if (filters.problem_type) p.problem_type = filters.problem_type
  if (filters.status) p.status = filters.status
  if (filters.priority) p.priority = filters.priority
  if (filters.sla) p.sla = filters.sla
  if (filters.keyword) p.keyword = filters.keyword
  return p
}

const detailVisible = ref(false)
const detail = ref(null)
// 员工扫码报障会上传故障截图，详情里直接显示缩略图，点开可放大
function isImage(u) {
  return /\.(jpg|jpeg|png|webp|gif|bmp|heic)$/i.test(String(u || ''))
}
const editVisible = ref(false)
const saving = ref(false)
const editForm = reactive({})

// 字典失败不影响列表展示（筛选项为空而已），所以静默吞掉异常
async function loadDicts() {
  try {
    const data = await R.getDicts(false)
    dicts.dept = data.dept; dicts.app_system = data.app_system; dicts.problem_type = data.problem_type
  } catch (e) { /* 字典失败不影响列表展示 */ }
}

// 主列表加载：查询条件 + 分页参数一起给后端，响应里的 total 才是筛选后的总数
async function load() {
  loading.value = true
  try {
    const res = await R.listTickets({ ...baseParams(), page: pager.page, page_size: pager.size })
    rows.value = (res && res.list) || []
    pager.total = Number((res && res.total) || 0)
    if (filters.scope === 'pool') poolCount.value = pager.total
    // 筛选后总数变少导致当前页越界 → 自动回到最后一页
    if (!rows.value.length && pager.total > 0 && pager.page > 1) {
      pager.page = Math.max(1, Math.ceil(pager.total / pager.size))
      loading.value = false
      return load()
    }
    // 清空选择，避免删除/导出时命中已不在列表里的旧选中项
    clearSelection()
  } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}

// 条件变化（查询/切范围）回到第一页再查
function search() { pager.page = 1; load() }
function onSizeChange(n) { pager.size = n; pager.page = 1; load() }
function onPageChange(p) { pager.page = p; load() }

// 重置只清筛选项，保留当前范围（「全部员工 / 待接单池」是用户主动选的视角）
function resetFilters() {
  Object.assign(filters, { range: [], dept: '', app_system: '', problem_type: '', status: '', priority: '', sla: '', keyword: '' })
  search()
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
// 本地日期（toISOString 是 UTC，早上 8 点前会算成前一天）
function today() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 导出 Excel：后端按当前筛选条件（不分页）生成 xlsx，前端只负责把 blob 存成文件
async function onExport() {
  try {
    const blob = await R.exportTicketsBlob(baseParams())
    downloadBlob(blob, `it_tickets_${today()}.xlsx`)
    ElMessage.success('导出成功')
  } catch (e) { ElMessage.error('导出失败：' + e.message) }
}

// 批量导出选中的工单
async function onBatchExport() {
  const ids = selected.value.map(r => r.ticket_id)
  if (!ids.length) return
  try {
    const blob = await R.exportTicketsBlob({ ...baseParams(), ids: ids.join(',') })
    downloadBlob(blob, `it_tickets_选中${ids.length}条_${today()}.xlsx`)
    ElMessage.success(`已导出 ${ids.length} 条工单`)
  } catch (e) { ElMessage.error('导出失败：' + e.message) }
}

// 批量删除：点「取消」时 confirm 会 reject，先接住再返回，
// 否则控制台会冒出未捕获的 Promise 异常，也不该继续发删除请求
async function onBatchDelete() {
  const ids = selected.value.map(r => r.ticket_id)
  if (!ids.length) return
  try {
    await ElMessageBox.confirm(
      `确认删除选中的 ${ids.length} 条工单？删除后不可恢复。`,
      '批量删除',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch { return }
  try {
    const res = await R.batchDeleteTickets(ids, { all: filters.scope === 'all' ? 1 : undefined })
    ElMessage.success(`已删除 ${res && res.deleted !== undefined ? res.deleted : ids.length} 条工单`)
    load()
  } catch (e) { ElMessage.error(e.message) }
}

// 批量标记完成：提示语优先用后端返回的 updated（实际生效条数），拿不到才退回勾选数
async function onBatchComplete() {
  const ids = selected.value.map(r => r.ticket_id)
  if (!ids.length) return
  try {
    await ElMessageBox.confirm(`确认把选中的 ${ids.length} 条工单标记为已完成？`, '批量标记完成', { type: 'info' })
  } catch { return }
  try {
    const res = await R.batchCompleteTickets(ids, { all: filters.scope === 'all' ? 1 : undefined })
    ElMessage.success(`已标记完成 ${res && res.updated !== undefined ? res.updated : ids.length} 条工单`)
    load()
  } catch (e) { ElMessage.error(e.message) }
}

// 优先级
const PRI = { urgent: '紧急', high: '高', normal: '普通', low: '低' }
function priLabel(p) { return PRI[p] || '普通' }
function priType(p) { return p === 'urgent' ? 'danger' : p === 'high' ? 'warning' : p === 'low' ? 'info' : 'primary' }

// SLA 时效：state=overdue 的判断放在「已完成」之前，
// 所以超时后才完成的单子仍显示红色「已超时」，不会被成功色盖掉
function slaType(row) {
  if (row.state === 'overdue') return 'danger'
  if (row.status === 'done') return 'success'
  if (row.remain_hours != null && row.remain_hours <= 4) return 'warning'
  return 'info'
}
function slaText(row) {
  if (row.state === 'overdue') return '已超时'
  if (row.status === 'done') return '按时完成'
  if (row.remain_hours != null && row.remain_hours <= 4) return '即将超时'
  return '进行中'
}
// 悬浮提示里补上应响应/应解决的时间点与剩余小时，
// 光看「即将超时」不知道还差多久，值班时需要具体时间
function slaTip(row) {
  const parts = []
  if (row.sla_respond_due) parts.push(`应响应：${String(row.sla_respond_due).slice(5, 16)}`)
  if (row.sla_resolve_due) parts.push(`应解决：${String(row.sla_resolve_due).slice(5, 16)}`)
  if (row.remain_hours != null && row.status !== 'done') parts.push(`剩余 ${row.remain_hours} 小时`)
  return parts.join('　') || '未设置时效策略'
}

// 派单 / 转单
// staff 是可选工程师列表，只在第一次打开弹窗时拉一次（列表变动极少）
const assignVisible = ref(false)
const assigning = ref(false)
const staff = ref([])
// isTransfer 只影响弹窗标题与按钮文案，接口是同一个
const assignForm = reactive({ ticket_id: null, content: '', assignee_id: null, isTransfer: false })

async function loadStaff() {
  if (staff.value.length) return
  try { staff.value = await R.listStaff() } catch { /* ignore */ }
}
// 打开派单弹窗：已有负责人视为转单；同时把详情弹窗关掉，避免两层弹窗叠在一起
function openAssign(row) {
  if (!row) return
  assignForm.ticket_id = row.ticket_id
  assignForm.content = row.service_content
  assignForm.assignee_id = row.assignee_id || null
  assignForm.isTransfer = !!row.assignee_id
  detailVisible.value = false
  assignVisible.value = true
  loadStaff()
}
// 派单成功后广播 todo-changed，让右下角待办面板与被派单同事的待办立即刷新；
// 本地列表与待接单池计数也一起重拉
async function onAssign() {
  if (!assignForm.assignee_id) return ElMessage.warning('请选择要指派的工程师')
  assigning.value = true
  try {
    const r = await R.assignTicket(assignForm.ticket_id, assignForm.assignee_id)
    ElMessage.success(r.assignee_name ? `已指派给 ${r.assignee_name}` : '已指派')
    assignVisible.value = false
    load()
    loadPoolCount()
    window.dispatchEvent(new CustomEvent('itops:todo-changed'))
  } catch (e) { ElMessage.error(e.message) } finally { assigning.value = false }
}

// 接取（抢单）：数据库原子更新，慢一步会提示已被他人接取
async function onClaim(row) {
  if (!row) return
  claiming.value = true
  try {
    await R.claimTicket(row.ticket_id)
    ElMessage.success('接单成功，这张工单由你负责')
    detailVisible.value = false
    load()
    loadPoolCount()
    window.dispatchEvent(new CustomEvent('itops:todo-changed'))
  } catch (e) {
    ElMessage.warning(e.message)
    load()
    loadPoolCount()
  } finally { claiming.value = false }
}

// 退回待接单池（接错了 / 忙不过来又没人可转）
async function onRelease(row) {
  if (!row) return
  try {
    await ElMessageBox.confirm('确认把这张工单退回待接单池？会重新通知所有运维接单。', '退回待接单池', { type: 'warning' })
  } catch { return }
  try {
    await R.releaseTicket(row.ticket_id)
    ElMessage.success('已退回待接单池')
    detailVisible.value = false
    load()
    loadPoolCount()
    window.dispatchEvent(new CustomEvent('itops:todo-changed'))
  } catch (e) { ElMessage.error(e.message) }
}

// 待接单数量角标：只有能抢单的角色才请求，服务台/审计员没必要多打一次接口
async function loadPoolCount() {
  if (!userStore.canClaim) return
  try {
    const list = await R.poolTickets()
    poolCount.value = (list || []).length
  } catch (e) { /* 静默 */ }
}

// 列表行直接复用做详情展示；由 URL 跳进来的才走 openDetailById 拉完整数据
function openDetail(row) {
  detail.value = row
  detailVisible.value = true
}
// 从待办 / 右下角提醒跳过来：&open=<id> 直接打开详情
async function openDetailById(id) {
  try {
    const t = await R.getTicket(id)
    detail.value = t
    detailVisible.value = true
    return t
  } catch (e) {
    ElMessage.error(e.message)
    return null
  }
}
// 详情里「接取」的显示条件：还在池子里（pending 且无负责人）且当前账号有抢单权限
const detailCanClaim = computed(() =>
  !!detail.value && detail.value.status === 'pending' && !detail.value.assignee_id && userStore.canClaim
)
// 退回池子：已完成的不能再退；有派单权限、或本人是负责人/提单人才能操作
const detailCanRelease = computed(() => {
  const d = detail.value
  if (!d || d.status === 'done' || d.status === 'pending') return false
  return userStore.canDispatch ||
    Number(d.assignee_id) === Number(userStore.userId) ||
    Number(d.user_id) === Number(userStore.userId)
})
// 深拷贝一份再编辑：直接引用行对象会让「取消」也把改动写回列表
function openEdit(row) {
  Object.assign(editForm, JSON.parse(JSON.stringify(row)))
  editVisible.value = true
}
// 改成「已完成」时若没填完成时间，自动补当前时间，避免后端兜底后忘了改
function onEditStatusChange(v) {
  if (v === 'done' && !editForm.finish_time) {
    const d = new Date(), p = n => String(n).padStart(2, '0')
    editForm.finish_time = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
  if (v === 'processing') editForm.finish_time = ''
}
// 把「完成时间」删掉 = 其实还没完成（点错了恢复），状态跟着回退，不能还挂着已完成
function onEditFinishChange(v) {
  if (!v && editForm.status === 'done') editForm.status = 'processing'
}

// 编辑保存：只提交这 10 个可编辑字段，负责人/响应时间等状态字段由抢单派单接口维护，
// 避免编辑弹窗把并发操作的结果覆盖回去
async function onSaveEdit() {
  saving.value = true
  try {
    await R.updateTicket(editForm.ticket_id, {
      happen_time: editForm.happen_time, contact: editForm.contact, dept: editForm.dept,
      service_content: editForm.service_content, app_system: editForm.app_system,
      problem_type: editForm.problem_type, finish_time: editForm.finish_time,
      handle_desc: editForm.handle_desc, status: editForm.status, priority: editForm.priority
    })
    ElMessage.success('已保存')
    editVisible.value = false
    load()
    window.dispatchEvent(new CustomEvent('itops:todo-changed'))
  } catch (e) { ElMessage.error(e.message) } finally { saving.value = false }
}
async function onDelete(row) {
  // 点「取消」时 confirm 会 reject，不接住会抛未捕获的 Promise 异常
  try { await ElMessageBox.confirm('确认删除该工单？', '提示', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }) } catch { return }
  try {
    await R.deleteTicket(row.ticket_id)
    ElMessage.success('已删除')
    load()
  } catch (e) { ElMessage.error(e.message) }
}

// 从待办面板 / 右下角接单提醒跳转过来：?open=<id> 直接打开详情，?scope=pool 打开待接单池
function applyScopeFromQuery() {
  const q = route.query
  if (q.scope === 'pool' && filters.scope !== 'pool') { filters.scope = 'pool'; search() }
}
function applyOpenFromQuery() {
  const q = route.query
  if (!q.open) return
  openDetailById(q.open).then(t => {
    if (t && q.action === 'assign') openAssign(t)
  })
  router.replace({ path: '/tickets' })
}
watch(() => route.query.open, (v) => { if (v) applyOpenFromQuery() })
watch(() => route.query.scope, (v) => { if (v === 'pool') applyScopeFromQuery() })

// 实时事件：有新单 / 被接走 / 已完成 → 刷新待接单数量与当前列表
function onRt(e) {
  const type = e.detail && e.detail.type
  if (!type) return
  if (['ticket:new', 'ticket:taken', 'ticket:released', 'ticket:done', 'ticket:mine'].includes(type)) {
    loadPoolCount()
    if (filters.scope === 'pool') load()
  }
}

onMounted(() => {
  // 先按 URL 决定范围，只发起一次查询，避免「全部员工」和「待接单池」两次请求互相覆盖
  if (route.query.scope === 'pool') filters.scope = 'pool'
  else if (userStore.canViewAll || userStore.isService) filters.scope = 'all'
  window.addEventListener('resize', onResize)
  window.addEventListener('itops:rt', onRt)
  loadWorkflow()
  loadDicts(); load(); loadPoolCount()
  if (cardRef.value && window.ResizeObserver) {
    ro = new ResizeObserver(() => measure())
    ro.observe(cardRef.value)
  }
  measure()
  applyOpenFromQuery()
})
onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('itops:rt', onRt)
  if (ro) { ro.disconnect(); ro = null }
})
</script>

<style scoped>
/* 右侧浮动待办面板宽 240px，宽屏下留出安全区，避免批量操作按钮被遮挡 */
@media (min-width: 1200px) {
  .it-page { padding-right: 272px; }
}
.att-link { color: var(--it-primary); margin-right: 8px; }
.att-wrap { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.att-thumb { width: 68px; height: 68px; border-radius: 8px; border: 1px solid var(--it-border); cursor: zoom-in; }
.batch-bar {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 10px; padding: 10px 16px;
}
.batch-left { display: flex; align-items: center; gap: 6px; }
.batch-count { font-size: 13px; color: var(--it-text-sub); margin-right: 4px; }
.batch-count b { color: var(--it-primary); font-size: 15px; margin: 0 2px; }
.batch-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.muted { color: var(--it-text-sub); }
.assign-ticket { font-size: 13px; line-height: 1.6; color: var(--it-text); }
@media (max-width: 900px) {
  .batch-bar { flex-direction: column; align-items: stretch; }
}
/* 移动端卡片列表（窄屏替代表格） */
.m-list { display: flex; flex-direction: column; gap: 10px; }
.m-item { border: 1px solid #ebeef5; border-radius: 8px; padding: 10px 12px; background: #fff; }
.m-item.picked { border-color: #409eff; box-shadow: 0 0 0 1px #409eff inset; }
.m-head { display: flex; align-items: center; gap: 8px; }
.m-head .m-time { font-size: 12px; color: #909399; flex: 1; }
.m-title { margin: 6px 0 4px; font-size: 14px; font-weight: 600; line-height: 1.45; word-break: break-all; }
.m-meta { display: flex; flex-wrap: wrap; gap: 6px; font-size: 12px; }
.m-meta span { background: rgba(125, 125, 125, 0.12); border-radius: 4px; padding: 1px 6px; }
.m-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.m-assignee { font-size: 12px; color: #909399; }
.m-assignee.warn { color: #e6a23c; }
.m-ops { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 2px; margin-top: 6px; border-top: 1px dashed rgba(125,125,125,.25); padding-top: 6px; }

/* 页面撑满可视高度：列表区加上筛选/批量条约占页面 80% 以上 */
.ticket-page { display: flex; flex-direction: column; min-height: calc(100vh - 56px); box-sizing: border-box; }
.ticket-table-card { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.ticket-table-card .el-table { flex: 1 1 auto; }
.pager { flex: 0 0 auto; display: flex; justify-content: flex-end; padding-top: 10px; }
.cell-sub { margin-top: 2px; font-size: 11px; line-height: 1.4; }

@media (max-width: 820px) {
  .ticket-page { min-height: 0; }
  .pager { justify-content: center; }
  /* 顶部已显示页面名，正文标题在小屏隐藏，省出高度 */
  .ticket-page > .it-section-title { display: none; }
}

/* 筛选区紧凑排布，尽量一行放下 */
.ticket-page .el-form--inline .el-form-item { margin-right: 8px; margin-bottom: 6px; }
.ticket-page .batch-bar { padding: 8px 14px; }

/* 批量条并入表格卡片顶部 */
.ticket-table-card .batch-bar { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
  gap: 8px; flex-wrap: wrap; padding: 0 0 8px; margin-bottom: 8px; border-bottom: 1px solid var(--it-border); }
.ticket-table-card .batch-count { font-size: 13px; }

.ticket-table-card :deep(.el-table .cell) { white-space: nowrap; }
@media (max-width: 820px) { .ticket-table-card :deep(.el-table .cell) { white-space: normal; } }

.pri-sla { display: inline-flex; align-items: center; gap: 4px; }
.pri-sla .el-tag { margin: 0; }

/* 操作列按钮紧凑排布，四个按钮一行放得下 */
.ticket-table-card :deep(.col-ops .cell) { display: flex; justify-content: space-between; overflow: visible; }
.ticket-table-card :deep(.col-ops .el-button) { padding: 0 2px; margin-left: 0; }

.status-hint { margin-left: 10px; font-size: 12px; color: var(--it-text-sub); }

/* 详情弹窗底部：左侧接单/派单/退回，右侧关闭 */
.detail-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.df-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
</style>
