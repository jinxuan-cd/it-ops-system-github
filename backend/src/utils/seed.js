/**
 * @file backend/src/utils/seed.js
 * @description 建表补列、历史数据修复、基础字典与默认账号种子、系统设置兜底
 *
 * 初始化与数据迁移 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
const bcrypt = require('bcryptjs')
const { query } = require('../db')

// 一次性迁移登记表：记录已执行过的数据修复，避免每次启动重复执行
/**
 * 建迁移标记表（IF NOT EXISTS，本身也是幂等的）。
 * 所有「不能重复执行」的数据修复都靠这张表打标记，
 * 因为 UPDATE 类修复没有 CREATE IF NOT EXISTS 那样的天然幂等性。
 *
 * @returns {Promise<void>}
 * @sideeffect 首次启动时创建 sys_meta 表
 */
async function ensureMetaTable() {
  await query(`CREATE TABLE IF NOT EXISTS sys_meta (
    meta_key   VARCHAR(64) NOT NULL,
    meta_value VARCHAR(255) NULL,
    create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (meta_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统元信息（一次性迁移标记）'`)
}

/**
 * 判断某个一次性迁移是否已执行过。
 *
 * @param {string} key 迁移标识，约定为 'migr_日期_用途'
 * @returns {Promise<boolean>}
 */
async function metaDone(key) {
  const rows = await query('SELECT meta_key FROM sys_meta WHERE meta_key = ?', [key])
  return rows.length > 0
}

/**
 * 登记迁移已完成。必须在修复动作之后调用，
 * 先登记后执行的话一旦中途失败，下次启动会误判为「已做过」而永久跳过。
 *
 * @param {string} key 迁移标识
 * @param {string} [value='1'] 附加信息（如影响行数）
 * @returns {Promise<void>}
 */
async function markMeta(key, value = '1') {
  await query('INSERT INTO sys_meta (meta_key, meta_value) VALUES (?, ?)', [key, value])
}

/**
 * 判断表是否存在。
 * 补列/改数据前必须先查，因为老库可能整体缺某个后来才引入的表，
 * 直接 ALTER 会抛错并中断整个启动迁移。
 *
 * @param {string} name 表名
 * @returns {Promise<boolean>}
 */
async function tableExists(name) {
  const rows = await query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [name]
  )
  return rows.length > 0
}

// 历史数据修复（一次性）：
//  1) 早期数据库容器跑在 UTC，DEFAULT CURRENT_TIMESTAMP 存的是 UTC 墙钟时间，与本地差 8 小时，统一回填 +8
//  2) 导入的历史工单存在「完成时间早于发生时间」的脏数据，会让趋势图出现「受理 4 / 完成 0」的假象
//  3) 状态为已完成但缺少完成时间的工单，补成发生时间
/**
 * 历史数据修复（一次性，各段独立打标记）。
 *
 * 每段都是「先查 sys_meta → 修复 → 登记」的三步式，因此：
 * · 已执行过的库不会重复 +8 小时（重复加会把时间推到未来，比不修更糟）；
 * · 某段失败不影响其他段，下次启动只补没做过的那段；
 * · 只修历史脏数据，不做任何结构变更。
 *
 * @returns {Promise<void>}
 * @sideeffect 直接改业务表数据；会打印修正行数便于事后核对
 */
async function repairLegacyData() {
  if (!(await metaDone('migr_20261028_tz_repair'))) {
    const tables = ['ticket', 'knowledge', 'sys_user', 'todo', 'month_goal', 'project', 'monthly_report', 'daily_report', 'user_ai_config']
    let shifted = 0
    for (const t of tables) {
      if (!(await tableExists(t))) continue
      const cols = await query(
        'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [t, 'create_time']
      )
      if (!cols.length) continue
      const r = await query(`UPDATE ${t} SET create_time = DATE_ADD(create_time, INTERVAL 8 HOUR) WHERE create_time IS NOT NULL`)
      shifted += r.affectedRows || 0
    }
    await markMeta('migr_20261028_tz_repair')
    console.log(`[migrate] 已修正历史 create_time 时区偏差（${shifted} 行）`)
  }

  if (!(await metaDone('migr_20261028_fix_dirty_ticket'))) {
    const a = await query(
      `UPDATE ticket SET finish_time = happen_time
       WHERE happen_time IS NOT NULL AND finish_time IS NOT NULL AND finish_time < happen_time`
    )
    const b = await query(
      `UPDATE ticket SET finish_time = happen_time
       WHERE status = 'done' AND finish_time IS NULL AND happen_time IS NOT NULL`
    )
    const c = await query(`UPDATE ticket SET status = 'processing' WHERE status = 'done' AND finish_time IS NULL`)
    await markMeta('migr_20261028_fix_dirty_ticket')
    console.log(`[migrate] 已修正工单脏数据：完成早于发生 ${a.affectedRows} 行，完成缺时间 ${b.affectedRows} 行，状态回退 ${c.affectedRows} 行`)
  }
}

// 新增模块所需表结构（全部 IF NOT EXISTS，可反复执行）
/**
 * 业务模块的表结构与补列（故障、巡检、账号台账、审计、通知、SLA、系统设置）。
 *
 * 三类操作各自靠不同机制保证幂等，重复启动不会出错，也不会覆盖数据：
 * 1) 建表：CREATE TABLE IF NOT EXISTS，表已存在则整条跳过；
 * 2) 补列：先查 information_schema.COLUMNS，缺列才 ALTER（MySQL 不支持 ADD COLUMN IF NOT EXISTS）；
 * 3) 种子数据：只在「一条都没有」时插入默认值——SLA 默认策略按 COUNT(*)=0 判断，
 *    service_desk_enable 按 key 是否存在判断。已有数据一律不动，
 *    否则管理员调过的策略、改过的开关会在每次重启后被重置回默认值。
 *
 * @returns {Promise<void>}
 * @sideeffect 建表/补列；写入默认 SLA 策略与系统设置；为历史工单回填 SLA；首次把完整知识条目标记为公开
 */
async function migrateModules() {
  // 1) SLA 时效策略：按「问题类别 + 优先级」定义响应/解决时限，'*' 为默认兜底
  await query(`CREATE TABLE IF NOT EXISTS sla_policy (
    policy_id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
    problem_type  VARCHAR(100) NOT NULL DEFAULT '*' COMMENT '问题类别，* 为默认',
    priority      VARCHAR(20) NULL COMMENT '优先级限制，NULL 表示不限',
    respond_hours DECIMAL(5,1) NOT NULL DEFAULT 4 COMMENT '响应时限（小时）',
    resolve_hours DECIMAL(6,1) NOT NULL DEFAULT 24 COMMENT '解决时限（小时）',
    remark        VARCHAR(200) NULL,
    create_time   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (policy_id),
    KEY idx_type (problem_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SLA 时效策略'`)

  // 2) 故障管理（大范围故障 / 事件管理）
  await query(`CREATE TABLE IF NOT EXISTS incident (
    incident_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id          INT UNSIGNED NOT NULL COMMENT '登记人',
    incident_no      VARCHAR(24) NOT NULL COMMENT '故障编号',
    title            VARCHAR(200) NOT NULL COMMENT '故障标题',
    level            VARCHAR(10) NOT NULL DEFAULT 'P3' COMMENT 'P1/P2/P3/P4',
    scope            VARCHAR(200) NULL COMMENT '影响范围（哪些部门/区域）',
    affected_systems VARCHAR(300) NULL COMMENT '受影响系统',
    start_time       DATETIME NULL COMMENT '发生时间',
    accept_time      DATETIME NULL COMMENT '接单时间',
    finish_time      DATETIME NULL COMMENT '恢复时间',
    cause            TEXT NULL COMMENT '故障原因',
    process          TEXT NULL COMMENT '处理过程',
    review           TEXT NULL COMMENT '复盘总结',
    status           VARCHAR(20) NOT NULL DEFAULT 'ongoing' COMMENT 'ongoing/resolved',
    create_time      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (incident_id),
    UNIQUE KEY uk_incident_no (incident_no),
    KEY idx_start (start_time),
    KEY idx_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='故障管理（事件）'`)

  // 3) 机房 / 设备巡检
  await query(`CREATE TABLE IF NOT EXISTS inspection (
    inspection_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id       INT UNSIGNED NOT NULL,
    insp_date     DATE NOT NULL COMMENT '巡检日期',
    area          VARCHAR(100) NULL COMMENT '巡检区域（机房/楼层/设备组）',
    items         JSON NULL COMMENT '巡检项 [{name,done,note}]',
    result        VARCHAR(20) NOT NULL DEFAULT 'normal' COMMENT 'normal/abnormal',
    remark        TEXT NULL,
    ticket_id     INT UNSIGNED NULL COMMENT '异常转工单',
    create_time   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (inspection_id),
    KEY idx_user_date (user_id, insp_date),
    KEY idx_date (insp_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='巡检记录'`)

  // 4) 账号与权限台账
  await query(`CREATE TABLE IF NOT EXISTS account_ledger (
    account_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id         INT UNSIGNED NOT NULL COMMENT '登记人',
    system_name     VARCHAR(100) NULL COMMENT '所属系统',
    account_name    VARCHAR(100) NULL COMMENT '账号',
    owner_name      VARCHAR(100) NULL COMMENT '使用人',
    dept            VARCHAR(100) NULL COMMENT '部门',
    action          VARCHAR(20) NOT NULL DEFAULT '开通' COMMENT '开通/变更/注销',
    permission_desc TEXT NULL COMMENT '权限说明',
    operate_date    DATE NULL COMMENT '操作日期',
    status          VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active/closed',
    remark          VARCHAR(300) NULL,
    create_time     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (account_id),
    KEY idx_user (user_id),
    KEY idx_owner (owner_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='账号与权限台账'`)

  // 5) 操作审计日志
  await query(`CREATE TABLE IF NOT EXISTS audit_log (
    log_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id     INT UNSIGNED NULL,
    username    VARCHAR(50) NULL,
    role        VARCHAR(20) NULL,
    method      VARCHAR(10) NULL,
    path        VARCHAR(255) NULL,
    action      VARCHAR(100) NULL COMMENT '动作描述',
    target      VARCHAR(255) NULL COMMENT '操作对象',
    detail      TEXT NULL COMMENT '关键参数（脱敏）',
    ip          VARCHAR(64) NULL,
    status_code INT NULL,
    create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (log_id),
    KEY idx_user (user_id),
    KEY idx_time (create_time),
    KEY idx_path (path)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作审计日志'`)

  // 6) 消息通知配置（企微 / 钉钉 / 飞书 群机器人）
  await query(`CREATE TABLE IF NOT EXISTS notify_config (
    config_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id     INT UNSIGNED NOT NULL COMMENT '归属人（管理员接收）',
    channel     VARCHAR(20) NOT NULL DEFAULT 'wecom' COMMENT 'wecom/dingtalk/feishu/webhook',
    webhook     VARCHAR(512) NOT NULL COMMENT '机器人 Webhook 地址',
    secret      VARCHAR(200) NULL COMMENT '加签密钥（钉钉可选）',
    events      VARCHAR(300) NOT NULL DEFAULT 'overdue,report,incident' COMMENT '订阅事件',
    is_enable   TINYINT(1) NOT NULL DEFAULT 1,
    create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (config_id),
    UNIQUE KEY uk_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='消息通知配置'`)

  // 7) 系统公共设置（免登录报障入口密钥、门户开关等）
  await query(`CREATE TABLE IF NOT EXISTS sys_setting (
    k VARCHAR(64) NOT NULL,
    v TEXT NULL,
    create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (k)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统公共设置'`)

  // 工单表新增字段（SLA / 指派 / 满意度 / 报障来源）
  const ticketCols = [
    ['priority', "ALTER TABLE ticket ADD COLUMN priority VARCHAR(20) NOT NULL DEFAULT 'normal' COMMENT 'low/normal/high/urgent' AFTER status"],
    ['assignee_id', "ALTER TABLE ticket ADD COLUMN assignee_id INT UNSIGNED NULL COMMENT '指派给谁' AFTER user_id"],
    ['assign_time', "ALTER TABLE ticket ADD COLUMN assign_time DATETIME NULL COMMENT '指派时间' AFTER assignee_id"],
    ['respond_time', "ALTER TABLE ticket ADD COLUMN respond_time DATETIME NULL COMMENT '首次响应时间' AFTER assign_time"],
    ['sla_respond_due', "ALTER TABLE ticket ADD COLUMN sla_respond_due DATETIME NULL COMMENT '响应应达时间' AFTER respond_time"],
    ['sla_resolve_due', "ALTER TABLE ticket ADD COLUMN sla_resolve_due DATETIME NULL COMMENT '解决应达时间' AFTER sla_respond_due"],
    ['source', "ALTER TABLE ticket ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'manual' COMMENT 'manual/qr/import' AFTER sync_kb"],
    ['report_no', "ALTER TABLE ticket ADD COLUMN report_no VARCHAR(24) NULL COMMENT '报障单号' AFTER source"],
    ['reporter_phone', "ALTER TABLE ticket ADD COLUMN reporter_phone VARCHAR(30) NULL AFTER report_no"],
    ['satisfy_score', "ALTER TABLE ticket ADD COLUMN satisfy_score TINYINT NULL COMMENT '满意度 1-5' AFTER reporter_phone"],
    ['satisfy_comment', "ALTER TABLE ticket ADD COLUMN satisfy_comment VARCHAR(500) NULL AFTER satisfy_score"],
    ['satisfy_time', "ALTER TABLE ticket ADD COLUMN satisfy_time DATETIME NULL AFTER satisfy_comment"]
  ]
  for (const [col, sql] of ticketCols) {
    const c = await query(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      ['ticket', col]
    )
    if (!c.length) { await query(sql); console.log(`[migrate] ticket 已新增 ${col} 列`) }
  }

  // 待办表：关联工单 ID（新工单抢单提醒，点待办直接跳到工单详情）
  const todoCols = [
    ['ticket_id', "ALTER TABLE todo ADD COLUMN ticket_id INT UNSIGNED NULL COMMENT '关联工单（抢单提醒）' AFTER user_id"]
  ]
  for (const [col, sql] of todoCols) {
    const c = await query(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      ['todo', col]
    )
    if (!c.length) { await query(sql); console.log(`[migrate] todo 已新增 ${col} 列`) }
  }

  // 知识库：是否对外公开到「常见问题自助门户」
  const kbCols = [
    ['is_public', "ALTER TABLE knowledge ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否公开到自助门户' AFTER keyword"],
    ['faq_hits', "ALTER TABLE knowledge ADD COLUMN faq_hits INT NOT NULL DEFAULT 0 COMMENT '自助门户查看次数' AFTER is_public"]
  ]
  for (const [col, sql] of kbCols) {
    const c = await query(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      ['knowledge', col]
    )
    if (!c.length) { await query(sql); console.log(`[migrate] knowledge 已新增 ${col} 列`) }
  }

  // 默认 SLA 策略（只在完全没有策略时插入一条兜底）
  const p = await query('SELECT COUNT(*) AS cnt FROM sla_policy')
  if (!Number(p[0].cnt)) {
    await query(`INSERT INTO sla_policy (problem_type, priority, respond_hours, resolve_hours, remark)
                 VALUES ('*', NULL, 4, 24, '默认策略：4 小时内响应，24 小时内解决')`)
    console.log('[migrate] 已创建默认 SLA 策略（4h 响应 / 24h 解决）')
  }

  // 免登录报障入口密钥（生成一次后固定，二维码据此生成）
  await ensurePublicSettings()
  // 工单流转：服务台是可选角色。默认 0 = 不开服务台，新工单直接通知全部运维抢单
  if ((await settingGet('service_desk_enable')) === null) await settingSet('service_desk_enable', '0')

  // 注意：这里**不要**再做「把多条按优先级的策略收敛成一条默认策略」之类的迁移。
  // 策略表是管理员的自定义配置，按优先级分行配置（低/普通/高/紧急）是完全合法的用法，
  // 自动清表会让别人辛苦配的时限凭空消失。要改口径只能由管理员在页面上改。

  // 历史工单回填 SLA 截止时间（只补空的，不会覆盖已算好的）
  const { backfillSla } = require('./sla')
  const n = await backfillSla()
  if (n) console.log(`[migrate] 已为 ${n} 条历史工单回填 SLA 截止时间`)

  // 2026-11：完成时限的起算点从「发生时间」改为「接单时间」（接单即开始处理），
  // 已接过单的存量工单按新口径重算一次，否则排队久的单会被误判完成超时。
  // 用 meta 标记保证只跑一次，管理员后续点「重算」仍可随时再对齐。
  if (!(await metaDone('migr_20261104_sla_from_respond'))) {
    const { realignResolveFromRespond } = require('./sla')
    const rn = await realignResolveFromRespond()
    if (rn) console.log(`[migrate] 已按接单时间重算 ${rn} 条工单的完成时限`)
    await markMeta('migr_20261104_sla_from_respond')
  }

  // 常见问题自助门户：把已有完整「现象 + 解决方案」的知识条目标记为对外公开，
  // 否则自助门户首次打开是空的。管理员可在知识库里逐条/批量关闭。
  if (!(await metaDone('migr_20261028_faq_public'))) {
    const r = await query(
      `UPDATE knowledge SET is_public = 1
       WHERE is_public = 0
         AND problem_summary IS NOT NULL AND problem_summary <> ''
         AND solution IS NOT NULL AND solution <> ''`
    )
    await markMeta('migr_20261028_faq_public')
    if (r.affectedRows) console.log(`[migrate] 已公开 ${r.affectedRows} 条知识库条目用于自助 FAQ`)
  }
}

/**
 * 读取系统设置项。
 *
 * @param {string} k 设置键
 * @returns {Promise<string|null>} 值；键不存在返回 null（调用方据此判断「未初始化」并补默认值）
 */
async function settingGet(k) {
  const rows = await query('SELECT v FROM sys_setting WHERE k = ?', [k])
  return rows.length ? rows[0].v : null
}

/**
 * 写入系统设置（存在则覆盖）。
 * 用 ON DUPLICATE KEY UPDATE 而不是先查后写：两个请求同时初始化同一个 key 时不会主键冲突。
 *
 * @param {string} k 设置键
 * @param {string} v 值（统一存字符串，布尔用 '0'/'1'）
 * @returns {Promise<void>}
 */
async function settingSet(k, v) {
  await query(
    'INSERT INTO sys_setting (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = ?',
    [k, v, v]
  )
}

// 自助入口设置的「兜底自愈」--------------------------------------------------
// 为什么需要：init.sql 只在数据卷为空时执行一次；升级上来的老库、或启动迁移被
// 中断过的库，sys_setting 里可能整行缺失 report_key / report_enable / faq_enable。
// 表现就是：设置页入口密钥为空 → 二维码一直是「生成中」→ 员工扫码报障打不开，
// 报障接口还会因为 enable !== '1' 直接拒绝。
// 这里在读接口按需补齐，保证任何部署形态都能自愈，且不依赖启动顺序。
/**
 * 读取并兜底补齐自助门户所需的设置项。
 *
 * @returns {Promise<{key:string, report_enable:boolean, faq_enable:boolean, duty_contacts:Array<{name:string,phone:string,note:string}>}>}
 * @sideeffect 缺 report_key 时生成 18 位十六进制密钥并落库（只生成一次，二维码依赖它，变更会导致已发二维码失效）；
 *             缺开关时补 '1'；已存在的值原样沿用，不覆盖管理员的选择
 *
 * 只在「键不存在」时补默认值，判断用 undefined/null 而不是假值——
 * 管理员有意关成 '0' 时必须保持关闭，不能被默认值顶回开启。
 */
async function ensurePublicSettings() {
  const rows = await query(
    "SELECT k, v FROM sys_setting WHERE k IN ('report_key','report_enable','faq_enable','duty_contacts')"
  )
  const map = {}
  rows.forEach(r => { map[r.k] = r.v })

  let key = map.report_key ? String(map.report_key).trim() : ''
  if (!key) {
    key = require('crypto').randomBytes(9).toString('hex')
    await settingSet('report_key', key)
    console.log('[setting] 已自动生成报障入口密钥')
  }
  if (map.report_enable === undefined || map.report_enable === null) await settingSet('report_enable', '1')
  if (map.faq_enable === undefined || map.faq_enable === null) await settingSet('faq_enable', '1')

  // 值班 IT 联系方式（1~2 人），门户上渲染成可点击拨打的按钮
  let contacts = []
  try {
    const arr = JSON.parse(map.duty_contacts || '[]')
    if (Array.isArray(arr)) {
      contacts = arr
        .filter(c => c && String(c.phone || '').trim())
        .slice(0, 3)
        .map(c => ({ name: String(c.name || '').slice(0, 20), phone: String(c.phone).slice(0, 30), note: String(c.note || '').slice(0, 30) }))
    }
  } catch { contacts = [] }

  return {
    key,
    report_enable: (map.report_enable === undefined || map.report_enable === null) ? true : map.report_enable === '1',
    faq_enable: (map.faq_enable === undefined || map.faq_enable === null) ? true : map.faq_enable === '1',
    duty_contacts: contacts
  }
}

// 轻量迁移：为已有数据库补齐新增字段/新表（幂等，可重复执行）
/**
 * 启动时执行的轻量迁移总入口，每次启动都会跑一遍，必须整体幂等。
 *
 * 执行顺序有依赖：先建 sys_meta（后面的一次性修复要打标记）→ 补列 → 建表 → 数据修复 → 业务模块迁移。
 *
 * 三类操作的触发条件各不相同：
 * · 补列：information_schema 里查不到该列才 ALTER，已存在直接跳过；
 * · 建表：CREATE TABLE IF NOT EXISTS，表存在则整条语句无副作用；
 * · 数据修复：由 sys_meta 标记控制，全局只执行一次。
 *
 * 之所以「只补不覆盖」：升级场景下库里已经是用户在用的真实数据，
 * 迁移只允许往结构上补齐、往空值上填默认，任何覆盖都会造成数据丢失且不可回滚。
 *
 * @returns {Promise<void>}
 * @sideeffect 建表/补列/修复历史数据，均为可重复执行的写操作
 */
async function migrateSchema() {
  await ensureMetaTable()
  const checks = [
    { table: 'month_goal', column: 'finish_month', sql: "ALTER TABLE month_goal ADD COLUMN finish_month VARCHAR(7) NULL COMMENT '完成月份' AFTER is_finish" },
    // 知识库：AI 整理/编辑时需要更新 update_time（早期建表漏了此列，补上避免 500）
    { table: 'knowledge', column: 'update_time', sql: "ALTER TABLE knowledge ADD COLUMN update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER create_time" }
  ]
  for (const c of checks) {
    const cols = await query(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [c.table, c.column]
    )
    if (!cols.length) {
      await query(c.sql)
      console.log(`[migrate] ${c.table} 已新增 ${c.column} 列`)
    }
  }

  // 新表（CREATE TABLE IF NOT EXISTS，幂等）
  await query(`CREATE TABLE IF NOT EXISTS project (
    project_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id      INT UNSIGNED NOT NULL COMMENT '归属人',
    project_name VARCHAR(200) NOT NULL COMMENT '项目名称',
    project_desc TEXT NULL COMMENT '项目描述',
    stages       TEXT NULL COMMENT '阶段(JSON数组 [{name,done}])',
    start_date   DATE NULL COMMENT '开始日期',
    end_date     DATE NULL COMMENT '计划结束日期',
    progress     INT NOT NULL DEFAULT 0 COMMENT '进度百分比',
    status       VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active/done/paused',
    create_time  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id),
    KEY idx_user (user_id),
    KEY idx_status_end (status, end_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目管理表'`)

  // 兼容旧库：project 表补 stages 列（新库上面的 CREATE 已包含，故会跳过）
  const pStages = await query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    ['project', 'stages']
  )
  if (!pStages.length) {
    await query("ALTER TABLE project ADD COLUMN stages TEXT NULL COMMENT '阶段(JSON数组 [{name,done}])' AFTER project_desc")
    console.log('[migrate] project 已新增 stages 列')
  }

  await query(`CREATE TABLE IF NOT EXISTS monthly_report (
    report_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id     INT UNSIGNED NOT NULL COMMENT '归属人',
    report_month VARCHAR(7) NOT NULL COMMENT '归属月份，如 2026-10',
    content     MEDIUMTEXT NULL COMMENT '月度报告内容',
    create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (report_id),
    UNIQUE KEY uk_user_month (user_id, report_month)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='月度报告表'`)

  // 每用户独立的 AI 接入配置（供应商 / 接口地址 / Token / 模型），互不影响
  await query(`CREATE TABLE IF NOT EXISTS user_ai_config (
    config_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id     INT UNSIGNED NOT NULL COMMENT '归属用户',
    provider    VARCHAR(50) NOT NULL DEFAULT 'deepseek' COMMENT 'deepseek/openai/qwen/kimi/ollama/custom',
    api_url     VARCHAR(512) NOT NULL COMMENT 'OpenAI 兼容的 /chat/completions 完整地址',
    api_key     VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '用户自己的 Token',
    model       VARCHAR(100) NOT NULL DEFAULT 'deepseek-chat' COMMENT '模型名',
    is_enable   TINYINT NOT NULL DEFAULT 1 COMMENT '是否启用',
    create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (config_id),
    UNIQUE KEY uk_user (user_id),
    CONSTRAINT fk_uac_user FOREIGN KEY (user_id) REFERENCES sys_user (user_id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户AI接入配置表'`)

  // 服务器维护台账：计划 → 实施 → 结果三段式记录，支持照片留档
  // photos 存 JSON 数组（/uploads/ 下的地址），用于维护后调取现场照片
  await query(`CREATE TABLE IF NOT EXISTS server_maintenance (
    maint_id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id        INT UNSIGNED NOT NULL COMMENT '登记人',
    server_name    VARCHAR(120) NOT NULL COMMENT '服务器/主机名',
    maint_type     VARCHAR(30) NOT NULL DEFAULT '例行巡检' COMMENT '例行巡检/系统升级/补丁修复/硬件更换/故障处理/备份恢复',
    plan_content   TEXT NULL COMMENT '维护计划',
    exec_content   TEXT NULL COMMENT '实施过程',
    result_content TEXT NULL COMMENT '维护结果',
    result_state   VARCHAR(20) NOT NULL DEFAULT '' COMMENT '成功/部分成功/失败，空=尚未出结果',
    maint_status   VARCHAR(20) NOT NULL DEFAULT 'planned' COMMENT 'planned/processing/done',
    plan_date      DATE NULL COMMENT '计划日期',
    exec_date      DATE NULL COMMENT '实施日期',
    photos         TEXT NULL COMMENT '现场照片(JSON数组 /uploads/ 地址)',
    remark         VARCHAR(300) NULL,
    create_time    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (maint_id),
    KEY idx_user (user_id),
    KEY idx_status (maint_status),
    KEY idx_server (server_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='服务器维护台账'`)

  // 历史数据修复（时区 / 脏数据），只执行一次
  await repairLegacyData()

  // 业务模块表结构（故障/巡检/台账/审计/通知/SLA）
  await migrateModules()
}

// 后端启动时自动创建默认管理员（仅当用户表为空时执行）
// 生产环境建议通过 DEFAULT_ADMIN_PASSWORD 环境变量指定初始口令
/**
 * 初始化默认管理员。
 *
 * 触发条件：sys_user 表为空。只要已有任何一个账号就整体跳过——
 * 否则管理员删掉 admin 改名自用后，重启会凭空多出一个默认口令账号，
 * 等于给系统留了后门。二次创建时请走「账号管理」页面。
 *
 * @returns {Promise<void>}
 * @sideeffect 写入一条 admin 记录（口令 bcrypt 加盐哈希，不存明文）
 */
async function seedDefaultUsers() {
  const users = await query('SELECT COUNT(*) AS cnt FROM sys_user')
  if (users[0].cnt > 0) return

  const initPwd = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123'
  const pwdAdmin = await bcrypt.hash(initPwd, 10)

  await query(
    'INSERT INTO sys_user (username, password, real_name, role, is_enable) VALUES (?,?,?,?,1)',
    ['admin', pwdAdmin, '系统管理员', 'admin']
  )
  console.log('[seed] 已创建默认管理员账号 admin，请登录后立即修改密码')
}

// 导出即本模块的对外契约：index.js 只用 seedDefaultUsers / migrateSchema，
// 其余路由通过 settingGet / settingSet / ensurePublicSettings 读写系统设置
module.exports = { seedDefaultUsers, migrateSchema, settingGet, settingSet, ensurePublicSettings }
