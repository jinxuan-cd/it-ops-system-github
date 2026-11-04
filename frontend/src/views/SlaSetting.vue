<!--
  SLA 时限设置 —— IT 运维工单台账与日报自动管理系统
  按问题类别与优先级配置响应、解决时限

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.2
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page">
    <div class="it-between page-head">
      <div>
        <h3 class="it-section-title" style="margin:0">SLA 时效策略</h3>
        <div class="page-sub">按问题类别设定响应与解决时限，超时工单会在工时列表和看板中标红</div>
      </div>
      <div class="head-actions">
        <!-- 改完策略必须手动重算：历史工单存的是生成时的时限快照，不重算就还是旧口径 -->
        <el-button size="small" :loading="recalcing" @click="onRecalc">按当前策略重算历史工单</el-button>
        <el-button type="primary" size="small" @click="openCreate"><el-icon><Plus /></el-icon> 新增策略</el-button>
      </div>
    </div>

    <!-- 匹配优先级口径写在页面上：策略命中顺序直接决定超时判定，配错一条就整类工单失真 -->
    <el-alert type="info" :closable="false" show-icon style="margin-bottom:14px">
      <template #title>
        匹配优先级：问题类别 + 优先级精确匹配 &gt; 仅问题类别 &gt; 默认策略（*）。未单独配置的类别一律走默认策略。
        工单详情页会显示该单实际命中的策略，超时判定和你预期不一致时先看那里。
      </template>
      <template #default>
        时效口径：<b>响应时限</b>从发生时间起算，到「接单/派单」为止（关闭服务台 = 工程师接单，开启服务台 = 服务台派单）；
        <b>完成时限</b>从接单时间起算，到「结束时间」为止，处理耗时同样按「结束时间 − 接单时间」计算。
      </template>
    </el-alert>

    <div class="it-card">
      <!-- 默认策略（*）只能编辑不能删：它是兜底，删了未配置类别就没有时限可依 -->
      <el-table :data="rows" stripe border v-loading="loading" empty-text="暂无策略">
        <el-table-column label="问题类别" width="180">
          <template #default="{ row }">
            <el-tag v-if="row.problem_type === '*'" type="info" size="small">默认策略</el-tag>
            <span v-else>{{ row.problem_type }}</span>
          </template>
        </el-table-column>
        <el-table-column label="优先级" width="120">
          <template #default="{ row }">{{ row.priority ? priorityLabel(row.priority) : '不限' }}</template>
        </el-table-column>
        <el-table-column label="响应时限" width="140">
          <template #default="{ row }"><b class="num">{{ row.respond_hours }}</b> 小时</template>
        </el-table-column>
        <el-table-column label="解决时限" width="140">
          <template #default="{ row }"><b class="num">{{ row.resolve_hours }}</b> 小时</template>
        </el-table-column>
        <el-table-column prop="remark" label="说明" min-width="200" show-overflow-tooltip />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="row.problem_type !== '*'" size="small" text type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="formVisible" :title="form.policy_id ? '编辑策略' : '新增策略'" width="520px">
      <!-- 类别允许直接手输（allow-create）：字典还没收录的新场景，也应该能先配上时限 -->
      <el-form :model="form" label-width="96px">
        <el-form-item label="问题类别">
          <el-select v-model="form.problem_type" filterable allow-create style="width:100%" placeholder="选字典项或输入自定义">
            <el-option label="* 默认策略（兜底）" value="*" />
            <el-option v-for="d in dicts.problem_type" :key="d.dict_id" :label="d.dict_label" :value="d.dict_label" />
          </el-select>
        </el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="form.priority" clearable placeholder="不限" style="width:100%">
            <el-option label="紧急" value="urgent" />
            <el-option label="高" value="high" />
            <el-option label="普通" value="normal" />
            <el-option label="低" value="low" />
          </el-select>
        </el-form-item>
        <el-form-item label="响应时限">
          <el-input-number v-model="form.respond_hours" :min="0.5" :step="0.5" :precision="1" /> <span class="unit">小时</span>
        </el-form-item>
        <el-form-item label="解决时限">
          <el-input-number v-model="form.resolve_hours" :min="0.5" :step="0.5" :precision="1" /> <span class="unit">小时</span>
        </el-form-item>
        <el-form-item label="说明"><el-input v-model="form.remark" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import R from '../api'

// 策略列表。行里 problem_type='*' 表示默认兜底策略，priority 为空表示该类别下不限优先级
const rows = ref([])
const loading = ref(false)
// 重算进行中标记：重算要遍历历史工单，耗时明显，必须有 loading 防重复触发
const recalcing = ref(false)
// 问题类别字典，只用来给下拉提供候选项
const dicts = reactive({ problem_type: [] })
const formVisible = ref(false)
const saving = ref(false)
// 弹窗表单。新增时先清空整个对象，避免编辑过的行残留字段带进下一条
const form = reactive({})

// 优先级枚举转中文，表格和提示里统一用这套叫法
function priorityLabel(p) {
  return { urgent: '紧急', high: '高', normal: '普通', low: '低' }[p] || p
}

// 拉策略列表。列表按问题类别名排序展示，并不是命中顺序；
// 真正的命中顺序（类别+优先级 > 仅类别 > *）由后端取值时判定，看到的第一行不一定先被用上。
async function load() {
  loading.value = true
  try { rows.value = await R.listSla() } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}

// 新增：默认给「* 默认策略 + 4 小时响应 / 24 小时解决」，
// 这是最常见的兜底口径，多数情况下改个数字就能存。
function openCreate() {
  Object.keys(form).forEach(k => delete form[k])
  form.problem_type = '*'
  form.respond_hours = 4
  form.resolve_hours = 24
  formVisible.value = true
}
// 编辑：把整行拷进表单，policy_id 存在与否决定保存时走更新还是新建
function openEdit(row) {
  Object.keys(form).forEach(k => delete form[k])
  Object.assign(form, row)
  formVisible.value = true
}
// 保存策略。注意：这里只改策略本身，不会自动重算历史工单，
// 要让新时限对已产生的工单生效，得再点一次「按当前策略重算历史工单」。
async function onSave() {
  saving.value = true
  try {
    if (form.policy_id) await R.updateSla(form.policy_id, form)
    else await R.createSla(form)
    ElMessage.success('已保存')
    formVisible.value = false
    load()
    // 改完策略不重算，存量工单还按旧时限判定，正是「我设成 4 小时怎么还按 2 小时算超时」的来源。
    // 这里直接问一句，比让用户自己去点按钮可靠。
    try {
      await ElMessageBox.confirm(
        '策略已保存。已产生的工单仍按旧时限计算，需要按新策略重算一遍才会更新超时标记，现在重算吗？',
        '重算历史工单', { type: 'info', confirmButtonText: '立即重算', cancelButtonText: '稍后手动重算' }
      )
      await onRecalc()
    } catch { /* 用户选择稍后 */ }
  } catch (e) { ElMessage.error(e.message) } finally { saving.value = false }
}
// 删除策略。先确认再删——删掉后该类别工单会回落到更低优先级的策略（最终是 *），
// 时限可能一下子变宽，等于历史超时记录会「变正常」，所以要提醒。
async function onDelete(row) {
  try {
    await ElMessageBox.confirm('确认删除该策略？删除后相关工单会回落到默认策略。', '提示', { type: 'warning' })
  } catch { return }
  try {
    await R.deleteSla(row.policy_id)
    ElMessage.success('已删除')
    load()
  } catch (e) { ElMessage.error(e.message) }
}
// 按当前策略重算历史工单的时限与超时标记。
// 回显重算条数而不只是「成功」，让用户确认覆盖范围符合预期（0 条通常说明策略没生效）。
async function onRecalc() {
  recalcing.value = true
  try {
    const r = await R.recalcSla()
    ElMessage.success(`已重算 ${r.updated} 条工单的时效`)
  } catch (e) { ElMessage.error(e.message) } finally { recalcing.value = false }
}

// 首屏：策略列表必须成功才有内容，字典失败只影响新增时的候选项，所以分开放错误处理
onMounted(async () => {
  load()
  try {
    const d = await R.getDicts(false)
    dicts.problem_type = d.problem_type
  } catch { /* ignore */ }
})
</script>

<style scoped>
@media (min-width: 1200px) { .it-page { padding-right: 272px; } }
.page-head { margin-bottom: 14px; }
.page-sub { font-size: 12px; color: var(--it-text-sub); margin-top: 4px; }
.head-actions { display: flex; gap: 10px; }
.num { color: var(--it-primary); font-size: 15px; }
.unit { color: var(--it-text-sub); font-size: 12px; margin-left: 6px; }
</style>
