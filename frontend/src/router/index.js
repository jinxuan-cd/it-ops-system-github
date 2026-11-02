/**
 * @file frontend/src/router/index.js
 * @description 路由表定义，以及登录态、管理员、查看全部、只读账号的访问控制
 *
 * 路由与权限守卫 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
import { createRouter, createWebHistory } from 'vue-router'

// 从 localStorage 读角色：守卫在组件挂载前就要跑，此时 Pinia 可能还没初始化，只能直接读存储。
// 解析失败按「无角色」处理，宁可拦下来也不能放行
function roleOf() {
  try {
    const u = JSON.parse(localStorage.getItem('itops_user') || 'null')
    return (u && u.role) || ''
  } catch (e) { return '' }
}

// 路由分层：
//   meta.public —— 免登录可访问（登录页、扫码报障、常见问题门户）
//   meta.admin  —— 仅 admin（用户/字典/SLA 这类系统配置）
//   meta.viewAll—— admin + auditor（团队分析与审计日志属于「看全员数据」）
//   meta.write  —— 除 auditor 外可进（审计员是只读账号，写操作页面直接拦掉）
// 其余未标 meta 的页面只要登录即可
const routes = [
  { path: '/login', name: 'Login', component: () => import('../views/Login.vue'), meta: { public: true } },
  // 免登录：扫码报障入口 + 常见问题自助门户（对外分享用，不需要账号）
  { path: '/report', name: 'PublicReport', component: () => import('../views/PublicReport.vue'), meta: { public: true } },
  { path: '/faq', name: 'PublicFaq', component: () => import('../views/PublicFaq.vue'), meta: { public: true } },
  // 后台业务页统一挂在 MainLayout 下（侧边栏 + 顶栏 + 待办面板），默认落到数据看板
  {
    path: '/',
    component: () => import('../layout/MainLayout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'Dashboard', component: () => import('../views/Dashboard.vue') },
      // 团队运营分析：管理员 / 审计员
      { path: 'analytics', name: 'Analytics', component: () => import('../views/Analytics.vue'), meta: { viewAll: true } },
      { path: 'ticket-create', name: 'TicketCreate', component: () => import('../views/TicketCreate.vue'), meta: { write: true } },
      // 工单记录管理：所有登录用户都能进，能看到哪些单由后端按角色过滤（工程师默认只看自己名下）
      { path: 'tickets', name: 'TicketManage', component: () => import('../views/TicketManage.vue') },
      { path: 'incidents', name: 'IncidentManage', component: () => import('../views/IncidentManage.vue'), meta: { write: true } },
      { path: 'inspections', name: 'Inspection', component: () => import('../views/Inspection.vue'), meta: { write: true } },
      { path: 'accounts', name: 'AccountLedger', component: () => import('../views/AccountLedger.vue'), meta: { write: true } },
      { path: 'todos', name: 'TodoManage', component: () => import('../views/TodoManage.vue'), meta: { write: true } },
      { path: 'goals', name: 'GoalManage', component: () => import('../views/GoalManage.vue'), meta: { write: true } },
      { path: 'projects', name: 'ProjectManage', component: () => import('../views/ProjectManage.vue'), meta: { write: true } },
      { path: 'knowledge', name: 'KnowledgeBase', component: () => import('../views/KnowledgeBase.vue') },
      // 常见问题（公开到员工自助门户的问答）维护
      { path: 'faq-manage', name: 'FaqManage', component: () => import('../views/FaqManage.vue') },
      { path: 'dictionary', name: 'Dictionary', component: () => import('../views/Dictionary.vue'), meta: { admin: true } },
      { path: 'users', name: 'UserManage', component: () => import('../views/UserManage.vue'), meta: { admin: true } },
      { path: 'sla', name: 'SlaSetting', component: () => import('../views/SlaSetting.vue'), meta: { admin: true } },
      { path: 'audit-logs', name: 'AuditLog', component: () => import('../views/AuditLog.vue'), meta: { viewAll: true } },
      { path: 'daily-report', name: 'DailyReport', component: () => import('../views/DailyReport.vue'), meta: { write: true } },
      { path: 'report-export', name: 'ReportExport', component: () => import('../views/ReportExport.vue') },
      { path: 'monthly-report', name: 'MonthlyReport', component: () => import('../views/MonthlyReport.vue'), meta: { write: true } },
      // 日报月报查阅：管理员 / 审计员看全员提交情况与内容
      { path: 'report-review', name: 'ReportReview', component: () => import('../views/ReportReview.vue'), meta: { viewAll: true } },
      { path: 'ai-assistant', name: 'AiAssistant', component: () => import('../views/AiAssistant.vue'), meta: { write: true } },
      { path: 'settings', name: 'Settings', component: () => import('../views/Settings.vue') },
      // 关于与开源许可：所有人可看。放在这里是为了部署交付时客户能自己找到
      // 版权归属、授权范围与第三方组件清单，不用去翻源码仓库。
      { path: 'about', name: 'About', component: () => import('../views/About.vue') }
    ]
  }
]

const router = createRouter({
  // history 模式：URL 里没有 #，二维码/分享链接更干净；代价是部署时要配 try_files 回退到 index.html
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  const token = localStorage.getItem('itops_token')
  // 第一层：登录态。非 public 页没 token 一律去登录页；已登录再访问 /login 就回看板
  if (!to.meta.public && !token) return { path: '/login' }
  if (to.path === '/login' && token) return { path: '/dashboard' }

  const role = roleOf()
  // 第二层：管理员专属页面（用户管理、字典、SLA）
  if (to.meta.admin && role !== 'admin') return { path: '/dashboard' }
  // 第三层：看全员数据的页面（团队分析、审计日志、日报月报查阅），管理员 + 审计员
  if (to.meta.viewAll && !['admin', 'auditor'].includes(role)) return { path: '/dashboard' }
  // 第四层：审计员为只读账号，写操作页面一律回到团队分析（有权限看的那一页）
  if (to.meta.write && role === 'auditor') return { path: '/analytics' }
  return true
})

export default router
