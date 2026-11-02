/**
 * @file backend/src/routes/backup.js
 * @description 数据库容量信息、备份生成、列表、下载、上传与本地恢复
 *
 * 备份恢复路由 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 系统备份与恢复
// ---------------------------------------------------------------------------
// 备份产物是一个 .zip 压缩包（相当于「整机快照」），结构：
//   meta.json     版本、备份时间、各表条数
//   db.json       全部数据表（含账号、字典、系统设置、AI 配置等）
//   uploads/*     上传的图片 / 附件原件
// 恢复时自动解包：附件回写到 uploads，数据表整体替换（事务内完成，失败回滚），
// 并且在恢复前自动生成一份「恢复前快照」，万一恢复错了还能退回去。
const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const archiver = require('archiver')
const AdmZip = require('adm-zip')
const multer = require('multer')
const { pool, query } = require('../db')
const { ok, fail, asyncHandler } = require('../utils/helpers')
const { auth, adminOnly } = require('../middleware/auth')

const APP_TAG = 'it-ops-system'
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads')
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || './backups')
const TMP_DIR = path.join(BACKUP_DIR, 'tmp')
const KEEP = 20 // 服务端最多保留最近 20 个备份包

// 目录准备：容器里可能是只读挂载或宿主机目录权限不对，
// 这里绝不能抛异常——否则整个备份路由模块加载失败，设置页会直接 500。
let dirError = ''
try {
  fs.mkdirSync(TMP_DIR, { recursive: true })
} catch (e) {
  dirError = `无法创建备份目录 ${TMP_DIR}：${e.message}`
  console.error('[backup]', dirError)
}
try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
} catch (e) {
  console.error('[backup] 无法创建上传目录：', e.message)
}

// 上传的备份包先落到临时目录（最大 1GB），校验完再处理
const zipUpload = multer({ dest: TMP_DIR, limits: { fileSize: 1024 * 1024 * 1024 } })

router.use(auth, adminOnly)

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------
function pad(n) { return String(n).padStart(2, '0') }

/**
 * 备份包时间戳，格式 YYYYMMDD-HHmmssSSS（带毫秒）。
 *
 * @param {Date} d
 * @returns {string}
 */
function stamp(d = new Date()) {
  // 带毫秒，避免同一秒内生成两个备份包互相覆盖（恢复前的快照会把要恢复的包覆盖掉）
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${String(d.getMilliseconds()).padStart(3, '0')}`
}

// 只备份基表（视图 v_ticket_duration 这类不能写回）
/**
 * 列出当前库里所有基表（排除视图），恢复时也只认这批表。
 *
 * @returns {Promise<string[]>} 表名数组
 */
async function listTables() {
  const rows = await query(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`
  )
  return rows.map(r => r.t)
}

/**
 * 逐表全量导出成内存对象；单表失败只置空数组，不让一张坏表毁掉整次备份。
 *
 * @returns {Promise<{tables: string[], data: Record<string, object[]>}>}
 */
async function dumpAll() {
  const tables = await listTables()
  const data = {}
  for (const t of tables) {
    try { data[t] = await query(`SELECT * FROM \`${t}\``) } catch { data[t] = [] }
  }
  return { tables, data }
}

/**
 * 递归统计目录体积与文件数；目录不存在按 0 处理（首次部署时 uploads 可能还没建）。
 *
 * @param {string} dir
 * @returns {{bytes: number, files: number}}
 */
function dirSize(dir) {
  let total = 0
  let files = 0
  const walk = d => {
    let list = []
    try { list = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of list) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else { try { total += fs.statSync(p).size; files++ } catch { /* ignore */ } }
    }
  }
  walk(dir)
  return { bytes: total, files }
}

function mb(bytes) { return Math.round((bytes / 1024 / 1024) * 100) / 100 }

// 文件名安全校验：只允许本系统生成过的备份包名
/**
 * 备份包名校验，防止 ../ 之类的路径穿越读到备份目录外的文件。
 * 前缀匹配 + 目录归属双重校验，两条都过才返回绝对路径。
 *
 * @param {string} name
 * @returns {string|null} 合法时返回绝对路径，非法返回 null
 */
function safeName(name) {
  const n = String(name || '')
  if (!/^itops-backup-[0-9-]+\.zip$/.test(n)) return null
  const p = path.join(BACKUP_DIR, n)
  if (path.dirname(p) !== BACKUP_DIR) return null
  return p
}

// ---------------------------------------------------------------------------
// 生成备份包
// ---------------------------------------------------------------------------
/**
 * 生成一个备份包（meta.json + db.json + uploads/）并清理超量旧包。
 * reason 只写进 meta 便于排查：manual=手动、pre-restore=恢复前自动快照；
 * protect 传本次要恢复的包名，防止它在清理时被自己删掉。
 *
 * @param {string} reason manual|pre-restore
 * @param {string|null} protect 需要免于清理的备份包名
 * @returns {Promise<{name: string, size: number, size_mb: number, meta: object}>}
 */
async function createBackup(reason = 'manual', protect = null) {
  const { data } = await dumpAll()
  const counts = {}
  Object.keys(data).forEach(t => { counts[t] = data[t].length })
  const up = dirSize(UPLOAD_DIR)

  let name = `itops-backup-${stamp()}.zip`
  let outPath = path.join(BACKUP_DIR, name)
  // 极端情况下（同一毫秒）也不覆盖已有备份包
  let seq = 1
  while (fs.existsSync(outPath)) {
    seq++
    name = `itops-backup-${stamp()}-${seq}.zip`
    outPath = path.join(BACKUP_DIR, name)
  }
  const meta = {
    app: APP_TAG,
    version: 2,
    created_at: new Date().toISOString(),
    reason,
    tables: counts,
    uploads: up.files,
    uploads_bytes: up.bytes
  }

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outPath)
    const archive = archiver('zip', { zlib: { level: 6 } })
    out.on('close', resolve)
    out.on('error', reject)
    archive.on('error', reject)
    archive.on('warning', () => {})
    archive.pipe(out)
    archive.append(JSON.stringify(meta, null, 2), { name: 'meta.json' })
    archive.append(JSON.stringify({ app: APP_TAG, tables: data }), { name: 'db.json' })
    if (fs.existsSync(UPLOAD_DIR)) archive.directory(UPLOAD_DIR, 'uploads')
    archive.finalize()
  })

  const size = fs.statSync(outPath).size
  pruneOld(name, protect)
  return { name, size, size_mb: mb(size), meta }
}

// 只保留最近的 KEEP 个自动/手动备份包
/**
 * 按修改时间倒序保留最近 KEEP 个，超出的删掉；刚生成的与正在恢复的那一个豁免。
 * 全程吞异常：清理失败不影响备份本身是否成功。
 *
 * @param {string} justCreated 刚生成的包名，永不删
 * @param {string|null} protect 额外的豁免包名
 * @returns {void}
 */
function pruneOld(justCreated, protect = null) {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^itops-backup-[0-9-]+\.zip$/.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    files.slice(KEEP).forEach(x => {
      if (x.f === justCreated || x.f === protect) return
      try { fs.unlinkSync(path.join(BACKUP_DIR, x.f)) } catch { /* ignore */ }
    })
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// 从备份包恢复（自动解包）
// ---------------------------------------------------------------------------
// 先把备份包整体读进内存：后面生成「恢复前快照」就不会覆盖到正在恢复的这个包
/**
 * 校验并读入备份包，没有 db.json 直接判定为非本系统的包，避免后面误清表。
 *
 * @param {string} zipPath 压缩包绝对路径
 * @returns {import('adm-zip')} 已载入内存的 zip 对象
 */
function readZip(zipPath) {
  let zip
  try { zip = new AdmZip(zipPath) } catch { throw new Error('压缩包无法解压，可能已损坏或不是 zip 文件') }
  if (!zip.getEntry('db.json')) throw new Error('压缩包里没有 db.json，不是本系统的备份包')
  return zip
}

// 已读入内存的备份包 → 附件落盘 + 数据表整体替换
/**
 * 恢复主体：先回写附件，再在单个事务里整表替换数据。
 * 事务内关掉外键检查（否则删表顺序会被约束卡死），失败 rollback 并抛错；
 * 备份里有、当前库里没有的旧表直接跳过，避免往不存在的表里写；
 * 恢复后若一个可用管理员都不剩，把当前操作人补回去，防止把自己锁在系统外。
 *
 * @param {import('adm-zip')} zip 已载入内存的备份包
 * @returns {Promise<{tables: Record<string, number>, files: number, meta: object, admin_restored: boolean}>}
 */
async function restoreFromZipObject(zip) {
  const dbEntry = zip.getEntry('db.json')
  const metaEntry = zip.getEntry('meta.json')
  if (!dbEntry) throw new Error('压缩包里没有 db.json，不是本系统的备份包')

  let db
  try { db = JSON.parse(zip.readAsText(dbEntry)) } catch { throw new Error('db.json 解析失败，备份包可能已损坏') }
  if (db.app !== APP_TAG) throw new Error('这不是本系统的备份文件')
  const data = db.tables || {}
  const meta = metaEntry ? JSON.parse(zip.readAsText(metaEntry)) : {}

  // ① 附件写回 uploads（同名覆盖；备份里没有的现有文件保留，避免误删）
  let files = 0
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue
    if (!e.entryName.startsWith('uploads/')) continue
    const rel = e.entryName.slice('uploads/'.length)
    if (!rel || rel.includes('..')) continue
    const dest = path.join(UPLOAD_DIR, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, e.getData())
    files++
  }

  // ② 数据表整体替换
  const existing = await listTables()
  const currentAdmin = (await query(
    "SELECT * FROM sys_user WHERE role = 'admin' ORDER BY user_id LIMIT 1"
  ))[0]

  const conn = await pool.getConnection()
  const summary = {}
  try {
    await conn.beginTransaction()
    await conn.query('SET FOREIGN_KEY_CHECKS = 0')
    for (const t of Object.keys(data)) {
      if (!existing.includes(t)) continue // 备份里多出来的旧表，直接跳过
      const rows = Array.isArray(data[t]) ? data[t] : []
      await conn.query(`DELETE FROM \`${t}\``)
      if (!rows.length) { summary[t] = 0; continue }
      const cols = Object.keys(rows[0])
      const colSql = cols.map(c => `\`${c}\``).join(',')
      const CHUNK = 200 // 分批发，避免单条 SQL 超长 / 超过 max_allowed_packet
      let inserted = 0
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK)
        const values = []
        const ph = slice.map(row => {
          cols.forEach(c => {
            const v = row[c]
            values.push(v && typeof v === 'object' ? JSON.stringify(v) : (v === undefined ? null : v))
          })
          return `(${cols.map(() => '?').join(',')})`
        }).join(',')
        await conn.query(`INSERT INTO \`${t}\` (${colSql}) VALUES ${ph}`, values)
        inserted += slice.length
      }
      summary[t] = inserted
    }

    // ③ 防锁死：恢复后若一个可用管理员都没有，把操作人补回去
    let ensured = false
    if (summary.sys_user !== undefined) {
      const adm = await conn.query("SELECT COUNT(*) AS c FROM sys_user WHERE role = 'admin' AND is_enable = 1")
      const cnt = Number((adm[0][0] || {}).c || 0)
      if (!cnt && currentAdmin) {
        const cols = Object.keys(currentAdmin)
        const vals = cols.map(c => {
          const v = currentAdmin[c]
          return v && typeof v === 'object' ? JSON.stringify(v) : v
        })
        const updates = cols.filter(c => c !== 'user_id').map(c => `\`${c}\`=VALUES(\`${c}\`)`).join(',')
        await conn.query(
          `INSERT INTO sys_user (${cols.map(c => `\`${c}\``).join(',')}) VALUES (${cols.map(() => '?').join(',')})
           ON DUPLICATE KEY UPDATE ${updates}`,
          vals
        )
        ensured = true
      }
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1')
    await conn.commit()
    return { tables: summary, files, meta, admin_restored: ensured }
  } catch (e) {
    try { await conn.query('SET FOREIGN_KEY_CHECKS = 1'); await conn.rollback() } catch { /* ignore */ }
    throw new Error('恢复失败，已回滚：' + e.message)
  } finally {
    conn.release()
  }
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------
// 概览：表条数、库体积、附件体积、服务端备份目录
/**
 * 备份页概览：各表条数、数据库占用、附件占用、备份目录与保留策略。
 * 权限：仅管理员。单项统计失败按 0 处理，页面永远能打开。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/info', asyncHandler(async (req, res) => {
  const out = {}
  try {
    for (const t of await listTables()) {
      try {
        const r = await query(`SELECT COUNT(*) AS c FROM \`${t}\``)
        out[t] = Number(r[0].c || 0)
      } catch { out[t] = 0 }
    }
  } catch (e) {
    console.error('[backup] 统计表条数失败：', e.message)
  }
  let dbMb = 0
  try {
    const size = await query(
      `SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS mb
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`
    )
    dbMb = Number((size[0] && size[0].mb) || 0)
  } catch { /* 忽略，页面显示 0 即可 */ }
  const up = dirSize(UPLOAD_DIR)
  ok(res, {
    tables: out,
    db_size_mb: dbMb,
    uploads_files: up.files,
    uploads_mb: mb(up.bytes),
    backup_dir: BACKUP_DIR,
    keep: KEEP
  })
}))

// 立即备份：生成 zip（同时留在服务端备份目录，可直接下载）
/**
 * 手动备份：生成一个整机快照包并留在服务端，前端可直接下载。
 * 权限：仅管理员。返回总行数便于提示「这次备了多少数据」。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.post('/create', asyncHandler(async (req, res) => {
  const { name, size, size_mb, meta } = await createBackup('manual')
  ok(res, { name, size, size_mb, total_rows: Object.values(meta.tables).reduce((a, b) => a + b, 0) }, '备份包已生成')
}))

// 服务端备份列表
// 注意：这个接口在设置页一打开就会调用，**任何情况下都不能 500**，
// 否则用户看到的就是「读取备份列表失败 + status code 500」。
// 目录不存在 / 权限不足 / 单个文件 stat 失败，都降级为「空列表 + 提示原因」。
/**
 * 服务端备份包列表，按文件名倒序（时间戳在名字里，等价于时间倒序）。
 * 权限：仅管理员。任何异常都转成 warn 字段返回，绝不让接口 500。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res { dir, keep, files[], warn }
 * @returns {Promise<void>}
 */
router.get('/list', asyncHandler(async (req, res) => {
  const files = []
  let warn = dirError
  try {
    const names = fs.readdirSync(BACKUP_DIR)
    for (const f of names) {
      if (!/^itops-backup-[0-9-]+\.zip$/.test(f)) continue
      try {
        const st = fs.statSync(path.join(BACKUP_DIR, f))
        files.push({ name: f, size: st.size, size_mb: mb(st.size), created_at: st.mtime.toISOString() })
      } catch { /* 单个文件读不到就跳过，不影响整份列表 */ }
    }
    files.sort((a, b) => (a.name < b.name ? 1 : -1))
  } catch (e) {
    // 常见于：宿主机 backups 目录没建、权限是 root、容器以非 root 运行
    warn = warn || `无法读取备份目录 ${BACKUP_DIR}：${e.code || e.message}`
    console.error('[backup] 读取备份目录失败：', e.message)
  }
  ok(res, {
    dir: BACKUP_DIR,
    keep: KEEP,
    files,
    // warn 非空时前端会提示，但仍能正常显示页面
    warn: warn || ''
  })
}))

// 下载某个备份包
/**
 * 下载备份包：文件名先过 safeName 校验，防止越权读取其他文件。
 * 权限：仅管理员。走流式输出，大包不会占满内存。
 *
 * @param {import('express').Request} req req.params.name 备份包名
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.get('/download/:name', asyncHandler(async (req, res) => {
  const p = safeName(req.params.name)
  if (!p || !fs.existsSync(p)) return fail(res, '备份文件不存在')
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(p)}"`)
  fs.createReadStream(p).pipe(res)
}))

// 删除备份包
/**
 * 删除服务端备份包。权限：仅管理员；同样先过 safeName 校验。
 *
 * @param {import('express').Request} req req.params.name
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.delete('/:name', asyncHandler(async (req, res) => {
  const p = safeName(req.params.name)
  if (!p || !fs.existsSync(p)) return fail(res, '备份文件不存在')
  fs.unlinkSync(p)
  ok(res, null, '已删除备份包')
}))

// 恢复：方式一 —— 上传 .zip（最大 1GB），服务端自动解包
/**
 * 上传包恢复：先读进内存再做「恢复前快照」，最后整库替换。
 * 权限：仅管理员。临时文件在 finally 里删除，失败也不留垃圾。
 * 顺序不能颠倒：快照会写进备份目录，先落盘再快照能避免覆盖到正在用的包。
 *
 * @param {import('express').Request} req multipart 字段名 file
 * @param {import('express').Response} res 返回各表行数、附件数、快照包名
 * @returns {Promise<void>}
 */
router.post('/upload-restore', zipUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return fail(res, '请选择备份压缩包（.zip）')
  const tmp = req.file.path
  try {
    const zip = readZip(tmp) // 先读进内存，再做快照，避免快照文件与备份包冲突
    const snap = await createBackup('pre-restore').catch(() => null)
    const r = await restoreFromZipObject(zip)
    const total = Object.values(r.tables || {}).reduce((a, b) => a + b, 0)
    ok(res, {
      ...r,
      total_rows: total,
      snapshot: snap ? snap.name : null
    }, `恢复完成：${total} 条数据、${r.files} 个附件${snap ? '，恢复前快照已保存' : ''}`)
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
}))

// 恢复：方式二 —— 直接用服务端已有的备份包
/**
 * 本地包恢复：直接用服务端备份目录里已有的包回滚。
 * 权限：仅管理员。protect 传入自身，保证「恢复前快照」清理时不会把这个包删掉。
 *
 * @param {import('express').Request} req req.body.name 备份包名
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
router.post('/restore-local', asyncHandler(async (req, res) => {
  const p = safeName(req.body && req.body.name)
  if (!p || !fs.existsSync(p)) return fail(res, '备份文件不存在')
  const zip = readZip(p)
  const snap = await createBackup('pre-restore', path.basename(p)).catch(() => null)
  const r = await restoreFromZipObject(zip)
  const total = Object.values(r.tables || {}).reduce((a, b) => a + b, 0)
  ok(res, { ...r, total_rows: total, snapshot: snap ? snap.name : null },
    `恢复完成：${total} 条数据、${r.files} 个附件`)
}))

module.exports = router
