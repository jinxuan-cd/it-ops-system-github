import axios from 'axios'
import router from '../router'

const api = axios.create({ baseURL: '/api', timeout: 20000 })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('itops_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => {
    const body = res.data
    if (body && body.code === 0) {
      const data = body.data
      // 后端 ok(res, data, message) 里的 message（如「导入完成：成功 12 条」）原来被丢掉了，
      // 挂成不可枚举的属性，页面用 res.__message 就能拿到真实提示
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        try { Object.defineProperty(data, '__message', { value: body.message, enumerable: false, configurable: true }) } catch (e) { /* ignore */ }
      }
      return data
    }
    if (body && body.code) {
      // 业务错误
      if (body.code === 401) {
        localStorage.removeItem('itops_token')
        localStorage.removeItem('itops_user')
        router.replace('/login')
      }
      const e = new Error(body.message || '请求失败')
      // 保留业务附加信息（如登录的 needCaptcha / lockRemain）
      e.data = body.data
      return Promise.reject(e)
    }
    return body
  },
  (err) => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem('itops_token')
      localStorage.removeItem('itops_user')
      router.replace('/login')
    }
    return Promise.reject(err)
  }
)

const R = {
  // 鉴权
  getCaptcha: () => api.get('/auth/captcha'),
  login: (username, password, captcha) => api.post('/auth/login', { username, password, ...(captcha || {}) }),
  getMe: () => api.get('/auth/me'),
  updateMe: (d) => api.put('/auth/me', d),
  changePassword: (d) => api.put('/auth/password', d),

  // 用户（管理员）
  listUsers: () => api.get('/users'),
  createUser: (d) => api.post('/users', d),
  updateUser: (id, d) => api.put(`/users/${id}`, d),
  deleteUser: (id) => api.delete(`/users/${id}`),

  // 工单
  listTickets: (params) => api.get('/tickets', { params }),
  getTicket: (id) => api.get(`/tickets/${id}`),
  createTicket: (d) => api.post('/tickets', d),
  updateTicket: (id, d) => api.put(`/tickets/${id}`, d),
  deleteTicket: (id) => api.delete(`/tickets/${id}`),
  completeTicket: (id, d) => api.post(`/tickets/${id}/complete`, d),
  // 批量操作
  batchDeleteTickets: (ids, params) => api.post('/tickets/batch-delete', { ids }, { params }),
  batchCompleteTickets: (ids, params) => api.post('/tickets/batch-complete', { ids }, { params }),
  batchStatusTickets: (ids, status, params) => api.post('/tickets/batch-status', { ids, status }, { params }),
  uploadFiles: (formData) => api.post('/tickets/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  exportTicketsUrl: (params) => {
    const qs = new URLSearchParams(params).toString()
    return `/api/tickets/export/excel${qs ? '?' + qs : ''}`
  },
  exportTicketsBlob: (params) => api.get('/tickets/export/excel', { params, responseType: 'blob' }),
  importTickets: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/tickets/import/excel', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
  },

  // 待办
  listTodos: (tab) => api.get('/todos', { params: { tab } }),
  pendingToday: () => api.get('/todos/pending/today'),
  createTodo: (d) => api.post('/todos', d),
  updateTodo: (id, d) => api.put(`/todos/${id}`, d),
  deleteTodo: (id) => api.delete(`/todos/${id}`),

  // 月度目标
  listGoals: (month, done) => api.get('/goals', { params: { month, done: done ? '1' : '0' } }),
  createGoal: (d) => api.post('/goals', d),
  updateGoal: (id, d) => api.put(`/goals/${id}`, d),
  deleteGoal: (id) => api.delete(`/goals/${id}`),

  // 知识库
  listKnowledge: (params) => api.get('/knowledge', { params }),
  recommend: (params) => api.get('/knowledge/recommend', { params }),
  getKnowledge: (id) => api.get(`/knowledge/${id}`),
  createKnowledge: (d) => api.post('/knowledge', d),
  updateKnowledge: (id, d) => api.put(`/knowledge/${id}`, d),
  deleteKnowledge: (id) => api.delete(`/knowledge/${id}`),
  aiOrganizeKnowledge: () => api.post('/knowledge/ai-organize', {}, { timeout: 180000 }),
  parseDoc: (formData) => api.post('/knowledge/parse', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),

  // 字典
  getDicts: (manage) => api.get('/dictionaries', { params: manage ? { manage: 1 } : {} }),
  listDictByType: (type) => api.get(`/dictionaries/${type}`),
  createDict: (type, d) => api.post(`/dictionaries/${type}`, d),
  updateDict: (type, id, d) => api.put(`/dictionaries/${type}/${id}`, d),
  deleteDict: (type, id) => api.delete(`/dictionaries/${type}/${id}`),

  // 看板
  getDashboard: (params) => api.get('/dashboard', { params }),
  // 整页看板：按时间维度（今日/本周/本月/上月/本年）一次取齐
  getDashboardOverview: (params) => api.get('/dashboard/overview', { params }),
  getTrend: (range, extra) => api.get('/dashboard/trend', { params: { range, ...(extra || {}) } }),
  getDistribution: (params) => api.get('/dashboard/distribution', { params }),
  // 上月 + 本年度汇总分析
  getDashboardSummary: (params) => api.get('/dashboard/summary', { params }),

  // 团队运营分析（管理员 / 审计员）
  getAnalytics: (range) => api.get('/analytics/overview', { params: { range } }),
  getAnalyticsUserTickets: (params) => api.get('/analytics/user-tickets', { params }),
  getAnalyticsOverdue: (params) => api.get('/analytics/overdue', { params }),
  getAnalyticsPerson: (params) => api.get('/analytics/person', { params }),
  getDataHealth: () => api.get('/analytics/data-health'),
  repairData: () => api.post('/analytics/data-repair'),

  // 首页扩展数据（故障/SLA/满意度/巡检/指派）
  getDashboardExtra: (params) => api.get('/dashboard/extra', { params }),

  // 故障管理
  listIncidents: (params) => api.get('/incidents', { params }),
  getIncident: (id) => api.get(`/incidents/${id}`),
  createIncident: (d) => api.post('/incidents', d),
  updateIncident: (id, d) => api.put(`/incidents/${id}`, d),
  deleteIncident: (id) => api.delete(`/incidents/${id}`),
  incidentStats: (params) => api.get('/incidents/stats', { params }),

  // 巡检
  inspectionTemplate: () => api.get('/inspections/template'),
  listInspections: (params) => api.get('/inspections', { params }),
  createInspection: (d) => api.post('/inspections', d),
  updateInspection: (id, d) => api.put(`/inspections/${id}`, d),
  deleteInspection: (id) => api.delete(`/inspections/${id}`),
  inspectionToTicket: (id) => api.post(`/inspections/${id}/to-ticket`),
  inspectionToday: () => api.get('/inspections/today'),
  getInspectionConfig: () => api.get('/inspections/config'),
  saveInspectionConfig: (d) => api.put('/inspections/config', d),
  inspectionUpload: (formData) => api.post('/inspections/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),

  // 账号与权限台账
  listAccounts: (params) => api.get('/accounts', { params }),
  accountSummary: (params) => api.get('/accounts/summary', { params }),
  createAccount: (d) => api.post('/accounts', d),
  updateAccount: (id, d) => api.put(`/accounts/${id}`, d),
  deleteAccount: (id) => api.delete(`/accounts/${id}`),

  // 操作审计
  listAuditLogs: (params) => api.get('/audit-logs', { params }),
  auditLogUsers: () => api.get('/audit-logs/users'),
  auditLogSummary: () => api.get('/audit-logs/summary'),

  // 工单指派 / 接单
  assignTicket: (id, assignee_id) => api.post(`/tickets/${id}/assign`, { assignee_id }),
  claimTicket: (id) => api.post(`/tickets/${id}/claim`),
  releaseTicket: (id) => api.post(`/tickets/${id}/release`),
  poolTickets: () => api.get('/tickets/pool'),
  listStaff: () => api.get('/tickets/staff'),

  // 工单流转设置（服务台开关）
  getWorkflowSettings: () => api.get('/system/workflow-settings'),
  saveWorkflowSettings: (d) => api.put('/system/workflow-settings', d),

  // SLA 策略
  listSla: () => api.get('/sla'),
  createSla: (d) => api.post('/sla', d),
  updateSla: (id, d) => api.put(`/sla/${id}`, d),
  deleteSla: (id) => api.delete(`/sla/${id}`),
  recalcSla: () => api.post('/sla/recalc'),

  // 通知配置
  getNotifyConfig: () => api.get('/notify/config'),
  saveNotifyConfig: (d) => api.put('/notify/config', d),
  testNotify: (d) => api.post('/notify/test', d),

  // 系统公共设置（自助入口开关 / 密钥）
  getPublicSettings: () => api.get('/system/public-settings'),
  savePublicSettings: (d) => api.put('/system/public-settings', d),

  // 备份（压缩包：全部数据 + 系统设置 + 上传附件）
  backupInfo: () => api.get('/backup/info'),
  backupList: () => api.get('/backup/list'),
  backupCreate: () => api.post('/backup/create', {}, { timeout: 300000 }),
  backupDownload: (name) => api.get(`/backup/download/${encodeURIComponent(name)}`, { responseType: 'blob', timeout: 600000 }),
  backupRestoreFile: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/backup/upload-restore', fd, {
      timeout: 900000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  backupRestoreLocal: (name) => api.post('/backup/restore-local', { name }, { timeout: 900000 }),
  backupDelete: (name) => api.delete(`/backup/${encodeURIComponent(name)}`),

  // 公开接口（免登录：扫码报障 / 进度查询 / 满意度 / 常见问题）
  publicConfig: (k) => api.get('/public/config', { params: { k } }),
  publicOptions: () => api.get('/public/options'),
  publicReport: (d) => api.post('/public/report', d),
  publicTrack: (d) => api.post('/public/track', d),
  publicSatisfy: (d) => api.post('/public/satisfy', d),
  publicFaq: (params) => api.get('/public/faq', { params }),
  publicFaqDetail: (id, k) => api.get(`/public/faq/${id}`, { params: { k } }),

  // 日报
  getTodayReport: () => api.get('/daily-report/today'),
  getReportHistory: () => api.get('/daily-report/history'),
  submitReport: (d) => api.post('/daily-report/submit', d),
  aiDailyReport: () => api.post('/daily-report/ai-generate', {}, { timeout: 120000 }),

  // 项目管理
  listProjects: (params) => api.get('/projects', { params }),
  createProject: (d) => api.post('/projects', d),
  updateProject: (id, d) => api.put(`/projects/${id}`, d),
  deleteProject: (id) => api.delete(`/projects/${id}`),

  // 月度报告
  generateMonthlyReport: (month) => api.post('/monthly-report/generate', { month }, { timeout: 180000 }),
  getMonthlyReport: (month) => api.get('/monthly-report', { params: { month } }),
  monthlyReportHistory: () => api.get('/monthly-report/history'),

  // 团队日报 / 月报查阅（管理员、审计员）
  teamDailySummary: () => api.get('/daily-report/team/summary'),
  teamDailyMissing: (date) => api.get('/daily-report/team/missing', { params: { date } }),
  teamDailyList: (params) => api.get('/daily-report/team', { params }),
  teamDailyDetail: (id) => api.get(`/daily-report/team/${id}`),
  teamMonthlyList: (params) => api.get('/monthly-report/team', { params }),
  teamMonthlyDetail: (id) => api.get(`/monthly-report/team/${id}`),

  // AI 接入（每用户独立配置）
  getAiConfig: () => api.get('/ai/config'),
  updateAiConfig: (d) => api.put('/ai/config', d),
  testAiConfig: (d) => api.post('/ai/test', d, { timeout: 60000 }),
  listAiModels: (d) => api.post('/ai/models', d, { timeout: 20000 })
}

export default R
