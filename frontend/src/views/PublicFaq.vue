<!--
  自助常见问题 —— IT 运维工单台账与日报自动管理系统
  免登录的员工自助问答页，支持关键词搜索

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.1
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="pub-page">
    <!-- 免登录门户头：与报障页同一套视觉，员工从二维码进来不用重新认门 -->
    <div class="pub-head">
      <div class="logo">IT</div>
      <div>
        <h1>常见问题自助查询</h1>
        <p>先查一查，很多问题可以自己解决</p>
      </div>
    </div>

    <div class="pub-card">
      <!-- 关键词搜索：回车、清空都直接触发查询；公网页不做分页，一次返回全部匹配项 -->
      <el-input v-model="keyword" placeholder="输入关键词搜索，如：打印机、VPN、密码" size="large" clearable
        @keyup.enter="search" @clear="search">
        <template #append>
          <el-button @click="search"><el-icon><Search /></el-icon></el-button>
        </template>
      </el-input>

      <!-- 三种空态分开提示：门户关闭 / 缺密钥 / 搜不到，处理方式完全不同，混成一句用户会走错路 -->
      <div v-if="!enable" class="empty">
        <el-icon size="36" color="var(--it-text-sub)"><InfoFilled /></el-icon>
        <p>自助门户暂未开放，请联系 IT。</p>
      </div>

      <div v-else-if="needKey" class="empty">
        <el-icon size="36" color="var(--it-text-sub)"><InfoFilled /></el-icon>
        <p>请通过公司内部的常见问题链接或二维码访问。</p>
      </div>

      <div v-else-if="!list.length" class="empty">
        <el-icon size="36" color="var(--it-text-sub)"><Search /></el-icon>
        <p>没有找到相关问题，可以直接提交报障。</p>
        <el-button type="primary" plain size="small" @click="goReport">去报障</el-button>
      </div>

      <div v-else class="faq-list">
        <!-- 手风琴：一次只展开一条，正文按需拉取，列表阶段不把全文塞进一次响应 -->
        <div v-for="(item, i) in list" :key="item.kb_id" class="faq-item">
          <div class="faq-q" @click="toggle(item)">
            <span class="idx">{{ i + 1 }}</span>
            <div class="q-main">
              <div class="q-title">{{ item.problem_summary }}</div>
              <div class="q-meta">
                <el-tag v-if="item.app_system" size="small" effect="plain">{{ item.app_system }}</el-tag>
                <el-tag v-if="item.problem_type" size="small" type="info" effect="plain">{{ item.problem_type }}</el-tag>
                <span v-if="item.faq_hits" class="hits">{{ item.faq_hits }} 人看过</span>
              </div>
            </div>
            <el-icon class="arrow" :class="{ open: openId === item.kb_id }"><ArrowRight /></el-icon>
          </div>
          <div v-show="openId === item.kb_id" class="faq-a">
            <!-- 正文单独请求：展开时才发，避免一屏十条问答全部预加载 -->
            <div v-if="detailLoading" class="loading">加载中…</div>
            <p v-else class="answer">{{ plain(detail && detail.solution) || '暂无详细说明' }}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="pub-foot">
      <router-link :to="{ path: '/report', query: { k: key } }">没有找到答案？点这里报障 →</router-link>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search, ArrowRight, InfoFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import R from '../api'

const route = useRoute()
const router = useRouter()
// 入口密钥：从 URL query.k 透传，后端据此判断门户是否对该链接开放；
// 页脚的「去报障」也要带着它跳，否则对端会判定缺密钥。
const key = String(route.query.k || '')

const keyword = ref('')
// 搜索结果列表，只含标题/摘要/标签，正文另行按需拉取
const list = ref([])
// 门户总开关：后台关掉后整页只留一句提示
const enable = ref(true)
// 缺少或错误密钥标记：与「门户关闭」区分开，提示语不同
const needKey = ref(false)
// 当前展开的条目 id，null 表示全部收起
const openId = ref(null)
// 当前展开条目的详情（含 solution 正文），切换条目时先清空避免串内容
const detail = ref(null)
const detailLoading = ref(false)

// 搜索问答。走 /api/public/faq：免登录接口只回标题摘要，
// 同时把 enable / need_key 一起带回来，前端不必再单独请求一次配置。
async function search() {
  try {
    const r = await R.publicFaq({ keyword: keyword.value, k: key })
    enable.value = !!r.enable
    needKey.value = !!r.need_key
    list.value = r.list || []
    openId.value = null
  } catch (e) { ElMessage.error(e.message) }
}

// 展开 / 收起。点已展开的条目即收起；切换条目时先清空 detail 并置 loading，
// 否则会先闪一下上一条的答案再被替换。
async function toggle(item) {
  if (openId.value === item.kb_id) { openId.value = null; return }
  openId.value = item.kb_id
  detail.value = null
  detailLoading.value = true
  try { detail.value = await R.publicFaqDetail(item.kb_id, key) } catch (e) { ElMessage.error(e.message) } finally { detailLoading.value = false }
}

// 知识库正文可能含 Markdown 加粗标记，展示时去掉星号
function plain(t) { return String(t || '').replace(/\*\*/g, '').trim() }

// 跳报障页：把入口密钥原样带过去，员工不用再扫一次码
function goReport() { router.push({ path: '/report', query: { k: key } }) }

// 首次进入按空关键词查一遍，先把热门问答铺满页面，用户可能不用搜就找到答案
onMounted(search)
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
.pub-card { background: var(--it-card); border-radius: 14px; padding: 18px; box-shadow: 0 6px 24px rgba(31,41,55,0.08); }

.faq-list { margin-top: 14px; }
.faq-item { border-bottom: 1px solid var(--it-border); }
.faq-item:last-child { border-bottom: none; }
.faq-q { display: flex; align-items: flex-start; gap: 10px; padding: 12px 0; cursor: pointer; }
.idx {
  width: 22px; height: 22px; border-radius: 6px; background: var(--it-primary-light); color: var(--it-primary);
  font-size: 12px; display: flex; align-items: center; justify-content: center; flex: none; margin-top: 2px;
}
.q-main { flex: 1; min-width: 0; }
.q-title { font-size: 14px; line-height: 1.5; color: var(--it-text); }
.q-meta { display: flex; align-items: center; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.hits { font-size: 12px; color: var(--it-text-sub); }
.arrow { color: var(--it-text-sub); transition: transform 0.2s; margin-top: 3px; }
.arrow.open { transform: rotate(90deg); }
.faq-a { padding: 0 0 14px 32px; }
.answer { font-size: 13px; line-height: 1.9; color: var(--it-text); margin: 0; white-space: pre-wrap; }
.loading { font-size: 12px; color: var(--it-text-sub); }

.empty { text-align: center; padding: 34px 0 20px; }
.empty p { font-size: 13px; color: var(--it-text-sub); margin: 10px 0 12px; }
.pub-foot { text-align: center; margin-top: 16px; font-size: 13px; }
.pub-foot a { color: var(--it-text-sub); text-decoration: none; }
</style>
