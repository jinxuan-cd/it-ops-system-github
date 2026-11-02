<!--
  操作审计 —— IT 运维工单台账与日报自动管理系统
  操作日志检索与行为汇总查看

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.1
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page">
    <div class="it-between page-head">
      <div>
        <h3 class="it-section-title" style="margin:0">操作审计日志</h3>
        <div class="page-sub">谁在什么时候改了什么，全部留痕（累计 {{ summary.total }} 条）</div>
      </div>
      <div class="head-actions">
        <el-button size="small" @click="load"><el-icon><Refresh /></el-icon> 刷新</el-button>
      </div>
    </div>

    <el-row v-if="summary.top.length" :gutter="14" class="card-row">
      <!-- 近 30 天高频操作是固定窗口，不跟下面的时间筛选联动：
           它的作用是提示「最近主要在改什么」，翻历史区间时这个提示仍然有效 -->
      <el-col :span="24">
        <div class="it-card">
          <div class="top-wrap">
            <span class="top-title">近 30 天高频操作</span>
            <el-tag v-for="t in summary.top" :key="t.action" size="small" effect="plain" class="top-tag">
              {{ t.action }} <b>{{ t.count }}</b>
            </el-tag>
          </div>
        </div>
      </el-col>
    </el-row>

    <div class="it-card" style="margin-bottom:14px">
      <el-form :inline="true">
        <el-form-item label="时间">
          <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" />
        </el-form-item>
        <el-form-item label="操作人">
          <el-select v-model="filters.username" placeholder="全部" clearable filterable style="width:140px">
            <el-option v-for="u in users" :key="u.username" :label="`${u.username}（${u.count}）`" :value="u.username" />
          </el-select>
        </el-form-item>
        <el-form-item label="方式">
          <!-- 界面上写「新增/修改/删除」，实际按 HTTP method 过滤（POST/PUT/DELETE） -->
          <el-select v-model="filters.method" placeholder="全部" clearable style="width:100px">
            <el-option label="新增" value="POST" />
            <el-option label="修改" value="PUT" />
            <el-option label="删除" value="DELETE" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-input v-model="filters.keyword" placeholder="动作/对象/IP" clearable style="width:170px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="load"><el-icon><Search /></el-icon> 查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="it-card">
      <el-table :data="rows" stripe border v-loading="loading" :max-height="540" empty-text="暂无审计记录">
        <el-table-column prop="create_time" label="时间" width="160" />
        <el-table-column label="操作人" width="130">
          <template #default="{ row }">
            <span>{{ row.username || '—' }}</span>
            <el-tag v-if="row.role === 'admin'" size="small" type="danger" style="margin-left:4px">管理员</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="action" label="动作" width="150" />
        <el-table-column prop="path" label="接口" width="200" show-overflow-tooltip>
          <template #default="{ row }"><span class="mono">{{ row.method }} {{ row.path }}</span></template>
        </el-table-column>
        <el-table-column prop="detail" label="关键参数" min-width="240" show-overflow-tooltip>
          <template #default="{ row }"><span class="mono detail">{{ row.detail || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="ip" label="IP" width="130" />
        <el-table-column label="结果" width="80">
          <!-- 以 HTTP 状态码 < 400 判成功：即使是业务异常，只要接口返回 4xx/5xx 就标红 -->
          <template #default="{ row }">
            <el-tag size="small" :type="row.status_code < 400 ? 'success' : 'danger'">{{ row.status_code }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import R from '../api'

const rows = ref([])
// 操作人候选（带各自条数），下拉里直接显示「账号（次数）」，方便按人回溯
const users = ref([])
const loading = ref(false)
// 日期区间：空数组表示不限时间；只有选满两天才会下发 start/end
const range = ref([])
const filters = reactive({ username: '', method: '', keyword: '' })
// 顶部汇总：总条数、近 30 天高频操作、按天分布
const summary = reactive({ total: 0, top: [], daily: [] })

// 组装查询参数：limit 固定 500，审计页只做「最近记录检索」，不做全量导出与分页；
// 日期区间必须选满两端才下发，只选一头视为不限时间
function params() {
  const p = { limit: 500 }
  if (range.value && range.value.length === 2) { p.start = range.value[0]; p.end = range.value[1] }
  Object.keys(filters).forEach(k => { if (filters[k]) p[k] = filters[k] })
  return p
}

// 每次查询都整体重取当前筛选下的最近 500 条，前端不做本地二次过滤
async function load() {
  loading.value = true
  try {
    rows.value = await R.listAuditLogs(params())
  } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}

// 重置要连日期区间一起清，只清下拉会留下上一次的时间窗口
function resetFilters() {
  range.value = []
  Object.assign(filters, { username: '', method: '', keyword: '' })
  load()
}

// 列表先出（主内容），汇总与操作人候选后补：后两者失败只影响顶部提示与下拉，不影响检索
onMounted(async () => {
  load()
  try {
    Object.assign(summary, await R.auditLogSummary())
    users.value = await R.auditLogUsers()
  } catch { /* ignore */ }
})
</script>

<style scoped>
@media (min-width: 1200px) { .it-page { padding-right: 272px; } }
.page-head { margin-bottom: 14px; }
.page-sub { font-size: 12px; color: var(--it-text-sub); margin-top: 4px; }
.head-actions { display: flex; gap: 10px; }
.card-row { margin-bottom: 14px; }
.top-wrap { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.top-title { font-size: 13px; color: var(--it-text-sub); margin-right: 4px; }
.top-tag b { color: var(--it-primary); margin-left: 2px; }
.mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.detail { color: var(--it-text-sub); }
</style>
