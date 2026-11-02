<!--
  AI 助手 —— IT 运维工单台账与日报自动管理系统
  运维问答与内容生成对话界面

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.1
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page">
    <h3 class="it-section-title">AI 助手</h3>

    <!-- 状态横幅 -->
    <!-- 标题/类型/说明全部由 configBanner 计算：只要地址+模型齐全且已启用就算「AI 可用」 -->
    <el-alert
      :title="configBanner.title"
      :type="configBanner.type"
      :description="configBanner.desc"
      :closable="false"
      show-icon
      style="margin-bottom:16px"
    />

    <!-- AI 接入设置（每用户独立） -->
    <div class="it-card" style="margin-bottom:16px">
      <div class="it-between" style="margin-bottom:6px">
        <h4 class="it-section-title" style="margin:0">AI 接入设置（仅本人生效）</h4>
        <el-button text type="primary" :loading="savingCfg" @click="saveConfig">保存配置</el-button>
      </div>
      <p class="tip">每个用户在这里单独填写自己的供应商、接口地址与 Token，互不影响，不会与他人共用同一密钥。填好并启用后，下方任务即调用你的 AI；留空则自动使用规则汇总。</p>

      <el-row :gutter="14">
        <el-col :md="12">
          <el-form label-width="92px">
            <el-form-item label="供应商">
              <el-select v-model="cfg.provider" style="width:100%" @change="applyPreset">
                <el-option v-for="p in providers" :key="p.value" :label="p.label" :value="p.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="API 地址">
              <!-- 踩坑提醒写在界面上，不只是注释：后端跑在 Docker 容器里，
                   localhost 指向容器自身而不是宿主机，填了就一定连不上 -->
              <div style="width:100%">
                <el-input v-model="cfg.api_url" placeholder="如 http://host.docker.internal:1234/v1 或 https://api.deepseek.com/v1" />
                <div class="field-tip">
                  只填到 <code>/v1</code> 即可，系统会自动补全 <code>/chat/completions</code>。
                  AI 服务装在你自己的电脑/服务器上时<b>不要写 localhost</b>——后端运行在 Docker 容器里，localhost 指向容器自身，
                  请用 <code>host.docker.internal</code> 或局域网 IP（如 <code>192.168.1.10:1234</code>）。
                </div>
              </div>
            </el-form-item>
            <el-form-item label="模型">
              <div class="model-row">
                <el-select
                  v-model="cfg.model"
                  filterable
                  allow-create
                  default-first-option
                  clearable
                  placeholder="如 deepseek-chat / 本地模型名"
                  style="flex:1"
                >
                  <el-option v-for="mo in modelOptions" :key="mo" :label="mo" :value="mo" />
                </el-select>
                <el-button size="small" :loading="loadingModels" @click="fetchModels">获取模型</el-button>
              </div>
            </el-form-item>
          </el-form>
        </el-col>
        <el-col :md="12">
          <el-form label-width="92px">
            <el-form-item label="Token">
              <!-- 后端从不回传明文 Token，只用 has_key 标记「已保存」；
                   留空提交表示沿用原值，填了新值才覆盖 —— 所以输入框每次进页面都是空的 -->
              <el-input
                v-model="cfg.api_key"
                type="password"
                show-password
                :placeholder="cfg.has_key ? '已保存，留空则保留原 Token' : '本地模型（LM Studio/Ollama）可留空'"
              />
            </el-form-item>
            <el-form-item label="启用">
              <el-switch v-model="cfg.is_enable" />
            </el-form-item>
            <el-form-item>
              <el-button size="small" @click="testConnection" :loading="testing">测试连接</el-button>
              <span v-if="testMsg" class="test-msg" :class="testOk ? 'ok' : 'err'">{{ testMsg }}</span>
            </el-form-item>
          </el-form>
        </el-col>
      </el-row>
    </div>

    <el-row :gutter="16">
      <!-- 智能日报 -->
      <!-- 三个任务卡片都是「有 AI 走 AI、没 AI 走规则汇总」：
           未配置时不报错、不置灰，只是退回模板化输出，保证功能始终可用 -->
      <el-col :md="8">
        <div class="it-card ai-card">
          <div class="ai-icon blue"><el-icon><Notebook /></el-icon></div>
          <h4>智能汇总今日日报</h4>
          <p class="ai-desc">根据今日已完成工单、未完成待办、在办项目，生成当日日报（[今日]/[协调]/[计划]）。</p>
          <el-button type="primary" :loading="dailyLoading" @click="genDaily">立即生成</el-button>
          <el-button text type="primary" @click="goPage('/daily-report')">去编辑 / 提交</el-button>
        </div>
      </el-col>

      <!-- 月度报告 -->
      <el-col :md="8">
        <div class="it-card ai-card">
          <div class="ai-icon green"><el-icon><Document /></el-icon></div>
          <h4>生成月度工作报告</h4>
          <p class="ai-desc">汇总当月工单量、问题分布、目标完成与项目进展，输出五段式向上汇报，便于年底归档。</p>
          <el-date-picker v-model="month" type="month" value-format="YYYY-MM" style="width:100%;margin-bottom:10px" />
          <el-button type="primary" :loading="monthLoading" @click="genMonth">生成报告</el-button>
          <el-button text type="primary" @click="goPage('/monthly-report')">去查看 / 复制</el-button>
        </div>
      </el-col>

      <!-- 知识库整理 -->
      <el-col :md="8">
        <div class="it-card ai-card">
          <div class="ai-icon orange"><el-icon><Reading /></el-icon></div>
          <h4>AI 整理知识库</h4>
          <p class="ai-desc">把历史已完成工单按「应用系统 + 问题类别」聚类，自动总结标准处理方案、归纳知识点，沉淀为可复用知识。</p>
          <el-button type="primary" :loading="kbLoading" @click="organizeKb">一键整理</el-button>
          <el-button text type="primary" @click="goPage('/knowledge')">去知识库查看</el-button>
        </div>
      </el-col>
    </el-row>

    <!-- 结果区 -->
    <!-- 三个任务共用一个结果面板，谁有结果就显示谁；日报/月报给可编辑的只读文本框，
         知识库整理只回一条说明（结果本身在知识库页面里） -->
    <div class="it-card" style="margin-top:16px" v-if="dailyResult || monthResult || kbResult">
      <h4 class="it-section-title">执行结果</h4>

      <div v-if="dailyResult" class="res-block">
        <div class="res-title">今日日报（已生成，可到「日报生成」页微调并提交）</div>
        <el-alert v-if="dailyNote" :title="dailyNote" :type="dailyAi ? 'success' : 'info'" :closable="false" show-icon style="margin-bottom:10px" />
        <el-input v-model="dailyResult" type="textarea" :rows="8" readonly />
      </div>

      <div v-if="monthResult" class="res-block">
        <el-alert :title="monthNote" :type="monthAi ? 'success' : 'info'" :closable="false" show-icon style="margin-bottom:10px" />
        <el-input v-model="monthResult" type="textarea" :rows="10" readonly />
      </div>

      <div v-if="kbResult" class="res-block">
        <el-alert :title="kbNote" :type="kbAi ? 'success' : 'info'" :closable="false" show-icon />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Notebook, Document, Reading } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import R from '../api'

const router = useRouter()

// ---------------- 每用户 AI 配置 ----------------
// 供应商预设：选一个就把地址与默认模型填好。url 一律只填到 /v1，
// /chat/completions 由后端补全，避免用户手填重复或漏填
const providers = [
  { label: 'DeepSeek', value: 'deepseek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'OpenAI', value: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'OpenRouter', value: 'openrouter', url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { label: '通义千问（阿里云）', value: 'qwen', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: 'Kimi（月之暗面）', value: 'kimi', url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { label: 'LM Studio（本地）', value: 'lmstudio', url: 'http://host.docker.internal:1234/v1', model: 'local-model' },
  { label: 'Ollama（本地）', value: 'ollama', url: 'http://host.docker.internal:11434/v1', model: 'qwen2.5' },
  { label: '自定义 / 其他 OpenAI 兼容', value: 'custom', url: '', model: '' }
]

// 配置表单：has_key 表示后端已存过 Token（输入框不回显明文），configured 表示已保存过配置
const cfg = reactive({ provider: 'deepseek', api_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', api_key: '', is_enable: true, has_key: false, configured: false })
const savingCfg = ref(false)
const testing = ref(false)
// 测试连接的即时反馈：testMsg 是文案，testOk 决定红/绿
const testMsg = ref('')
const testOk = ref(false)
// 「获取模型」拉回的候选列表，只做下拉选项，不强制必须从中选（allow-create 支持手填）
const modelOptions = ref([])
const loadingModels = ref(false)

// 选择供应商时自动填充默认地址/模型（自定义则清空让用户填）
function applyPreset(val) {
  const p = providers.find(x => x.value === val)
  if (p && p.value !== 'custom') {
    cfg.api_url = p.url
    cfg.model = p.model
  } else if (p && p.value === 'custom') {
    cfg.api_url = ''
    cfg.model = ''
  }
}

// 读取本人配置；失败时保留默认值（等价于未配置，仍可用规则汇总）
async function loadConfig() {
  try {
    const d = await R.getAiConfig()
    Object.assign(cfg, d)
  } catch (e) {}
}

// 保存配置：地址与模型必填（Token 对本地模型可空）。
// 提交后主动清空 api_key 输入框——密钥已经落到后端，没必要继续留在页面内存里
async function saveConfig() {
  if (!cfg.api_url || !cfg.model) { ElMessage.warning('API 地址与模型为必填'); return }
  savingCfg.value = true
  try {
    const res = await R.updateAiConfig({
      provider: cfg.provider,
      api_url: cfg.api_url,
      model: cfg.model,
      api_key: cfg.api_key,
      is_enable: cfg.is_enable
    })
    // 后端保存时会自动补全 /chat/completions，把纠正后的地址回显给用户
    if (res && res.api_url) cfg.api_url = res.api_url
    cfg.has_key = !!cfg.api_key || cfg.has_key
    cfg.configured = true
    cfg.api_key = ''
    ElMessage.success('AI 接入配置已保存')
  } catch (e) { ElMessage.error(e.message) } finally { savingCfg.value = false }
}

// 测试连接：成功后如果后端纠正了地址（补全路径 / 替换 localhost），
// 自动回填并提示用户再点一次保存，否则测通了但存下去的还是错地址
async function testConnection() {
  if (!cfg.api_url || !cfg.model) {
    ElMessage.warning('请先填写 API 地址与模型（本地模型可留空 Token）'); return
  }
  testing.value = true
  testMsg.value = ''
  try {
    const res = await R.testAiConfig({
      api_url: cfg.api_url,
      api_key: cfg.api_key || undefined,
      model: cfg.model
    })
    testOk.value = true
    // 后端可能自动纠正了地址（补全 /chat/completions 或把 localhost 换成宿主机别名），回填方便直接保存
    if (res && res.working_url && res.working_url !== cfg.api_url) {
      cfg.api_url = res.working_url
      ElMessage.warning('地址已自动纠正为可用形式，记得点右上角「保存配置」')
    }
    testMsg.value = (res && (res.__message || res.message)) || '连接成功'
  } catch (e) {
    testOk.value = false
    testMsg.value = e.message  // 后端已带「连接失败：」前缀，避免重复
  } finally { testing.value = false }
}

// 拉取该接口的模型列表（GET /v1/models），避免模型名写错
async function fetchModels() {
  if (!cfg.api_url) { ElMessage.warning('请先填写 API 地址'); return }
  loadingModels.value = true
  try {
    const res = await R.listAiModels({ api_url: cfg.api_url, api_key: cfg.api_key || undefined })
    modelOptions.value = res.models || []
    if (modelOptions.value.length === 1) cfg.model = modelOptions.value[0]
    ElMessage.success(`已获取 ${modelOptions.value.length} 个模型，请在「模型」下拉里选择`)
  } catch (e) {
    ElMessage.error(e.message)
  } finally { loadingModels.value = false }
}

// 横幅结论只认「启用 + 地址 + 模型」三件套，与是否填了 Token 无关：
// 本地模型（LM Studio / Ollama）不需要密钥
const configBanner = computed(() => {
  const p = providers.find(x => x.value === cfg.provider)
  const ready = !!(cfg.is_enable && cfg.api_url && cfg.model)
  if (ready) {
    return {
      title: `AI 已启用（${p ? p.label : cfg.provider}）`,
      type: 'success',
      desc: `当前模型：${cfg.model}。下方任务将调用你自己的 AI 接口生成内容。`
    }
  }
  return { title: '未配置 AI 或已停用', type: 'info', desc: '日报 / 月报 / 知识库整理将自动使用规则汇总（仅列事实、不用 AI），功能同样可用。在上方填写地址、模型并启用即可开启 AI。' }
})

// ---------------- 任务 ----------------
// 三个任务的状态各自独立：结果、提示语、是否真的调了 AI（*Ai 决定提示条的绿/蓝）。
// 分开存是为了让日报和月报的结果可以同时留在页面上对比
const dailyLoading = ref(false)
const dailyResult = ref('')
const dailyNote = ref('')
const dailyAi = ref(false)

// 默认选当月（YYYY-MM），月报接口只认这个格式
const month = ref(currentMonth())
const monthLoading = ref(false)
const monthResult = ref('')
const monthNote = ref('')
const monthAi = ref(false)

const kbLoading = ref(false)
const kbResult = ref('')
const kbNote = ref('')
const kbAi = ref(false)

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function goPage(p) { router.push(p) }

// 生成今日日报：后端回三段字段，前端只负责拼成「[今日]/[协调]/[计划]」，
// 空段直接丢掉，避免出现空标题；ai_used 为 false 就是规则汇总的版本
async function genDaily() {
  dailyLoading.value = true
  try {
    const res = await R.aiDailyReport()
    const text = [res.today_work, res.need_help ? '【协调】' + res.need_help : '', res.tomorrow_plan ? '【计划】' + res.tomorrow_plan : ''].filter(Boolean).join('\n\n')
    dailyResult.value = text || '（暂无内容）'
    dailyAi.value = !!res.ai_used
    dailyNote.value = res.ai_used
      ? '已使用你的 AI 生成日报'
      : '未配置 AI，已按规则汇总（今日处理事项 + 处理结果）'
    ElMessage.success('今日日报已生成')
  } catch (e) { ElMessage.error(e.message) } finally { dailyLoading.value = false }
}

// 生成月报：必须显式选月份，空值直接拦下，不默认成当月（防止误覆盖已有月报）
async function genMonth() {
  if (!month.value) { ElMessage.warning('请选择月份'); return }
  monthLoading.value = true
  try {
    const res = await R.generateMonthlyReport(month.value)
    monthResult.value = res.content || ''
    monthAi.value = !!res.ai_used
    monthNote.value = res.ai_used
      ? `${month.value} AI 月度报告已生成`
      : `${month.value} 月度报告已生成（规则汇总，配置 AI 后即为 AI 版）`
    ElMessage.success(monthNote.value)
  } catch (e) { ElMessage.error(e.message) } finally { monthLoading.value = false }
}

// 知识库整理：不返回正文，kbResult 只是「有结果」的哨兵值，
// 用来把结果区撑开并显示后端给出的条数说明
async function organizeKb() {
  kbLoading.value = true
  try {
    const res = await R.aiOrganizeKnowledge()
    kbAi.value = !!res.ai_used
    kbNote.value = (res && res.__message) || '知识库已整理'
    kbResult.value = 'done'
    ElMessage.success(kbNote.value)
  } catch (e) { ElMessage.error(e.message) } finally { kbLoading.value = false }
}

onMounted(loadConfig)
</script>

<style scoped>
.tip { font-size: 13px; color: var(--it-text-sub); margin: -6px 0 14px; }
.field-tip { font-size: 12px; color: var(--it-text-sub); line-height: 1.6; margin-top: 4px; }
.field-tip code { background: rgba(47,111,237,0.08); padding: 0 3px; border-radius: 3px; }
.field-tip b { color: var(--it-danger); font-weight: 600; }
.model-row { display: flex; gap: 8px; width: 100%; align-items: center; }
.test-msg { display: block; font-size: 12px; margin-top: 6px; line-height: 1.6; word-break: break-all; }
.test-msg.ok { color: var(--it-success); }
.test-msg.err { color: var(--it-danger); }
.ai-card { text-align: center; padding: 20px 16px; height: 100%; }
.ai-icon { width: 46px; height: 46px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; color: #fff; font-size: 22px; margin-bottom: 10px; }
.ai-icon.blue { background: #2f6fed; }
.ai-icon.green { background: #18a058; }
.ai-icon.orange { background: #f0a020; }
.ai-card h4 { margin: 6px 0 8px; }
.ai-desc { font-size: 13px; color: var(--it-text-sub); min-height: 60px; margin-bottom: 12px; }
.res-block { margin-bottom: 16px; }
.res-title { font-weight: 600; margin-bottom: 8px; }
</style>
