import { createRouter, createWebHistory } from 'vue-router'

function roleOf() {
  try {
    const u = JSON.parse(localStorage.getItem('itops_user') || 'null')
    return (u && u.role) || ''
  } catch (e) { return '' }
}

const routes = [
  { path: '/login', name: 'Login', component: () => import('../views/Login.vue'), meta: { public: true } },
  // 免登录：扫码报障入口 + 常见问题自助门户（对外分享用，不需要账号）
  { path: '/report', name: 'PublicReport', component: () => import('../views/PublicReport.vue'), meta: { public: true } },
  { path: '/faq', name: 'PublicFaq', component: () => import('../views/PublicFaq.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('../layout/MainLayout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'Dashboard', component: () => import('../views/Dashboard.vue') },
      // 团队运营分析：管理员 / 审计员
      { path: 'analytics', name: 'Analytics', component: () => import('../views/Analytics.vue'), meta: { viewAll: true } },
      { path: 'ticket-create', name: 'TicketCreate', component: () => import('../views/TicketCreate.vue'), meta: { write: true } },
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
      { path: 'settings', name: 'Settings', component: () => import('../views/Settings.vue') }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  const token = localStorage.getItem('itops_token')
  if (!to.meta.public && !token) return { path: '/login' }
  if (to.path === '/login' && token) return { path: '/dashboard' }

  const role = roleOf()
  // 管理员专属页面
  if (to.meta.admin && role !== 'admin') return { path: '/dashboard' }
  // 团队分析：管理员 + 审计员
  if (to.meta.viewAll && !['admin', 'auditor'].includes(role)) return { path: '/dashboard' }
  // 审计员为只读账号，写操作页面一律回到团队分析
  if (to.meta.write && role === 'auditor') return { path: '/analytics' }
  return true
})

export default router
