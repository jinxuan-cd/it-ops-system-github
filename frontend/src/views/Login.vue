<!--
  登录页 —— IT 运维工单台账与日报自动管理系统
  账号密码 + 图形验证码登录，含锁定提示与品牌展示

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.1
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="login-wrap">
    <!-- 单卡片布局：左侧品牌信息与登录表单同屏，小团队单入口够用，不做多标签页 -->
    <div class="login-card">
      <div class="brand">
        <el-icon class="brand-icon"><Monitor /></el-icon>
        <div>
          <div class="brand-title">IT 运维工单系统</div>
          <div class="brand-sub">工单台账 · 日报自动生成 · 知识沉淀</div>
        </div>
      </div>

      <!-- 锁定横幅：剩余时间由后端下发，前端只负责倒计时展示，改本地时间绕不过去 -->
      <el-alert
        v-if="lockRemain > 0"
        type="error"
        :closable="false"
        show-icon
        class="lock-alert"
        :title="`账号已锁定，请 ${lockText} 后再试`"
      />

      <!-- 登录表单：锁定期间整体禁用，避免用户在锁定中继续提交、把失败次数越堆越多 -->
      <el-form :model="form" @submit.prevent="onLogin" size="large">
        <el-form-item>
          <el-input
            v-model="form.username"
            placeholder="登录账号"
            :prefix-icon="User"
            :disabled="lockRemain > 0"
          />
        </el-form-item>
        <el-form-item>
          <el-input
            v-model="form.password"
            type="password"
            placeholder="密码"
            :prefix-icon="Lock"
            show-password
            :disabled="lockRemain > 0"
            @keyup.enter="onLogin"
          />
        </el-form-item>

        <!-- 连续输错 3 次后强制验证码 -->
        <el-form-item v-if="needCaptcha">
          <!-- 验证码一次性有效：提交一次即作废，所以每次失败都由脚本换新图，点图片也可手动刷新 -->
          <div class="captcha-row">
            <el-input
              v-model="form.captcha_code"
              placeholder="验证码"
              :prefix-icon="Key"
              maxlength="4"
              :disabled="lockRemain > 0"
              @keyup.enter="onLogin"
            />
            <!-- 图片未取到（接口异常或未开放）时退化为「获取」按钮，避免出现破图 -->
            <img
              v-if="captchaImg"
              class="captcha-img"
              :src="captchaImg"
              alt="点击刷新验证码"
              title="看不清？点击刷新"
              @click="refreshCaptcha"
            />
            <el-button v-else text :loading="captchaLoading" @click="refreshCaptcha">获取</el-button>
          </div>
        </el-form-item>

        <!-- 按钮文案跟随锁定状态切换，让用户一眼分清「被锁定」和「密码输错」 -->
        <el-button
          type="primary"
          :loading="loading"
          class="login-btn"
          :disabled="lockRemain > 0"
          @click="onLogin"
        >{{ lockRemain > 0 ? '已锁定' : '登 录' }}</el-button>
      </el-form>

      <div class="hint">忘记密码请联系系统管理员重置</div>

      <!-- 版权与版本：构建期由 vite define 注入，登录页是未登录用户唯一能看到的界面，放这里最自然 -->
      <div class="login-copy">{{ copy }} · v{{ appVersion }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { User, Lock, Key } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import R from '../api'
import { useUserStore } from '../store/user'

// 构建期注入的常量（vite.config.js 的 define），不是模块导入，不要改成 import
const appVersion = __APP_VERSION__
const copy = __APP_COPYRIGHT__

// 登录成功后用 replace 进看板：登录页不留在历史栈，避免回退后又被守卫弹回登录页
const router = useRouter()
const userStore = useUserStore()
// 登录表单三件套：captcha_id 与用户输入的码必须成对提交，后端按 id 取答案后立即作废
const form = ref({ username: '', password: '', captcha_code: '' })
const loading = ref(false)

// 验证码 / 锁定状态
// 验证码默认不显示，只有后端返回 needCaptcha（连续输错达阈值）时才出现，首屏不打扰用户
const needCaptcha = ref(false)
// 验证码图片（dataURL 形式），空串表示还没拿到图，模板据此决定渲染图片还是「获取」按钮
const captchaImg = ref('')
// 验证码 id：与当前图片一一对应，提交时回传，避免前端自己猜答案
const captchaId = ref('')
// 单独拉码的 loading：刷新很快，但仍要防连点导致拿到两张图、用错 id
const captchaLoading = ref(false)
const lockRemain = ref(0) // 锁定剩余秒数
// 倒计时句柄：组件卸载或重新锁定时必须清掉，否则定时器会继续改一个已卸载组件的状态
let lockTimer = null

// 把剩余秒数格式化成「x 分 xx 秒」：锁定提示里直接展示，避免用户自己心算
const lockText = computed(() => {
  const s = lockRemain.value
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m} 分 ${String(r).padStart(2, '0')} 秒` : `${r} 秒`
})

// 取一张新验证码。验证码一次性有效，任何一次提交失败后都必须换新的：
// 沿用旧 id 会被后端判为已用，用户即使输对也过不去。
// 取图失败就把图片清空，让界面回落到「获取」按钮，不让用户对着破图输码。
async function refreshCaptcha() {
  captchaLoading.value = true
  try {
    const d = await R.getCaptcha()
    captchaImg.value = d.image
    captchaId.value = d.captcha_id
    form.value.captcha_code = ''
  } catch (e) {
    captchaImg.value = ''
  } finally {
    captchaLoading.value = false
  }
}

// 启动锁定倒计时。秒数以后端返回的 lockRemain 为准（缺省 300 秒），前端只做展示：
// 本地时间被改或刷新页面都改变不了锁定事实。
// 归零后自动解锁并强制拉一张验证码，用户不用刷新页面就能继续登录。
function startLockCountdown(seconds) {
  lockRemain.value = Math.max(0, Math.ceil(seconds || 0))
  if (lockTimer) clearInterval(lockTimer)
  lockTimer = setInterval(() => {
    lockRemain.value -= 1
    if (lockRemain.value <= 0) {
      lockRemain.value = 0
      clearInterval(lockTimer)
      lockTimer = null
      needCaptcha.value = true
      refreshCaptcha()
      ElMessage.info('锁定已解除，请输入验证码后重试')
    }
  }, 1000)
}

// 登录主流程：本地先做必填校验，扣掉一次无谓的失败计数，再带 captcha_id + 输入码调接口。
// 失败必须分两种口径提示：locked 说明账号已被锁、走倒计时；否则是密码/验证码错，只提示不锁。
// 后端要求出验证码时立刻换新图——旧码已随刚才那次提交失效，续用等于必然再错一次。
async function onLogin() {
  if (lockRemain.value > 0) return
  if (!form.value.username || !form.value.password) {
    ElMessage.warning('请输入账号和密码')
    return
  }
  if (needCaptcha.value && !form.value.captcha_code) {
    ElMessage.warning('请输入验证码')
    return
  }
  loading.value = true
  try {
    const data = await R.login(form.value.username, form.value.password, {
      captcha_id: captchaId.value,
      captcha_code: form.value.captcha_code
    })
    userStore.setAuth(data.token, data.user)
    ElMessage.success('登录成功')
    router.replace('/dashboard')
  } catch (e) {
    const info = e.data || {}
    if (info.locked) {
      startLockCountdown(info.lockRemain || 300)
      ElMessage.error(e.message)
    } else {
      ElMessage.error(e.message)
    }
    // 需要验证码：显示并立即刷新一张新图（旧码一次性失效）
    if (info.needCaptcha) {
      needCaptcha.value = true
      await refreshCaptcha()
    }
  } finally {
    loading.value = false
  }
}

// 离开页面必须清掉倒计时，否则路由跳走后定时器仍在跑
onBeforeUnmount(() => {
  if (lockTimer) clearInterval(lockTimer)
})
</script>

<style scoped>
.login-wrap {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--el-color-primary-dark-2, #2f6fed) 0%, var(--it-primary, #2f6fed) 100%);
}
.login-card {
  width: 360px;
  background: #fff;
  border-radius: 16px;
  padding: 32px 28px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
}
.brand { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.brand-icon { font-size: 40px; color: var(--it-primary); }
.brand-title { font-size: 18px; font-weight: 700; }
.brand-sub { font-size: 12px; color: var(--it-text-sub); margin-top: 2px; }
.login-btn { width: 100%; }
.hint { margin-top: 16px; font-size: 12px; color: var(--it-text-sub); text-align: center; line-height: 1.6; }
/* 版权行比提示弱一档，不抢登录表单的视觉重心 */
.login-copy { margin-top: 10px; font-size: 11px; color: #a2adc0; text-align: center; letter-spacing: 0.2px; }
.lock-alert { margin-bottom: 14px; }
.captcha-row { display: flex; align-items: center; gap: 10px; width: 100%; }
.captcha-row :deep(.el-input) { flex: 1; }
.captcha-img {
  width: 110px;
  height: 38px;
  border-radius: 6px;
  border: 1px solid var(--it-border, #dcdfe6);
  cursor: pointer;
  flex: 0 0 110px;
}
</style>
