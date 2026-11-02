/**
 * @file frontend/src/api/index.js
 * @description 统一 axios 实例、token 注入、错误提示与各业务模块的请求方法
 *
 * 接口封装层 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
import axios from 'axios'
import router from '../router'

// 全局唯一 axios 实例：baseURL 固定 /api（由前端静态服务或反向代理转给后端进程），
// 20 秒超时只是兜底；导入、AI 生成、备份还原等长任务在各自方法里单独放宽 timeout
const api = axios.create({ baseURL: '/api', timeout: 20000 })

// 请求拦截：从 localStorage 取 JWT 塞进 Authorization 头。
// 这里直接读存储而不是读 Pinia，是为了让任何时序下（如登录页刚写入 token）都能拿到最新值
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('itops_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 响应拦截：把后端的 { code, message, data } 信封拆开，业务代码只拿到 data；
// 非 0 一律 reject 成 Error，页面统一 catch 后弹 message，无需每处判断 code
api.interceptors.response.use(
  (res) => {
    // 成功约定：code === 0 直接把 data 返回给调用方
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
      // 业务错误：HTTP 200 但 code 非 0
      // 401 表示 token 过期/被踢下线，清掉本地登录态并跳登录页，避免后续请求连环 401
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
    // 网络层错误：后端直接回 401 时信封里没有 code，这里再兜一次同样的跳转
    if (err.response && err.response.status === 401) {
      localStorage.removeItem('itops_token')
      localStorage.removeItem('itops_user')
      router.replace('/login')
    }
    return Promise.reject(err)
  }
)

// 全部后端接口按业务分组暴露成方法，调用方只关心业务语义（路径、参数形态都收在这一层）
const R = {
  // 鉴权
  // 图形验证码：GET /auth/captcha，返回 captcha_id 与 svg 转成 base64 的 image；
  // 连续输错密码后后端会要求带上，登录时与密码一起提交
  getCaptcha: () => api.get('/auth/captcha'),
  // 登录：POST /auth/login，成功返回 { token, user }，由 store/user 写入 localStorage
  login: (username, password, captcha) => api.post('/auth/login', { username, password, ...(captcha || {}) }),
  // 当前登录人资料：GET /auth/me（刷新页面时用来校正本地缓存里的用户信息）
  getMe: () => api.get('/auth/me'),
  // 修改本人资料：PUT /auth/me（姓名、联系方式等）
  updateMe: (d) => api.put('/auth/me', d),
  // 修改本人密码：PUT /auth/password，需要带旧密码
  changePassword: (d) => api.put('/auth/password', d),

  // 用户（管理员）
  // 用户列表：GET /users，仅管理员可调
  listUsers: () => api.get('/users'),
  // 新建账号：POST /users，包含角色与初始密码
  createUser: (d) => api.post('/users', d),
  // 编辑账号：PUT /users/:id（改角色、重置密码、启停用）
  updateUser: (id, d) => api.put(`/users/${id}`, d),
  // 删除账号：DELETE /users/:id
  deleteUser: (id) => api.delete(`/users/${id}`),

  // 工单
  // 工单列表：GET /tickets，支持关键词/状态/时间范围/scope=pool/all 等参数
  listTickets: (params) => api.get('/tickets', { params }),
  // 工单详情：GET /tickets/:id（含处理记录与附件）
  getTicket: (id) => api.get(`/tickets/${id}`),
  // 新建工单：POST /tickets
  createTicket: (d) => api.post('/tickets', d),
  // 编辑工单：PUT /tickets/:id
  updateTicket: (id, d) => api.put(`/tickets/${id}`, d),
  // 删除工单：DELETE /tickets/:id
  deleteTicket: (id) => api.delete(`/tickets/${id}`),
  // 完成工单：POST /tickets/:id/complete，写入处理结果与 finish_time（SLA 完成口径按此统计）
  completeTicket: (id, d) => api.post(`/tickets/${id}/complete`, d),
  // 批量操作
  // 批量删除：POST /tickets/batch-delete，params 用于传当前筛选条件做二次权限校验
  batchDeleteTickets: (ids, params) => api.post('/tickets/batch-delete', { ids }, { params }),
  // 批量完成：POST /tickets/batch-complete
  batchCompleteTickets: (ids, params) => api.post('/tickets/batch-complete', { ids }, { params }),
  // 批量改状态：POST /tickets/batch-status（如批量关闭无效单）
  batchStatusTickets: (ids, status, params) => api.post('/tickets/batch-status', { ids, status }, { params }),
  // 附件上传：POST /tickets/upload，必须走 multipart，axios 不能自己序列化
  uploadFiles: (formData) => api.post('/tickets/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  // 导出 excel 的直链：GET /api/tickets/export/excel。
  // 只拼查询串、不经过 axios：适合 window.open 让浏览器原生下载（有进度、不占内存），
  // 但浏览器不会自动带 Authorization 头，真要走直链得另行处理鉴权（目前页面用的是下面的 blob 版）
  exportTicketsUrl: (params) => {
    const qs = new URLSearchParams(params).toString()
    return `/api/tickets/export/excel${qs ? '?' + qs : ''}`
  },
  // 导出 excel 的 blob 版：GET /tickets/export/excel，需要自己拿到二进制做二次处理时用
  exportTicketsBlob: (params) => api.get('/tickets/export/excel', { params, responseType: 'blob' }),
  // 导入 excel：POST /tickets/import/excel，万行级文件较慢，超时单独放宽到 120s
  importTickets: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/tickets/import/excel', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
  },

  // 待办
  // 待办列表：GET /todos?tab=xxx（按 tab 区分今日/全部/已完成）
  listTodos: (tab) => api.get('/todos', { params: { tab } }),
  // 今日未完成待办：GET /todos/pending/today，浮动待办面板用
  pendingToday: () => api.get('/todos/pending/today'),
  // 新建待办：POST /todos
  createTodo: (d) => api.post('/todos', d),
  // 编辑待办：PUT /todos/:id（含勾选完成 is_finish=1）
  updateTodo: (id, d) => api.put(`/todos/${id}`, d),
  // 删除待办：DELETE /todos/:id
  deleteTodo: (id) => api.delete(`/todos/${id}`),

  // 月度目标
  // 月度目标列表：GET /goals?month=YYYY-MM&done=0/1
  listGoals: (month, done) => api.get('/goals', { params: { month, done: done ? '1' : '0' } }),
  // 新建目标：POST /goals
  createGoal: (d) => api.post('/goals', d),
  // 编辑目标：PUT /goals/:id（改标题、勾选完成）
  updateGoal: (id, d) => api.put(`/goals/${id}`, d),
  // 删除目标：DELETE /goals/:id
  deleteGoal: (id) => api.delete(`/goals/${id}`),

  // 知识库
  // 知识条目列表：GET /knowledge，支持关键词/类别/分页
  listKnowledge: (params) => api.get('/knowledge', { params }),
  // 智能推荐：GET /knowledge/recommend，新建工单时按标题匹配历史方案
  recommend: (params) => api.get('/knowledge/recommend', { params }),
  // 知识详情：GET /knowledge/:id
  getKnowledge: (id) => api.get(`/knowledge/${id}`),
  // 新增知识：POST /knowledge
  createKnowledge: (d) => api.post('/knowledge', d),
  // 编辑知识：PUT /knowledge/:id
  updateKnowledge: (id, d) => api.put(`/knowledge/${id}`, d),
  // 删除知识：DELETE /knowledge/:id
  deleteKnowledge: (id) => api.delete(`/knowledge/${id}`),
  // AI 批量整理：POST /knowledge/ai-organize，要调大模型，超时放宽到 180s
  aiOrganizeKnowledge: () => api.post('/knowledge/ai-organize', {}, { timeout: 180000 }),
  // 文档解析入库：POST /knowledge/parse，上传 Word/PDF 后抽取正文
  parseDoc: (formData) => api.post('/knowledge/parse', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),

  // 字典
  // 字典总表：GET /dictionaries，manage=1 时连停用项一起返回（维护页用）
  getDicts: (manage) => api.get('/dictionaries', { params: manage ? { manage: 1 } : {} }),
  // 按类型取字典项：GET /dictionaries/:type（如 priority / problem_type）
  listDictByType: (type) => api.get(`/dictionaries/${type}`),
  // 新增字典项：POST /dictionaries/:type
  createDict: (type, d) => api.post(`/dictionaries/${type}`, d),
  // 编辑字典项：PUT /dictionaries/:type/:id
  updateDict: (type, id, d) => api.put(`/dictionaries/${type}/${id}`, d),
  // 删除字典项：DELETE /dictionaries/:type/:id
  deleteDict: (type, id) => api.delete(`/dictionaries/${type}/${id}`),

  // 看板
  // 看板指标：GET /dashboard，管理员传 all=1 看全员，否则只看自己名下
  getDashboard: (params) => api.get('/dashboard', { params }),
  // 整页看板：按时间维度（今日/本周/本月/上月/本年）一次取齐
  getDashboardOverview: (params) => api.get('/dashboard/overview', { params }),
  // 趋势曲线：GET /dashboard/trend?range=today|week|month|lastMonth|year
  getTrend: (range, extra) => api.get('/dashboard/trend', { params: { range, ...(extra || {}) } }),
  // 分布图：GET /dashboard/distribution（按类别/优先级/人员分组）
  getDistribution: (params) => api.get('/dashboard/distribution', { params }),
  // 上月 + 本年度汇总分析
  getDashboardSummary: (params) => api.get('/dashboard/summary', { params }),

  // 团队运营分析（管理员 / 审计员）
  // 总览指标：GET /analytics/overview，按 range 统计团队受理/完成/超时
  getAnalytics: (range) => api.get('/analytics/overview', { params: { range } }),
  // 人员工作量：GET /analytics/user-tickets
  getAnalyticsUserTickets: (params) => api.get('/analytics/user-tickets', { params }),
  // 超时工单清单：GET /analytics/overdue
  getAnalyticsOverdue: (params) => api.get('/analytics/overdue', { params }),
  // 单人详情：GET /analytics/person
  getAnalyticsPerson: (params) => api.get('/analytics/person', { params }),
  // 数据体检：GET /analytics/data-health，检查缺 finish_time、状态矛盾的脏数据
  getDataHealth: () => api.get('/analytics/data-health'),
  // 一键修复脏数据：POST /analytics/data-repair（管理员），修「完成早于受理」「已完成却无完成时间」这类记录
  repairData: () => api.post('/analytics/data-repair'),

  // 首页扩展数据（故障/SLA/满意度/巡检/指派）
  // GET /dashboard/extra：首页第二屏的扩展卡片
  getDashboardExtra: (params) => api.get('/dashboard/extra', { params }),

  // 故障管理
  // 故障列表：GET /incidents
  listIncidents: (params) => api.get('/incidents', { params }),
  // 故障详情：GET /incidents/:id
  getIncident: (id) => api.get(`/incidents/${id}`),
  // 登记故障：POST /incidents
  createIncident: (d) => api.post('/incidents', d),
  // 编辑故障：PUT /incidents/:id（含恢复时间、影响范围）
  updateIncident: (id, d) => api.put(`/incidents/${id}`, d),
  // 删除故障：DELETE /incidents/:id
  deleteIncident: (id) => api.delete(`/incidents/${id}`),
  // 故障统计：GET /incidents/stats（次数、平均恢复时长）
  incidentStats: (params) => api.get('/incidents/stats', { params }),

  // 巡检
  // 巡检模板：GET /inspections/template（机房巡检固定检查项）
  inspectionTemplate: () => api.get('/inspections/template'),
  // 巡检记录列表：GET /inspections
  listInspections: (params) => api.get('/inspections', { params }),
  // 提交巡检：POST /inspections
  createInspection: (d) => api.post('/inspections', d),
  // 编辑巡检：PUT /inspections/:id
  updateInspection: (id, d) => api.put(`/inspections/${id}`, d),
  // 删除巡检：DELETE /inspections/:id
  deleteInspection: (id) => api.delete(`/inspections/${id}`),
  // 巡检转工单：POST /inspections/:id/to-ticket（查出异常项时一键建单）
  inspectionToTicket: (id) => api.post(`/inspections/${id}/to-ticket`),
  // 今日巡检状态：GET /inspections/today（首页提醒今天还没巡检）
  inspectionToday: () => api.get('/inspections/today'),
  // 巡检配置：GET /inspections/config
  getInspectionConfig: () => api.get('/inspections/config'),
  // 保存巡检配置：PUT /inspections/config（巡检频率、提醒时间）
  saveInspectionConfig: (d) => api.put('/inspections/config', d),
  // 巡检照片上传：POST /inspections/upload
  inspectionUpload: (formData) => api.post('/inspections/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),

  // 账号与权限台账
  // 台账列表：GET /accounts（各系统账号归属、到期时间）
  listAccounts: (params) => api.get('/accounts', { params }),
  // 台账汇总：GET /accounts/summary（按系统统计账号数、即将到期数）
  accountSummary: (params) => api.get('/accounts/summary', { params }),
  // 新增台账：POST /accounts
  createAccount: (d) => api.post('/accounts', d),
  // 编辑台账：PUT /accounts/:id
  updateAccount: (id, d) => api.put(`/accounts/${id}`, d),
  // 删除台账：DELETE /accounts/:id
  deleteAccount: (id) => api.delete(`/accounts/${id}`),

  // 操作审计
  // 审计日志：GET /audit-logs（谁在什么时候改了什么）
  listAuditLogs: (params) => api.get('/audit-logs', { params }),
  // 操作人下拉：GET /audit-logs/users
  auditLogUsers: () => api.get('/audit-logs/users'),
  // 审计概览：GET /audit-logs/summary
  auditLogSummary: () => api.get('/audit-logs/summary'),

  // 工单指派 / 接单
  // 派单：POST /tickets/:id/assign，服务台把单一对一挂给工程师
  assignTicket: (id, assignee_id) => api.post(`/tickets/${id}/assign`, { assignee_id }),
  // 抢单：POST /tickets/:id/claim，从公海池挂到自己名下；并发被别人抢先会返回业务错误
  claimTicket: (id) => api.post(`/tickets/${id}/claim`),
  // 退回公海：POST /tickets/:id/release
  releaseTicket: (id) => api.post(`/tickets/${id}/release`),
  // 公海池：GET /tickets/pool，取待接单/待指派工单
  poolTickets: () => api.get('/tickets/pool'),
  // 可派单人员：GET /tickets/staff
  listStaff: () => api.get('/tickets/staff'),

  // 工单流转设置（服务台开关）
  // GET /system/workflow-settings：service_desk_enable 决定是「派单」还是「抢单」模式
  getWorkflowSettings: () => api.get('/system/workflow-settings'),
  // 保存流转设置：PUT /system/workflow-settings（管理员）
  saveWorkflowSettings: (d) => api.put('/system/workflow-settings', d),

  // SLA 策略
  // SLA 策略列表：GET /sla（按优先级配响应/完成时限）
  listSla: () => api.get('/sla'),
  // 新增策略：POST /sla
  createSla: (d) => api.post('/sla', d),
  // 编辑策略：PUT /sla/:id
  updateSla: (id, d) => api.put(`/sla/${id}`, d),
  // 删除策略：DELETE /sla/:id
  deleteSla: (id) => api.delete(`/sla/${id}`),
  // 重算历史工单的 SLA 结果：POST /sla/recalc（仅管理员），改完策略后用来把旧单按新口径过一遍
  recalcSla: () => api.post('/sla/recalc'),

  // 通知配置
  // 通知配置：GET /notify/config（邮件/企业微信 webhook）
  getNotifyConfig: () => api.get('/notify/config'),
  // 保存通知配置：PUT /notify/config
  saveNotifyConfig: (d) => api.put('/notify/config', d),
  // 发送测试消息：POST /notify/test，用来验证 webhook 是否通
  testNotify: (d) => api.post('/notify/test', d),

  // 系统公共设置（自助入口开关 / 密钥）
  // 自助门户设置：GET /system/public-settings（入口开关与密钥 k）
  getPublicSettings: () => api.get('/system/public-settings'),
  // 保存自助门户设置：PUT /system/public-settings，改密钥会让旧二维码立即失效
  savePublicSettings: (d) => api.put('/system/public-settings', d),

  // 备份（压缩包：全部数据 + 系统设置 + 上传附件）
  // 备份概况：GET /backup/info（数据量、上次备份时间）
  backupInfo: () => api.get('/backup/info'),
  // 已有备份列表：GET /backup/list
  backupList: () => api.get('/backup/list'),
  // 立即备份：POST /backup/create，整库打包较慢，超时放宽到 5 分钟
  backupCreate: () => api.post('/backup/create', {}, { timeout: 300000 }),
  // 下载备份包：GET /backup/download/:name，走 blob 才能带上 Authorization 头
  backupDownload: (name) => api.get(`/backup/download/${encodeURIComponent(name)}`, { responseType: 'blob', timeout: 600000 }),
  // 上传备份包还原：POST /backup/upload-restore，还原期间要清表重建，超时放宽到 15 分钟
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
  // 用服务器上已有的备份包还原：POST /backup/restore-local
  backupRestoreLocal: (name) => api.post('/backup/restore-local', { name }, { timeout: 900000 }),
  // 删除备份包：DELETE /backup/:name
  backupDelete: (name) => api.delete(`/backup/${encodeURIComponent(name)}`),

  // 公开接口（免登录：扫码报障 / 进度查询 / 满意度 / 常见问题）
  // 以下方法后端挂在 /public/* 白名单路由上，不校验 JWT；k 为入口密钥（二维码里带的那串）
  // 门户配置：GET /public/config?k=xxx，返回开关、值班电话、版本号
  publicConfig: (k) => api.get('/public/config', { params: { k } }),
  // 报障表单下拉选项：GET /public/options（部门、系统、问题类型）
  publicOptions: () => api.get('/public/options'),
  // 提交报障：POST /public/report，成功后返回 report_no
  publicReport: (d) => api.post('/public/report', d),
  // 查询进度：POST /public/track，用单号 + 手机尾号校验
  publicTrack: (d) => api.post('/public/track', d),
  // 满意度评价：POST /public/satisfy
  publicSatisfy: (d) => api.post('/public/satisfy', d),
  // 常见问题列表：GET /public/faq（只返回已公开条目）
  publicFaq: (params) => api.get('/public/faq', { params }),
  // 常见问题详情：GET /public/faq/:id?k=xxx，方案正文按需加载
  publicFaqDetail: (id, k) => api.get(`/public/faq/${id}`, { params: { k } }),

  // 日报
  // 今日日报草稿：GET /daily-report/today（已有则回填）
  getTodayReport: () => api.get('/daily-report/today'),
  // 历史日报：GET /daily-report/history
  getReportHistory: () => api.get('/daily-report/history'),
  // 提交日报：POST /daily-report/submit
  submitReport: (d) => api.post('/daily-report/submit', d),
  // AI 生成日报：POST /daily-report/ai-generate，要调大模型，超时放宽到 2 分钟
  aiDailyReport: () => api.post('/daily-report/ai-generate', {}, { timeout: 120000 }),

  // 项目管理
  // 项目列表：GET /projects
  listProjects: (params) => api.get('/projects', { params }),
  // 新建项目：POST /projects
  createProject: (d) => api.post('/projects', d),
  // 编辑项目：PUT /projects/:id
  updateProject: (id, d) => api.put(`/projects/${id}`, d),
  // 删除项目：DELETE /projects/:id
  deleteProject: (id) => api.delete(`/projects/${id}`),

  // 月度报告
  // 生成月报：POST /monthly-report/generate，要跑统计 + AI 总结，超时 3 分钟
  generateMonthlyReport: (month) => api.post('/monthly-report/generate', { month }, { timeout: 180000 }),
  // 读取已生成月报：GET /monthly-report?month=YYYY-MM
  getMonthlyReport: (month) => api.get('/monthly-report', { params: { month } }),
  // 月报历史：GET /monthly-report/history
  monthlyReportHistory: () => api.get('/monthly-report/history'),

  // 团队日报 / 月报查阅（管理员、审计员）
  // 团队日报汇总：GET /daily-report/team/summary（今日已交/未交人数）
  teamDailySummary: () => api.get('/daily-report/team/summary'),
  // 未交名单：GET /daily-report/team/missing?date=
  teamDailyMissing: (date) => api.get('/daily-report/team/missing', { params: { date } }),
  // 团队日报列表：GET /daily-report/team
  teamDailyList: (params) => api.get('/daily-report/team', { params }),
  // 团队日报详情：GET /daily-report/team/:id
  teamDailyDetail: (id) => api.get(`/daily-report/team/${id}`),
  // 团队月报列表：GET /monthly-report/team
  teamMonthlyList: (params) => api.get('/monthly-report/team', { params }),
  // 团队月报详情：GET /monthly-report/team/:id
  teamMonthlyDetail: (id) => api.get(`/monthly-report/team/${id}`),

  // AI 接入（每用户独立配置）
  // 本人的 AI 配置：GET /ai/config（出于安全只回 has_key 标记，不返回 api_key 明文）
  getAiConfig: () => api.get('/ai/config'),
  // 保存 AI 配置：PUT /ai/config
  updateAiConfig: (d) => api.put('/ai/config', d),
  // 测试连通性：POST /ai/test，要真发一次请求，超时给到 60s
  testAiConfig: (d) => api.post('/ai/test', d, { timeout: 60000 }),
  // 拉模型列表：POST /ai/models，按填好的 baseURL + key 去问供应商
  listAiModels: (d) => api.post('/ai/models', d, { timeout: 20000 })
}

// 具名导出集合：页面统一 import R from '../api'，按 R.xxx() 调用
export default R
