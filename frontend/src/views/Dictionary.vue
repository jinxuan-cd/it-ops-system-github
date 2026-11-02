<!--
  基础字典维护 —— IT 运维工单台账与日报自动管理系统
  部门、系统、问题类别等枚举的增删改，是工单录入的数据源

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.2
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page">
    <h3 class="it-section-title">基础字典维护（部门 / 应用系统 / 问题类别）</h3>

    <div class="it-card">
      <!-- 三个 tab 共用同一张表，切换只换字典类型，避免写三份重复模板 -->
      <el-tabs v-model="activeType" @tab-change="load">
        <el-tab-pane label="部门" name="dept" />
        <el-tab-pane label="应用系统" name="app_system" />
        <el-tab-pane label="问题类别" name="problem_type" />
      </el-tabs>

      <!-- 计数与新增按钮都跟随当前 tab：类型不同，文案与接口路径一起变 -->
      <div class="it-between" style="margin-bottom:12px">
        <span class="it-text-sub">共 {{ rows.length }} 项</span>
        <el-button type="primary" @click="openAdd"><el-icon><Plus /></el-icon> 新增{{ typeLabel }}</el-button>
      </div>

      <!-- 停用项仍留在表里，只是不再出现在录入下拉；历史工单里已用的值不受影响 -->
      <el-table :data="rows" stripe border>
        <el-table-column prop="dict_label" label="名称" min-width="180" />
        <el-table-column prop="sort" label="排序" width="90" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.is_enable ? 'success' : 'info'">{{ row.is_enable ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text :type="row.is_enable ? 'warning' : 'success'" @click="toggleEnable(row)">
              {{ row.is_enable ? '停用' : '启用' }}
            </el-button>
            <el-button size="small" text type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 新增 / 编辑：只维护名称与排序，排序值决定它在下拉里的先后 -->
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑' : '新增' + typeLabel" width="420px">
      <el-form :model="form" label-width="70px">
        <el-form-item label="名称" required><el-input v-model="form.dict_label" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import R from '../api'

// 当前字典类型：dept / app_system / problem_type，决定接口路径与标题文案
const activeType = ref('dept')
// 类型的中文名，按钮文案与弹窗标题复用同一份映射
const typeLabel = computed(() => ({ dept: '部门', app_system: '应用系统', problem_type: '问题类别' }[activeType.value]))
// 当前类型的字典项、弹窗状态与保存中标记
const rows = ref([])
const dialogVisible = ref(false)
const editing = ref(false)
const saving = ref(false)
// 表单只带字典项自己的三个字段；type 由 activeType 决定，不放进表单
const form = reactive({ dict_id: null, dict_label: '', sort: 0 })

// includeDisabled=true：管理端必须能看到停用项，才能把它们重新启用
async function load() {
  try {
    const data = await R.getDicts(true)
    rows.value = data[activeType.value] || []
  } catch (e) { ElMessage.error(e.message) }
}
// 新增时把 editing 置回 false，弹窗标题才会走「新增」分支
function openAdd() {
  editing.value = false
  Object.assign(form, { dict_id: null, dict_label: '', sort: 0 })
  dialogVisible.value = true
}
// 只回填可编辑字段，is_enable 由列表上的启停按钮单独管
function openEdit(row) {
  editing.value = true
  Object.assign(form, { dict_id: row.dict_id, dict_label: row.dict_label, sort: row.sort })
  dialogVisible.value = true
}
// 按 editing 分流新增/更新；接口路径必须带当前字典类型，否则会写到错的类型下
async function onSave() {
  if (!form.dict_label) { ElMessage.warning('请填写名称'); return }
  saving.value = true
  try {
    if (editing.value) await R.updateDict(activeType.value, form.dict_id, { dict_label: form.dict_label, sort: form.sort })
    else await R.createDict(activeType.value, { dict_label: form.dict_label, sort: form.sort })
    ElMessage.success('已保存'); dialogVisible.value = false; load()
  } catch (e) { ElMessage.error(e.message) } finally { saving.value = false }
}
// 停用而不是删除：删掉会让历史工单里的值失去字典依据，统计时归不了口
async function toggleEnable(row) {
  try {
    await R.updateDict(activeType.value, row.dict_id, { is_enable: row.is_enable ? 0 : 1 })
    ElMessage.success('已更新'); load()
  } catch (e) { ElMessage.error(e.message) }
}
// 删除只影响以后的下拉候选，历史工单里的文本原样保留，所以确认文案里要写清这一点
async function onDelete(row) {
  // 点「取消」时 confirm 会 reject，不接住会抛未捕获的 Promise 异常
  try { await ElMessageBox.confirm('确认删除该项？历史工单中该值仍保留。', '提示', { type: 'warning' }) } catch { return }
  try { await R.deleteDict(activeType.value, row.dict_id); ElMessage.success('已删除'); load() } catch (e) { ElMessage.error(e.message) }
}

// 进页面先加载默认 tab（部门）的字典项，后续切 tab 由 tab-change 触发
onMounted(load)
</script>
