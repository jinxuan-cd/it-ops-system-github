<!--
  扫码报障页 —— IT 运维工单台账与日报自动管理系统
  免登录报障入口，支持 Ctrl+V 粘贴故障截图，可查询处理进度与评价

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.4.2
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="pub-page">
    <!-- 免登录门户头：本页由 IT 生成带入口密钥的链接/二维码分发，员工扫码即可报障，不需要账号 -->
    <div class="pub-head">
      <div class="logo">IT</div>
      <div>
        <h1>IT 报障服务台</h1>
        <p>提交问题 · 查询进度 · 服务评价</p>
      </div>
    </div>

    <!-- 后台关掉自助报障时只给提示、不渲染表单，避免用户填完一大段才发现提交不了 -->
    <div v-if="!enabled" class="pub-card center">
      <el-icon size="40" color="var(--it-warning)"><WarningFilled /></el-icon>
      <h3>自助报障暂未开放</h3>
      <p>请联系 IT 同事直接报障。</p>
    </div>

    <!-- 入口密钥不匹配（换过密钥、链接被转发或手改过 k）：不给重试入口，引导重新扫码拿新链接 -->
    <div v-else-if="badKey" class="pub-card center">
      <el-icon size="40" color="var(--it-danger)"><CircleCloseFilled /></el-icon>
      <h3>报障入口校验失败</h3>
      <p>请重新扫描二维码，或联系 IT 获取新的入口链接。</p>
    </div>

    <template v-else>
      <!-- 两个页签共用同一套入口密钥：报障和查进度都不需要登录，靠 k 判断门户是否开放 -->
      <div class="pub-tabs">
        <div class="pub-tab" :class="{ on: tab === 'report' }" @click="tab = 'report'">我要报障</div>
        <div class="pub-tab" :class="{ on: tab === 'track' }" @click="tab = 'track'">查询进度</div>
      </div>

      <!-- 报障 -->
      <div v-show="tab === 'report'" class="pub-card">
        <!-- 提交成功后整块换成结果页：免登录场景拿不到用户身份，报障单号就是唯一查询凭证 -->
        <template v-if="submittedNo">
          <div class="done-box">
            <el-icon size="44" color="var(--it-success)"><CircleCheckFilled /></el-icon>
            <h3>报障已提交</h3>
            <p>您的报障单号是</p>
            <div class="no-box">{{ submittedNo }}</div>
            <p class="tip">请记下单号，稍后可在「查询进度」中查看处理情况</p>
            <el-button type="primary" plain @click="goTrack">去查询进度</el-button>
            <el-button text @click="resetReport">再报一个</el-button>
          </div>
        </template>

        <template v-else>
          <!-- 报障表单：只有姓名和问题描述必填，部门/手机号/系统选填，扫码即填的门槛越低越好 -->
          <div class="field">
            <label>您的姓名 <i>*</i></label>
            <el-input v-model="form.contact" placeholder="方便我们联系您" size="large" maxlength="20" />
          </div>
          <div class="field-row">
            <div class="field">
              <label>部门</label>
              <el-select v-model="form.dept" placeholder="请选择" size="large" filterable clearable style="width:100%">
                <el-option v-for="d in options.dept" :key="d" :label="d" :value="d" />
              </el-select>
            </div>
            <div class="field">
              <label>手机号</label>
              <el-input v-model="form.phone" placeholder="选填，便于回电" size="large" maxlength="20" />
            </div>
          </div>
          <div class="field">
            <label>相关系统</label>
            <el-select v-model="form.app_system" placeholder="不确定可不选" size="large" filterable clearable style="width:100%">
              <el-option v-for="d in options.app_system" :key="d" :label="d" :value="d" />
            </el-select>
          </div>
          <div class="field">
            <label>紧急程度</label>
            <!-- 让报障人自己先分级：SLA 按「问题类别 + 优先级」匹配时限，进来前定档比进线后再改更准 -->
            <div class="pri-row">
              <div v-for="p in PRIORITIES" :key="p.value" class="pri" :class="[p.value, { on: form.priority === p.value }]"
                @click="form.priority = p.value">
                {{ p.label }}
              </div>
            </div>
          </div>
          <div class="field">
            <label>问题描述 <i>*</i></label>
            <el-input v-model="form.content" type="textarea" :rows="5" size="large"
              placeholder="请描述遇到的现象，例如：打开 OA 提示 502，所有人打不开" maxlength="500" show-word-limit />
          </div>
          <el-button type="primary" size="large" class="submit" :loading="submitting" @click="onSubmit">提交报障</el-button>
          <p class="privacy">提交后 IT 会尽快响应，紧急问题请同时电话联系 IT 值班。</p>
        </template>
      </div>

      <!-- 查询 -->
      <!-- 进度查询：单号 + 手机号后 4 位，用轻量的二次校验挡住按单号顺序逐个试的爬取 -->
      <div v-show="tab === 'track'" class="pub-card">
        <div class="field">
          <label>报障单号</label>
          <el-input v-model="track.report_no" placeholder="如 R202610280001" size="large" />
        </div>
        <div class="field">
          <label>手机号后 4 位</label>
          <el-input v-model="track.phone" placeholder="选填" size="large" maxlength="4" />
        </div>
        <el-button type="primary" size="large" class="submit" :loading="tracking" @click="onTrack">查询</el-button>

        <!-- 结果卡只回显对外可露出的字段：内部处理人、工时、SLA 等一律不下发给公网 -->
        <div v-if="result" class="result">
          <div class="r-head">
            <el-tag :type="result.status === 'done' ? 'success' : result.status === 'pending' ? 'info' : 'warning'" effect="dark">
              {{ result.status === 'done' ? '已完成' : result.status === 'pending' ? '待接单' : '处理中' }}
            </el-tag>
            <span class="r-no">{{ result.report_no }}</span>
          </div>
          <div class="r-line"><span>问题</span><b>{{ result.service_content }}</b></div>
          <div class="r-line"><span>系统</span><b>{{ result.app_system || '—' }}</b></div>
          <div class="r-line"><span>提交</span><b>{{ result.happen_time }}</b></div>
          <div v-if="result.finish_time" class="r-line"><span>完成</span><b>{{ result.finish_time }}</b></div>
          <div v-if="result.result" class="r-result">
            <div class="label">处理结果</div>
            <p>{{ result.result }}</p>
          </div>

          <!-- 只有「已完成且尚未评价」的单子才出评价框，can_satisfy 由后端判定，前端不自己猜 -->
          <div v-if="result.can_satisfy" class="rate-box">
            <div class="label">本次服务您满意吗？</div>
            <el-rate v-model="rate.score" :texts="['很不满意', '不满意', '一般', '满意', '非常满意']" show-text size="large" />
            <el-input v-model="rate.comment" placeholder="还有什么想说的？（选填）" type="textarea" :rows="2" style="margin-top:10px" />
            <el-button type="primary" style="margin-top:10px" :loading="rating" @click="onRate">提交评价</el-button>
          </div>
          <div v-else-if="result.satisfy_score" class="rated">
            已评价：<el-rate :model-value="result.satisfy_score" disabled size="small" style="display:inline-block;vertical-align:middle" />
          </div>
        </div>
      </div>

      <div class="pub-foot">
        <!-- 两个门户页共用同一个入口密钥，跳转必须带上 k，否则 FAQ 页会判定「缺少密钥」 -->
        <router-link :to="{ path: '/faq', query: { k: KEY } }" v-if="faqEnabled">查看常见问题，也许能马上解决 →</router-link>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import R from '../api'

const route = useRoute()
// 入口密钥：从 URL 上的 k 取，之后每个 /api/public/* 请求都要带上。
// 后端据此判断这个链接是否还开放，密钥轮换后旧二维码会自动失效。
const KEY = String(route.query.k || '')

// 门户是否开启自助报障（后端配置项，关掉就只显示提示）
const enabled = ref(true)
// 密钥校验失败标记：只有「配置了密钥但本链接的 k 对不上」时才为真
const badKey = ref(false)
// 常见问题入口是否开放：关掉后页脚不引导去 /faq
const faqEnabled = ref(true)
// 当前页签：report 报障 / track 查进度
const tab = ref('report')

// 下拉字典（部门、应用系统、问题类别），统一由 /api/public/options 下发，公网不读内部字典表
const options = reactive({ dept: [], app_system: [], problem_type: [] })
// 紧急程度档位与后端 priority 枚举一一对应，直接决定 SLA 时限
const PRIORITIES = [
  { value: 'urgent', label: '很急' },
  { value: 'high', label: '较急' },
  { value: 'normal', label: '一般' },
  { value: 'low', label: '不急' }
]

// 报障表单。免登录链路只收文本：本页拿不到账号身份，附件不在这条链路上收集；
// 需要 Ctrl+V 粘贴故障截图的场景走登录后的建单页（/tickets 新建），那边有身份可追溯。
const form = reactive({ contact: '', dept: '', phone: '', app_system: '', priority: 'normal', content: '' })
const submitting = ref(false)
// 提交成功后拿到的报障单号，非空即切到结果页
const submittedNo = ref('')

// 查询表单：单号必填，手机号后 4 位选填（填了才会做二次校验）
const track = reactive({ report_no: '', phone: '' })
const tracking = ref(false)
// 查询结果：null 表示还没查或查无此单
const result = ref(null)
const rate = reactive({ score: 0, comment: '' })
const rating = ref(false)

// 提交报障。姓名与描述先本地挡一道：4 个字以下基本等于没说，
// 直接提示比让 IT 反复回电追问更省事。
async function onSubmit() {
  if (!form.contact.trim()) return ElMessage.warning('请填写您的姓名')
  if (form.content.trim().length < 4) return ElMessage.warning('请简单描述遇到的问题')
  submitting.value = true
  try {
    const r = await R.publicReport({ ...form, k: KEY })
    submittedNo.value = r.report_no
  } catch (e) { ElMessage.error(e.message) } finally { submitting.value = false }
}

// 清空表单回到填写态，方便同一台设备连续帮同事报多个问题（不清姓名，省得重填）
function resetReport() {
  submittedNo.value = ''
  Object.assign(form, { dept: '', phone: '', app_system: '', priority: 'normal', content: '' })
}
// 从结果页跳去查进度：顺手把单号和手机号后 4 位带过去，省掉用户手抄单号这一步
function goTrack() {
  track.report_no = submittedNo.value
  track.phone = (form.phone || '').slice(-4)
  tab.value = 'track'
  onTrack()
}

// 查询进度。每次查询先清空上一单的结果与评分，
// 否则切换单号后旧评分会带到新单子上，容易把评价写错对象。
async function onTrack() {
  if (!track.report_no.trim()) return ElMessage.warning('请填写报障单号')
  tracking.value = true
  result.value = null
  rate.score = 0
  rate.comment = ''
  try {
    result.value = await R.publicTrack({ report_no: track.report_no.trim(), phone: track.phone })
  } catch (e) { ElMessage.error(e.message) } finally { tracking.value = false }
}

// 提交满意度评价。评价成功后重新查一次详情，
// 让按钮换成「已评价」的只读星级，避免同一单反复打分把满意度数据拉偏。
async function onRate() {
  if (!rate.score) return ElMessage.warning('请先选择评分')
  rating.value = true
  try {
    await R.publicSatisfy({ report_no: result.value.report_no, phone: track.phone, score: rate.score, comment: rate.comment })
    ElMessage.success('感谢您的评价！')
    onTrack()
  } catch (e) { ElMessage.error(e.message) } finally { rating.value = false }
}

// 首屏：先问配置（门户是否开放、密钥是否有效），有效才去拉下拉字典。
// 顺序不能反——密钥无效时继续拉字典等于白跑一次公网请求。
onMounted(async () => {
  try {
    const c = await R.publicConfig(KEY)
    enabled.value = !!c.report_enable
    faqEnabled.value = !!c.faq_enable
    if (c.has_key && !c.key_ok) badKey.value = true
    if (enabled.value && !badKey.value) {
      const o = await R.publicOptions()
      Object.assign(options, o)
    }
  } catch (e) {
    ElMessage.error('加载失败：' + e.message)
  }
})
</script>

<style scoped>
.pub-page {
  min-height: 100vh;
  background: linear-gradient(180deg, var(--it-primary) 0%, var(--it-primary) 180px, var(--it-bg) 180px, var(--it-bg) 100%);
  padding: 22px 16px 40px;
  max-width: 640px;
  margin: 0 auto;
}
.pub-head { display: flex; align-items: center; gap: 12px; color: #fff; padding: 6px 4px 20px; }
.pub-head .logo {
  width: 42px; height: 42px; border-radius: 12px; background: rgba(255,255,255,0.2);
  display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px;
}
.pub-head h1 { font-size: 19px; margin: 0; }
.pub-head p { font-size: 12px; margin: 3px 0 0; opacity: 0.85; }

.pub-card {
  background: var(--it-card); border-radius: 14px; padding: 18px;
  box-shadow: 0 6px 24px rgba(31, 41, 55, 0.08);
}
.pub-card.center { text-align: center; padding: 40px 20px; }
.pub-card.center h3 { margin: 12px 0 6px; font-size: 16px; }
.pub-card.center p { color: var(--it-text-sub); font-size: 13px; margin: 0; }

.pub-tabs { display: flex; background: rgba(255,255,255,0.22); border-radius: 10px; padding: 4px; margin-bottom: 12px; }
.pub-tab { flex: 1; text-align: center; padding: 9px 0; font-size: 14px; color: #fff; border-radius: 8px; cursor: pointer; }
.pub-tab.on { background: var(--it-card); color: var(--it-primary); font-weight: 600; }

.field { margin-bottom: 14px; }
.field label { display: block; font-size: 13px; color: var(--it-text-sub); margin-bottom: 6px; }
.field label i { color: var(--it-danger); font-style: normal; }
.field-row { display: flex; gap: 12px; }
.field-row .field { flex: 1; min-width: 0; }

.pri-row { display: flex; gap: 8px; }
.pri {
  flex: 1; text-align: center; padding: 9px 0; font-size: 13px; border-radius: 8px;
  border: 1px solid var(--it-border); cursor: pointer; color: var(--it-text-sub);
}
.pri.on { border-color: var(--it-primary); color: var(--it-primary); background: var(--it-primary-light); font-weight: 600; }
.pri.on.urgent { border-color: var(--it-danger); color: var(--it-danger); background: rgba(229,69,69,0.08); }
.pri.on.high { border-color: var(--it-warning); color: var(--it-warning); background: rgba(240,160,32,0.1); }

.submit { width: 100%; margin-top: 4px; }
.privacy { font-size: 12px; color: var(--it-text-sub); text-align: center; margin: 10px 0 0; }

.done-box { text-align: center; padding: 10px 0; }
.done-box h3 { margin: 10px 0 6px; font-size: 17px; }
.done-box p { color: var(--it-text-sub); font-size: 13px; margin: 4px 0; }
.no-box {
  font-size: 20px; font-weight: 700; letter-spacing: 1px; color: var(--it-primary);
  background: var(--it-primary-light); border-radius: 10px; padding: 12px 0; margin: 10px 0;
}
.done-box .tip { font-size: 12px; margin-bottom: 14px; }

.result { margin-top: 18px; border-top: 1px dashed var(--it-border); padding-top: 14px; }
.r-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.r-no { font-size: 12px; color: var(--it-text-sub); }
.r-line { display: flex; gap: 10px; font-size: 13px; padding: 4px 0; }
.r-line span { color: var(--it-text-sub); width: 42px; flex: none; }
.r-line b { font-weight: 500; word-break: break-all; }
.r-result { margin-top: 12px; background: var(--it-bg); border-radius: 10px; padding: 12px; }
.r-result .label { font-size: 12px; color: var(--it-text-sub); margin-bottom: 6px; }
.r-result p { margin: 0; font-size: 13px; line-height: 1.7; white-space: pre-wrap; }
.rate-box { margin-top: 16px; }
.rate-box .label { font-size: 13px; margin-bottom: 8px; }
.rated { margin-top: 14px; font-size: 13px; color: var(--it-text-sub); }
.pub-foot { text-align: center; margin-top: 16px; font-size: 13px; }
.pub-foot a { color: var(--it-text-sub); text-decoration: none; }
</style>
