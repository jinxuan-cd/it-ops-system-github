/**
 * @file backend/src/middleware/upload.js
 * @description 扩展名白名单、体积限制、上传目录与静态访问配置
 *
 * 附件上传中间件 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
const multer = require('multer')
const path = require('path')
const fs = require('fs')

const uploadDir = process.env.UPLOAD_DIR || './uploads'
fs.mkdirSync(uploadDir, { recursive: true })

// 允许上传的扩展名白名单：附件、巡检照片、头像等场景够用。
// 不放开 html / svg / js 等可执行或可内联脚本的类型，
// 否则同源打开（/uploads/xxx.html）会变成存储型 XSS，可窃取 localStorage 里的 token。
const ALLOWED_EXT = [
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic',
  '.pdf', '.txt', '.md', '.csv',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.rar', '.7z', '.log'
]
// 常见类型的 mimetype 白名单（浏览器有时给 application/octet-stream，故仅作辅助判断）
const ALLOWED_MIME = /^(image\/|text\/plain|text\/markdown|text\/csv|application\/pdf|application\/zip|application\/x-zip|application\/x-rar|application\/vnd\.|application\/msword|application\/octet-stream)/

/**
 * 取小写扩展名（含点）。扩展名是本项目唯一的类型判据，因此统一收敛到这一个函数，
 * 避免各处大小写处理不一致导致 `.JPG` 被拒。
 *
 * @param {string} name 原始文件名
 * @returns {string} 形如 '.pdf'，无扩展名返回 ''
 */
function extOf(name) {
  return path.extname(String(name || '')).toLowerCase()
}

/**
 * 通用附件的类型闸门：扩展名白名单为主，MIME 仅作辅助。
 *
 * 为什么以扩展名为主：file.mimetype 完全由客户端 multipart 头决定，浏览器可被绕过、
 * 脚本可直接伪造，不能作为安全边界；反过来，部分客户端对 Office/压缩包会给
 * application/octet-stream，若强依赖 MIME 会误杀正常文件。
 * 真正的兜底是静态目录的 nosniff + CSP sandbox（见 uploadStaticOptions）。
 *
 * @param {import('express').Request} req
 * @param {Express.Multer.File} file
 * @param {(err: Error|null, accept?: boolean) => void} cb multer 回调，err 会冒泡到统一错误处理
 * @returns {void}
 */
function fileFilter(req, file, cb) {
  const ext = extOf(file.originalname)
  if (!ext || !ALLOWED_EXT.includes(ext)) {
    return cb(new Error('不支持的文件类型：' + (ext || '未知') + '（允许图片、PDF、Office 文档、压缩包、文本）'))
  }
  if (file.mimetype && !ALLOWED_MIME.test(file.mimetype)) {
    return cb(new Error('文件类型校验失败：' + file.mimetype))
  }
  cb(null, true)
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // 统一用「时间戳-随机数 + 白名单后缀」，不使用用户上传的原始文件名（避免路径/特殊字符问题）
    const ext = extOf(file.originalname)
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
    cb(null, name)
  }
})

// 管理端通用上传实例：白名单见 ALLOWED_EXT
// 上限 30MB 与 index.js 里那句「文件过大（上限 30MB）」是同一口径，改一处必须改两处，
// 否则用户会看到与实际不符的提示
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 30 * 1024 * 1024 } // 单文件 30MB
})

// 只允许图片：员工自助报障上传故障截图/拍照用（公网入口，限制更严）
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic']
const imageUpload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 单张 8MB，手机原图一般 2~5MB
  fileFilter(req, file, cb) {
    const ext = extOf(file.originalname)
    if (!IMG_EXT.includes(ext)) return cb(new Error('只支持上传图片（jpg/png/webp/gif/bmp/heic）'))
    if (file.mimetype && !/^image\//.test(file.mimetype)) return cb(new Error('文件类型校验失败：' + file.mimetype))
    cb(null, true)
  }
})

// 静态目录的安全响应头：禁止浏览器猜测类型、禁止把上传文件当页面渲染
/**
 * 上传目录的静态服务选项。
 * nosniff 让浏览器不再「猜」类型（防止 .txt 被当 HTML 执行），
 * CSP 的 sandbox 让即便真被打开也拿不到同源权限，
 * 两道一起才是「白名单以为漏了某个后缀」时的最后防线。
 *
 * @returns {import('express').ServeStaticOptions} 可直接传给 express.static
 */
function uploadStaticOptions() {
  return {
    maxAge: '7d',
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; object-src 'none'; sandbox")
    }
  }
}

// 导出三个东西给路由用：管理端用 upload，公网门户必须用 imageUpload（更严），
// 静态目录必须用 uploadStaticOptions() 挂头，漏挂就等于把上传目录当普通站点裸奔
module.exports = { upload, imageUpload, uploadDir, uploadStaticOptions, ALLOWED_EXT }
