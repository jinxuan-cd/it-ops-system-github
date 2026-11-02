/**
 * @file backend/src/index.js
 * @description 创建 Express 应用，挂载中间件与全部路由，等待数据库就绪后启动监听
 *
 * 服务入口 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const jwt = require('jsonwebtoken')
const { query, dbTarget } = require('./db')
const { fail } = require('./utils/helpers')
const { seedDefaultUsers, migrateSchema } = require('./utils/seed')
const { JWT_SECRET } = require('./middleware/auth')
const { auditLogger } = require('./middleware/audit')

const { uploadDir, uploadStaticOptions } = require('./middleware/upload')

// ============================================================================
//  单个后端进程，同时为两个入口提供 API
//  ---------------------------------------------------------------------------
//  · 管理端容器（内网端口，默认 8080）：完整后台，可访问全部接口
//  · 员工自助容器（公网端口，默认 8081）：只有报障/查进度/满意度/FAQ 页面，
//    nginx 只把 /api/public/* 反代到这里，其余路径在网关层就是 404
//  两个入口连的是**同一个 backend、同一个数据库**，数据天然互通，不需要任何同步。
//  公网安全边界由「网关只放行 /api/public/」+「宝塔 WAF」共同保证。
// ============================================================================

const app = express()
const PORT = process.env.PORT || 3000

// 挂在 Nginx 后面，需信任代理才能拿到真实客户端 IP（公网接口按 IP 限频依赖它）
app.set('trust proxy', 1)
app.disable('x-powered-by')

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

// 审计员（auditor）只读：除登录与修改本人资料/密码外，拦截一切写操作
/**
 * 只读账号闸门：在路由之前按方法统一拦截，而不是逐个路由判断权限。
 * 放行 GET/HEAD/OPTIONS 与白名单（改本人资料、改密码）；
 * token 缺失或解析失败时交后续 auth 中间件处理，这里不抢答，避免把「未登录」误报成「无权限」。
 * 副作用：命中即直接返回 403 响应体，不进入后续中间件。
 */
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
  const header = req.headers.authorization || ''
  if (!header.startsWith('Bearer ')) return next()
  let role = ''
  try { role = (jwt.verify(header.slice(7), JWT_SECRET) || {}).role } catch (e) { return next() }
  if (role !== 'auditor') return next()
  if (/^\/auth\/(me|password)$/.test(req.path)) return next()
  return fail(res, '审计员为只读账号，不能提交或修改业务数据', 1, 403)
})

// 操作审计：记录所有写操作（在路由之前注册，保证能拿到结果状态码）
app.use('/api', auditLogger)

// 上传文件静态访问
// 目录解析成绝对路径：进程工作目录可能不是 backend/，相对路径会指错
app.use('/uploads', express.static(path.resolve(uploadDir), uploadStaticOptions()))

// 路由
app.use('/api/auth', require('./routes/auth'))
app.use('/api/users', require('./routes/users'))
app.use('/api/tickets', require('./routes/tickets'))
app.use('/api/todos', require('./routes/todos'))
app.use('/api/goals', require('./routes/goals'))
app.use('/api/knowledge', require('./routes/knowledge'))
app.use('/api/dictionaries', require('./routes/dictionary'))
app.use('/api/dashboard', require('./routes/dashboard'))
app.use('/api/analytics', require('./routes/analytics'))
app.use('/api/daily-report', require('./routes/dailyReport'))
app.use('/api/projects', require('./routes/projects'))
app.use('/api/monthly-report', require('./routes/monthlyReport'))
app.use('/api/ai', require('./routes/aiConfig'))
app.use('/api/incidents', require('./routes/incidents'))
app.use('/api/inspections', require('./routes/inspections'))
app.use('/api/accounts', require('./routes/accounts'))
app.use('/api/audit-logs', require('./routes/auditLog'))
app.use('/api/notify', require('./routes/notify'))
app.use('/api/backup', require('./routes/backup'))
app.use('/api/sla', require('./routes/sla'))
app.use('/api/system', require('./routes/system'))
// 实时消息（SSE）：新工单接单提醒
app.use('/api/realtime', require('./routes/realtime'))
// 免登录公开接口：员工自助门户（公网）与管理端预览共用
app.use('/api/public', require('./routes/publicApi'))

// 健康检查：仅供容器探活与部署脚本使用，不查库、不带鉴权，避免探活把数据库压力放大
app.get('/api/health', (req, res) => res.json({ code: 0, message: 'ok', data: { time: new Date() } }))

// 404
app.use((req, res) => fail(res, '接口不存在', 404, 404))

// 统一错误处理
/**
 * 兜底错误出口：所有 asyncHandler 捕获的异常最终都落到这里。
 * multer 的超限错误单独转成 413，其余按 500 返回；
 * 只回传 message，不回传堆栈——堆栈里有绝对路径与 SQL 片段。
 */
app.use((err, req, res, next) => {
  console.error('[error]', err.message)
  if (err.code === 'LIMIT_FILE_SIZE') return fail(res, '文件过大（上限 30MB）', 1, 413)
  fail(res, err.message || '服务器内部错误', 1, 500)
})

// 等待数据库就绪（Docker 中 db 容器已启动但可能仍在初始化，MariaDB 首次初始化约 10~30 秒）
/**
 * 启动前的数据库可达性探测，避免 backend 比 db 先起来就直接崩溃退出。
 *
 * @param {number} [retries=40] 最大重试次数（40 次 × 3 秒 ≈ 2 分钟，覆盖首次初始化）
 * @param {number} [interval=3000] 每次重试间隔（毫秒）
 * @returns {Promise<boolean>} 连上返回 true；重试耗尽返回 false（由调用方决定是否降级启动）
 * @sideeffect 账号口令错误时打印处置指引并 process.exit(1)，不再无意义重试
 */
async function waitForDb(retries = 40, interval = 3000) {
  // 口令错误重试再多次也没用，直接给出可操作的提示后退出
  const AUTH_ERRORS = new Set(['ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR'])
  for (let i = 0; i < retries; i++) {
    try {
      await query('SELECT 1')
      console.log(`[db] 数据库连接成功：${dbTarget()}`)
      return true
    } catch (e) {
      if (AUTH_ERRORS.has(e.code)) {
        console.error(`[db] 账号或口令被拒绝（${e.code}）：${dbTarget()}`)
        console.error('[db] 原因是数据库里的真实口令与 .env 里的 MYSQL_USER / MYSQL_PASSWORD 不一致（数据卷已初始化过，改 env 不会改库里的口令）。')
        console.error('[db] 三种处理方式：')
        console.error('[db]   1) 把 .env 改回当初初始化时用的口令，再 up -d --force-recreate')
        console.error('[db]   2) 进容器改口令：docker compose exec db mariadb -uroot -p 后执行 ALTER USER')
        console.error('[db]   3) 数据可丢弃时删卷重建：docker compose down -v && docker compose up -d --build')
        process.exit(1)
      }
      console.log(`[db] 数据库尚未就绪，第 ${i + 1}/${retries} 次重试（${dbTarget()}）：${e.code || e.message}`)
      await new Promise((r) => setTimeout(r, interval))
    }
  }
  return false
}

/**
 * 启动流程：探库 → 迁移与种子 → 监听端口 → 挂定时任务。
 *
 * 数据库连不上时仍启动 HTTP（只跳过迁移与定时任务），
 * 这样 /api/health 可用、前端能拿到明确报错，而不是整个容器反复重启。
 *
 * @returns {Promise<void>}
 * @sideeffect 建表补列、写入默认管理员、注册 monthlyReport 与 scheduler 的定时器
 */
async function start() {
  const dbOk = await waitForDb()

  if (dbOk) {
    try {
      await migrateSchema()
      await seedDefaultUsers()
    } catch (e) {
      console.error('[seed] 初始化失败：', e.message)
    }
  } else {
    console.error('[db] 多次重试仍无法连接数据库，已跳过 seed；请检查数据库配置后重启后端')
  }

  app.listen(PORT, () => {
    console.log(`[server] 后端已启动：http://localhost:${PORT}（单进程，管理端 + 员工自助共用）`)
  })

  if (dbOk) {
    // 每月底（最后一天 17 点后，每 30 分钟检查一次）自动生成当月月度报告
    const { autoGenerateMonthEnd } = require('./routes/monthlyReport')
    setInterval(() => {
      autoGenerateMonthEnd().catch(e => console.error('[monthlyReport] 定时任务异常：', e.message))
    }, 30 * 60 * 1000)
    // 每日定时提醒（09:00 待跟进 / 18:00 今日小结）
    require('./utils/scheduler').startScheduler()
  }
}

start()

// 导出 app 而不只是监听端口：便于集成测试直接挂载，不必真的占用端口
module.exports = app
