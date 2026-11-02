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
          <span v-if="isMobile" class="sys-name-m">{{ pageTitle }}</span>
        </div>
        <div class="header-right">
          <el-button v-if="!userStore.isAuditor && !isMobile" type="primary" size="small" @click="goQuick">
            <el-icon><Plus /></el-icon> 快速录入
          </el-button>
          <span class="date it-hide-mobile">{{ todayText }}</span>
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

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const collapsed = ref(false)
const drawer = ref(false)
const isMobile = ref(false)
const activeMenu = computed(() => route.path)
const todayText = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })

// 菜单按业务分组，桌面/移动共用一份配置
const menus = computed(() => {
  const viewAll = userStore.canViewAll
  const admin = userStore.isAdmin
  const notAuditor = !userStore.isAuditor
  const groups = [
    {
      title: '工作台',
      items: [
        { path: '/dashboard', icon: 'DataLine', title: '数据看板', m: true },
        ...(viewAll ? [{ path: '/analytics', icon: 'TrendCharts', title: '团队运营分析', m: true }] : [])
      ]
    },
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
    {
      title: '管理与报表',
      items: [
        { path: '/report-export', icon: 'Download', title: '报表导出' },
        ...(viewAll ? [{ path: '/report-review', icon: 'Notebook', title: '日报月报查阅', m: true }] : []),
        ...(notAuditor ? [{ path: '/accounts', icon: 'Key', title: '账号与权限台账' }] : []),
        ...(admin ? [
          { path: '/sla', icon: 'Timer', title: 'SLA 时效策略' },
          { path: '/dictionary', icon: 'Setting', title: '基础字典维护' },
          { path: '/users', icon: 'User', title: '账号管理' }
        ] : []),
        ...(viewAll ? [{ path: '/audit-logs', icon: 'DocumentChecked', title: '操作审计日志' }] : []),
        { path: '/settings', icon: 'Tools', title: '系统设置' }
      ]
    }
  ]
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

function goSettings() {
  drawer.value = false
  router.push('/settings')
}

function checkMobile() {
  isMobile.value = window.innerWidth <= 820
  if (!isMobile.value) drawer.value = false
}
onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
  // 实时消息只在主框架里建一条连接，供接单弹窗 / 待办面板共用
  startRealtime()
  loadWorkflow()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', checkMobile)
  stopRealtime()
})

function goQuick() {
  router.push('/ticket-create?mode=quick')
}
function onUserCmd(cmd) {
  if (cmd === 'logout') {
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
}
/* 菜单透明化，由 aside 统一底色，激活项用主题主色，使主题贯穿左侧菜单 */
.aside :deep(.el-menu) { background: transparent; border-right: none; }
.aside :deep(.el-menu-item) { background: transparent; color: #c5cde0; }
.aside :deep(.el-menu-item:hover) { background: rgba(255, 255, 255, 0.08) !important; color: #fff; }
.aside :deep(.el-menu-item.is-active) { background: var(--it-primary) !important; color: #fff; }
.aside :deep(.el-menu-item.is-active::after) { display: none; }
.menu-group {
  font-size: 11px; color: rgba(197, 205, 224, 0.5); padding: 14px 20px 6px;
  letter-spacing: 0.5px; white-space: nowrap;
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
