/**
 * @file backend/src/db.js
 * @description 封装 mysql2 连接池与 query 方法，统一连接参数与错误抛出
 *
 * 数据库连接池 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
require('dotenv').config()

const mysql = require('mysql2/promise')

// 数据库连接池（兼容 MariaDB 10.11 / MySQL 8.0，两者协议一致）
// 注意：默认口令必须与 docker-compose.yml 里的默认值保持一致，否则本地直连会连不上
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'itops',
  password: process.env.DB_PASSWORD || 'itops_2026',
  database: process.env.DB_NAME || 'itops',
  waitForConnections: true,
  connectionLimit: 10,
  // 连接时区固定 +08:00：业务口径统一按北京时间，避免写入时被驱动按本地时区再偏移一次
  timezone: '+08:00',
  // dateStrings：DATETIME 直接以 'YYYY-MM-DD HH:mm:ss' 字符串返回，不让驱动构造 Date 对象。
  // 否则后端按本地时区解析字符串、前端再按浏览器时区渲染，跨时区访问会整体漂移 8 小时
  dateStrings: true,
  charset: 'utf8mb4',
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
})

// 连接目标（不含口令）：排查「数据库连不上」时打日志用
/**
 * 拼出「用户@主机:端口/库名」形式的连接目标描述。
 * 刻意不含口令：这段字符串会打到控制台与容器日志，不能出现任何凭据。
 *
 * @returns {string} 形如 itops@127.0.0.1:3306/itops
 */
function dbTarget() {
  const host = process.env.DB_HOST || '127.0.0.1'
  const port = process.env.DB_PORT || 3306
  const db = process.env.DB_NAME || 'itops'
  const user = process.env.DB_USER || 'itops'
  return `${user}@${host}:${port}/${db}`
}

// 统一查询封装
/**
 * 执行一条 SQL，只返回结果行，屏蔽 mysql2 的 [rows, fields] 元组。
 * 用 execute（服务端预处理）而非 query：参数一律走占位符绑定，天然防注入。
 * 隐含约束：execute 不支持 `LIMIT ?` 这类占位（驱动会报错），
 * 分页参数必须由调用方校验成整数再拼进 SQL。
 *
 * @param {string} sql 含 ? 占位符的 SQL
 * @param {Array} [params] 绑定参数，顺序与占位符一致
 * @returns {Promise<Array|object>} SELECT 返回行数组；写操作返回 ResultSetHeader（含 affectedRows）
 */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params)
  return rows
}

module.exports = { pool, query, dbTarget }
