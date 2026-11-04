<!--
  后台主框架 —— IT 运维工单台账与日报自动管理系统
  侧边栏导航、顶栏通知与用户菜单、待办抽屉入口

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.2
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <el-container class="layout">
    <!-- 桌面端左侧菜单 -->
    <el-aside v-if="!isMobile" :width="collapsed ? '64px' : '210px'" class="aside">
      <div class="logo">
        <el-icon class="logo-icon"><Monitor /></el-icon>
        <span v-show="!collapsed" class="logo-text">运维工单系统</span>
      </div>
      <el-menu :default-active="activeMenu" :collapse="collapsed" :collapse-transition="false" router>
        <template v-for="g in menus" :key="g.title">
          <div v-show="!collapsed" class="menu-group">{{ g.title }}</div>
          <el-menu-item v-for="m in g.items" :key="m.path" :index="m.path">
            <el-icon><component :is="m.icon" /></el-icon>
            <template #title>{{ m.title }}</template>
          </el-menu-item>
        </template>
      </el-menu>
      <!-- 版权与版本：侧边栏是纵向 flex，菜单区自己滚动，这一行钉在底部；
           折叠态隐藏，避免 64px 宽度里挤不下一行字 -->
      <div v-show="!collapsed" class="aside-copy">© 2026 锦轩 · v{{ appVersion }}</div>
    </el-aside>

    <!-- 移动端抽屉菜单 -->
    <el-drawer v-if="isMobile" v-model="drawer" direction="ltr" size="320px" :with-header="false" class="m-drawer">
      <div class="aside m-aside">
        <div class="logo">
          <el-icon class="logo-icon"><Monitor /></el-icon>
          <span class="logo-text">运维工单系统</span>
        </div>
        <el-menu :default-active="activeMenu" router @select="drawer = false" class="m-menu">
          <template v-for="g in mobileMenus" :key="g.title">
            <div class="menu-group">{{ g.title }}</div>
            <el-menu-item v-for="m in g.items" :key="m.path" :index="m.path">
              <el-icon><component :is="m.icon" /></el-icon>
              <template #title>{{ m.title }}</template>
            </el-menu-item>
          </template>
        </el-menu>
        <div class="m-drawer-foot">
          <span>{{ userStore.realName }} · {{ userStore.roleLabel }}</span>
          <el-button link type="primary" @click="goSettings">系统设置</el-button>
        </div>
      </div>
    </el-drawer>

    <!-- 右侧主体 -->
    <el-container>
      <el-header class="header" :class="{ 'm-header': isMobile }">
        <div class="header-left">
          <el-icon v-if="isMobile" class="collapse-btn" @click="drawer = true"><Menu /></el-icon>
          <el-icon v-else class="collapse-btn" @click="collapsed = !collapsed">
            <Fold v-if="!collapsed" /><Expand v-else />
          </el-icon>
          <span class="sys-name it-hide-mobile">IT 运维工单台账与日报自动管理系统</span>
          <!-- 手机端空间有限，顶栏改显示当前页名，比重复系统全名有用 -->
          <span v-if="isMobile" class="sys-name-m">{{ pageTitle }}</span>
        </div>
        <div class="header-right">
          <!-- 快捷新建工单：审计员只读所以不显示；手机端走抽屉菜单，顶栏不塞按钮 -->
          <el-button v-if="!userStore.isAuditor && !isMobile" type="primary" size="small" @click="goQuick">
            <el-icon><Plus /></el-icon> 快速录入
          </el-button>
          <span class="date it-hide-mobile">{{ todayText }}</span>
          <!-- 用户菜单：角色只做展示，不提供切换，避免误以为可以自降权限 -->
          <el-dropdown @command="onUserCmd">
            <span class="user-box">
              <el-avatar :size="28" class="user-avatar">{{ userStore.realName.charAt(0) }}</el-avatar>
              <span class="user-name it-hide-mobile">{{ userStore.realName }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="role">{{ userStore.roleLabel }}</el-dropdown-item>
                <el-dropdown-item command="settings"><el-icon><Tools /></el-icon> 系统设置</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>

    <!-- 右侧浮动待办面板（审计员只读；移动端隐藏，避免遮挡内容） -->
    <TodoPanel v-if="!userStore.isAuditor && !isMobile" />
    <!-- 右下角新工单接单提醒（员工报障后实时弹出） -->
    <NewTicketPopup v-if="!userStore.isAuditor" />
  </el-container>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../store/user'
import TodoPanel from './TodoPanel.vue'
import NewTicketPopup from './NewTicketPopup.vue'
import { startRealtime, stopRealtime } from '../utils/realtime'
import { loadWorkflow } from '../utils/workflow'

// 构建期注入（vite.config.js 的 define），侧边栏底部展示版权与版本
const appVersion = __APP_VERSION__

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const collapsed = ref(false)
const drawer = ref(false)
const isMobile = ref(false)
// 菜单项的 index 就是路由 path，所以当前高亮直接由 route.path 推导，不用额外的菜单状态
const activeMenu = computed(() => route.path)
// 只在挂载时算一次：顶栏日期不需要随时间自动跳，刷新页面即可
const todayText = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })

// 菜单按业务分组，桌面/移动共用一份配置
// 角色过滤全部在这里做：viewAll 控制团队数据类页面，admin 控制系统配置类页面，
// notAuditor 控制所有写操作页面（与路由守卫的 meta 标记严格对应，两边必须一起改）
const menus = computed(() => {
  const viewAll = userStore.canViewAll
  const admin = userStore.isAdmin
  const notAuditor = !userStore.isAuditor
  const groups = [
    // 工作台：看板人人可见；团队运营分析只有能看全员数据的人才有意义
    {
      title: '工作台',
      items: [
        { path: '/dashboard', icon: 'DataLine', title: '数据看板', m: true },
        ...(viewAll ? [{ path: '/analytics', icon: 'TrendCharts', title: '团队运营分析', m: true }] : [])
      ]
    },
    // 运维工作：日常录单、处理、巡检、知识沉淀都在这一组
    {
      title: '运维工作',
      items: [
        ...(notAuditor ? [{ path: '/ticket-create', icon: 'EditPen', title: '工单录入', m: true }] : []),
        { path: '/tickets', icon: 'Tickets', title: '工单记录管理', m: true },
        // 审计员是只读账号：故障/巡检/待办/目标/项目/日报/AI 这些写操作页面对应路由都是 meta.write，
        // 菜单里必须一起隐藏，否则点进去会被守卫弹回团队分析，看起来像坏了
        ...(notAuditor ? [
          { path: '/incidents', icon: 'Warning', title: '故障管理', m: true },
          { path: '/inspections', icon: 'Location', title: '机房巡检', m: true },
          { path: '/maintenances', icon: 'Cpu', title: '服务器维护台账', m: true },
          // 账号与权限台账是日常运维动作（开通/变更/注销随手登记），归到运维工作而不是管理组
          { path: '/accounts', icon: 'Key', title: '账号与权限台账' },
          { path: '/todos', icon: 'Bell', title: '待办任务管理', m: true },
          { path: '/goals', icon: 'Aim', title: '月度目标管理' },
          { path: '/projects', icon: 'FolderOpened', title: '项目管理', m: true }
        ] : []),
        { path: '/knowledge', icon: 'Reading', title: '个人运维知识库', m: true },
        { path: '/faq-manage', icon: 'ChatDotSquare', title: '常见问题管理' },
        ...(notAuditor ? [
          { path: '/daily-report', icon: 'Notebook', title: '日报生成' },
          { path: '/monthly-report', icon: 'Document', title: '月度工作报告' },
          { path: '/ai-assistant', icon: 'MagicStick', title: 'AI 助手' }
        ] : [])
      ]
    },
    // 管理与报表：导出、团队查阅、系统配置，按角色逐项叠加
    {
      title: '管理与报表',
      items: [
        { path: '/report-export', icon: 'Download', title: '报表导出' },
        ...(viewAll ? [{ path: '/report-review', icon: 'Notebook', title: '日报月报查阅', m: true }] : []),
        ...(admin ? [
          { path: '/sla', icon: 'Timer', title: 'SLA 时效策略' },
          { path: '/dictionary', icon: 'Setting', title: '基础字典维护' },
          { path: '/users', icon: 'User', title: '账号管理' }
        ] : []),
        ...(viewAll ? [{ path: '/audit-logs', icon: 'DocumentChecked', title: '操作审计日志' }] : []),
        { path: '/settings', icon: 'Tools', title: '系统设置' },
        // 版权与第三方许可：交付部署后客户能自己查到授权范围与组件清单
        { path: '/about', icon: 'InfoFilled', title: '关于与开源许可' }
      ]
    }
  ]
  // 空分组直接丢掉：普通工程师看不到管理组的管理员项，留着标题会显得菜单断了一截
  return groups.filter(g => g.items.length)
})

// 手机端只保留高频操作入口，报表/台账/字典/审计等桌面端功能不上手机，菜单更清爽
const mobileMenus = computed(() =>
  menus.value
    .map(g => ({ title: g.title, items: g.items.filter(m => m.m) }))
    .filter(g => g.items.length)
)

// 手机端顶部显示当前页面名（比系统全名有用）
const pageTitle = computed(() => {
  const all = menus.value.flatMap(g => g.items)
  const hit = all.find(m => route.path === m.path)
  return hit ? hit.title : '运维工单系统'
})

// 移动端抽屉底部的「系统设置」入口：先关抽屉再跳，否则路由变了抽屉还盖在页面上
function goSettings() {
  drawer.value = false
  router.push('/settings')
}

// 断点 820px 与 CSS 里的 @media (max-width: 820px) 必须保持一致，
// 否则会出现「JS 判定为桌面、样式按移动端排版」的错位
function checkMobile() {
  isMobile.value = window.innerWidth <= 820
  if (!isMobile.value) drawer.value = false
}
onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
  // 实时消息只在主框架里建一条连接，供接单弹窗 / 待办面板共用
  startRealtime()
  // 抢单/派单模式影响全站文案，进主框架就先拉一次
  loadWorkflow()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', checkMobile)
  // 退出登录会卸载主框架，这里必须断开 SSE，否则旧 token 的连接会一直重连
  stopRealtime()
})

// 快速录入：带上 mode=quick，工单页据此切成紧凑双列排版，一屏就能填完
function goQuick() {
  router.push('/ticket-create?mode=quick')
}
function onUserCmd(cmd) {
  if (cmd === 'logout') {
    // 先清本地状态再跳，避免守卫看到残留 token 又把用户弹回业务页
    userStore.logout()
    router.replace('/login')
  } else if (cmd === 'settings') {
    router.push('/settings')
  }
}
</script>

<style scoped>
.layout { height: 100vh; }
.aside {
  background: var(--it-sidebar-bg);
  transition: width 0.2s;
  overflow-y: auto;
  overflow-x: hidden;
  /* 纵向 flex：菜单区自己滚动，版权行钉在底部，永远不需要滚到底才看得见 */
  display: flex;
  flex-direction: column;
}
/* 菜单透明化，由 aside 统一底色，激活项用主题主色，使主题贯穿左侧菜单 */
.aside :deep(.el-menu) { background: transparent; border-right: none; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.aside :deep(.el-menu-item) { background: transparent; color: #c5cde0; }
.aside :deep(.el-menu-item:hover) { background: rgba(255, 255, 255, 0.08) !important; color: #fff; }
.aside :deep(.el-menu-item.is-active) { background: var(--it-primary) !important; color: #fff; }
.aside :deep(.el-menu-item.is-active::after) { display: none; }
.menu-group {
  font-size: 11px; color: rgba(197, 205, 224, 0.5); padding: 14px 20px 6px;
  letter-spacing: 0.5px; white-space: nowrap;
}
/* 版权行：比菜单文字更淡，避免在深色侧边栏里抢注意力 */
.aside-copy {
  padding: 18px 20px 22px;
  font-size: 11px;
  color: rgba(197, 205, 224, 0.4);
  white-space: nowrap;
  letter-spacing: 0.2px;
}
.logo {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  color: #fff;
  background: var(--it-sidebar-bg-2);
  font-weight: 600;
}
.logo-icon { font-size: 22px; color: var(--it-primary); }
.logo-text { white-space: nowrap; }
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid var(--it-border);
  height: 56px;
}
.header.m-header { padding: 0 10px 0 6px; height: 56px; }
/* 手机端菜单按钮：固定 42×42 点击区 + 26px 图标
   注意：el-icon 默认 width/height 是 1em，如果再加 padding，在 border-box 下
   内容宽度会被压成 1em - 2*padding（之前 22-18=4px，图标成了一条细线），
   所以这里必须显式给宽高、padding 归零，再单独指定 svg 尺寸 */
.header.m-header .collapse-btn {
  width: 42px; height: 42px; min-width: 42px;
  padding: 0; margin: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 26px; line-height: 1;
  border-radius: 10px;
  background: rgba(64, 128, 255, 0.10);
  transition: background .15s;
}
.header.m-header .collapse-btn svg { width: 26px; height: 26px; }
.header.m-header .collapse-btn:active { background: rgba(64, 128, 255, 0.24); }
.header.m-header .header-left { gap: 10px; }
.header.m-header .sys-name-m { font-size: 16px; }
.header.m-header .header-right { gap: 10px; }
.header.m-header .user-box .el-icon { font-size: 18px; }
.header.m-header .user-box .el-icon svg { width: 18px; height: 18px; }
.header-left { display: flex; align-items: center; gap: 14px; }
.collapse-btn { font-size: 20px; cursor: pointer; color: #5a6478; }
.sys-name { font-weight: 600; color: #2b3245; }
.sys-name-m { font-weight: 600; color: #2b3245; font-size: 14px; }
.header-right { display: flex; align-items: center; gap: 16px; }
.date { color: var(--it-text-sub); }
.user-box { display: flex; align-items: center; gap: 6px; cursor: pointer; outline: none; }
.user-avatar { background: var(--it-primary); color: #fff; }
.user-name { color: #2b3245; }
.main { background: var(--it-bg); padding: 0; overflow-y: auto; }

.m-aside { height: 100%; }

/* 手机端抽屉：大图标 + 大字号 + 大行高，手指点得准、看着不费劲 */
.m-aside { display: flex; flex-direction: column; }
.m-menu { flex: 1; padding: 4px 0 10px; }
.m-menu :deep(.el-menu-item) {
  height: 56px; line-height: 56px; font-size: 17px; font-weight: 500;
  padding-left: 20px !important; margin: 0 10px 5px; border-radius: 10px;
}
.m-menu :deep(.el-menu-item .el-icon) { font-size: 24px; width: 24px; height: 24px; margin-right: 14px; }
.m-menu :deep(.el-menu-item .el-icon svg) { width: 24px; height: 24px; }
.m-menu .menu-group { padding: 16px 22px 8px; font-size: 12.5px; letter-spacing: 1px; color: rgba(197, 205, 224, 0.62); }
.m-drawer-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 13.5px; color: rgba(197, 205, 224, 0.8);
}
.m-drawer-foot :deep(.el-button) { color: #9ec2ff; font-size: 14px; }
</style>

<style>
/* 移动端抽屉：内部菜单延续深色侧边栏风格（不能用 scoped，抽屉挂在 body 上） */
.m-drawer .el-drawer__body { padding: 0; background: var(--it-sidebar-bg); }

/* 手机端菜单：显式给 svg 尺寸，避免被 Element 默认样式压小（图标太小很难点） */
.m-drawer .el-menu-item .el-icon { width: 24px; height: 24px; font-size: 24px; margin-right: 14px; }
.m-drawer .el-menu-item .el-icon svg { width: 24px; height: 24px; }
.m-drawer .el-menu-item .el-icon + .el-menu-tooltip__trigger,
.m-drawer .el-menu-item span { font-size: 17px; font-weight: 500; }
.m-drawer .el-menu-item { height: 56px; line-height: 56px; }
.m-drawer .logo { height: 64px; font-size: 17px; }
.m-drawer .logo-icon { font-size: 24px; }
</style>
