<!--
  待办管理 —— IT 运维工单台账与日报自动管理系统
  个人待办清单的增删改与完成标记

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.1
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page">
    <div class="it-between" style="margin-bottom:14px">
      <h3 class="it-section-title" style="margin:0">待办任务管理</h3>
      <el-button type="primary" @click="openAdd"><el-icon><Plus /></el-icon> 新增待办</el-button>
    </div>

    <div class="it-card">
      <!-- 四个页签是同一张表的不同筛选口径（today/week/all/done），切页签即重新拉数据。
           注意：today/week/all 都只含未完成，已完成只能从 done 看，所以勾选后行会「消失」不是丢了 -->
      <el-tabs v-model="tab" @tab-change="load">
        <el-tab-pane label="当日待办" name="today" />
        <el-tab-pane label="本周待办" name="week" />
        <el-tab-pane label="全部待办" name="all" />
        <el-tab-pane label="已完成" name="done" />
      </el-tabs>

      <el-table :data="rows" stripe v-loading="loading">
        <!-- 勾选直接写库并重载列表：在「已完成」视图取消勾选，这条会立刻退回未完成列表 -->
        <el-table-column label="完成" width="70">
          <template #default="{ row }">
            <el-checkbox :model-value="!!row.is_finish" @change="(v) => toggle(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="待办标题" min-width="190">
          <!-- 只有挂了工单的待办才可点：手动待办没有详情页可跳，光标不该变成手型 -->
          <template #default="{ row }">
            <span :class="{ 'todo-link': row.ticket_id }" @click="row.ticket_id && goTicket(row)">{{ row.todo_title }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="todo_detail" label="详情" min-width="170" show-overflow-tooltip />
        <el-table-column prop="plan_date" label="计划日期" width="115" />
        <el-table-column label="来源" width="110">
          <!-- 来源标签区分自动生成与手录：日报/待接单工单会自动生成待办，不该被当成手工任务删掉 -->
          <template #default="{ row }">
            <el-tag size="small" :type="sourceMeta(row.source).type">{{ sourceMeta(row.source).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" class-name="col-ops">
          <template #default="{ row }">
            <el-button v-if="row.ticket_id" size="small" text type="primary" @click="goTicket(row)">查看工单</el-button>
            <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑待办' : '新增待办'" width="480px">
      <!-- 新增与编辑共用一个弹窗，靠 editing 标记切换标题和提交分支，减少一套重复表单 -->
      <el-form :model="form" label-width="80px">
        <el-form-item label="标题" required><el-input v-model="form.todo_title" /></el-form-item>
        <el-form-item label="详情"><el-input v-model="form.todo_detail" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="计划日期"><el-date-picker v-model="form.plan_date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import R from '../api'

const router = useRouter()

// 当前页签，决定后端返回哪一批待办；默认「当日待办」，符合每天开工先看今天的习惯
const tab = ref('today')
const rows = ref([])
const loading = ref(false)
const dialogVisible = ref(false)
// 编辑态标记：同一弹窗既要新增也要改，靠它切换标题与提交分支
const editing = ref(false)
const saving = ref(false)
// 弹窗表单。todo_id 为 null 表示新增，有值表示编辑
const form = reactive({ todo_id: null, todo_title: '', todo_detail: '', plan_date: '' })

// 通知右侧浮动待办面板刷新
// 面板是独立组件，两处数据靠这个事件对齐；漏发会导致面板上的角标和本页不一致
function notifyTodoChange() {
  window.dispatchEvent(new Event('itops:todo-changed'))
}

// 来源文案：待接单工单（员工报障自动生成）/ 日报生成 / 手动新增
function sourceMeta(s) {
  if (s === 'daily_report') return { label: '日报生成', type: 'success' }
  if (s === 'ticket') return { label: '待接单工单', type: 'warning' }
  return { label: '手动新增', type: 'info' }
}
// 点待办直接跳到工单详情
function goTicket(row) {
  if (!row.ticket_id) return
  router.push({ path: '/tickets', query: { open: row.ticket_id } })
}

// 按当前页签拉列表。today/week 由后端按 plan_date 口径筛选，
// 前端不自己过滤：避免和后端的「本周从周几算」规则打架。
async function load() {
  loading.value = true
  try { rows.value = await R.listTodos(tab.value) } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}

// 勾选 / 取消勾选完成状态。先请求成功再改本地行数据，
// 失败时列表保持原样，不会出现「界面显示已完成、库里斯还是未完成」的假象。
async function toggle(row, v) {
  try {
    await R.updateTodo(row.todo_id, { is_finish: v ? 1 : 0 })
    row.is_finish = v ? 1 : 0
    notifyTodoChange()
    // 勾选后从当前列表迁移：未完成视图立即移除，已完成视图进入列表
    load()
  } catch (e) { ElMessage.error(e.message) }
}

// 打开新增：必须显式清空 todo_id，否则上一次编辑过的 id 残留会让新增变成覆盖别人那条
function openAdd() {
  editing.value = false
  Object.assign(form, { todo_id: null, todo_title: '', todo_detail: '', plan_date: '' })
  dialogVisible.value = true
}
// 打开编辑：只回填可改字段，来源（source）和工单关联由系统维护，不允许在弹窗里改
function openEdit(row) {
  editing.value = true
  Object.assign(form, { todo_id: row.todo_id, todo_title: row.todo_title, todo_detail: row.todo_detail, plan_date: row.plan_date })
  dialogVisible.value = true
}
// 保存。标题是唯一必填项，其余留空也能存；
// 编辑时只提交标题/详情/计划日期三个字段，避免把 todo_id、source 之类一起回写。
async function onSave() {
  if (!form.todo_title) { ElMessage.warning('请填写标题'); return }
  saving.value = true
  try {
    if (editing.value) await R.updateTodo(form.todo_id, { todo_title: form.todo_title, todo_detail: form.todo_detail, plan_date: form.plan_date })
    else await R.createTodo({ todo_title: form.todo_title, todo_detail: form.todo_detail, plan_date: form.plan_date })
    ElMessage.success('已保存')
    dialogVisible.value = false
    notifyTodoChange()
    load()
  } catch (e) { ElMessage.error(e.message) } finally { saving.value = false }
}
// 删除待办。只删待办本身，来源工单不会被连带删除——两者是弱关联。
async function onDelete(row) {
  // 点「取消」时 confirm 会 reject，不接住会抛未捕获的 Promise 异常
  try { await ElMessageBox.confirm('确认删除该待办？', '提示', { type: 'warning' }) } catch { return }
  try { await R.deleteTodo(row.todo_id); ElMessage.success('已删除'); notifyTodoChange(); load() } catch (e) { ElMessage.error(e.message) }
}

// 首屏加载「当日待办」，与页签默认值保持一致
onMounted(load)
</script>

<style scoped>
/* 待接单工单来源的待办可点开详情 */
.todo-link { color: var(--it-primary); cursor: pointer; }
.todo-link:hover { text-decoration: underline; }
/* 操作列按钮不换行、间距收紧，避免“删除”被挤到第二行 */
:deep(.col-ops .cell) { display: flex; flex-wrap: nowrap; align-items: center; gap: 2px; }
:deep(.col-ops .el-button) { margin-left: 0; padding: 0 3px; }
</style>
