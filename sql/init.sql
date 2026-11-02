-- =============================================================================
--  IT 运维工单台账与日报自动管理系统 —— 数据库初始化脚本
--  ---------------------------------------------------------------------------
--  用途：全新部署时自动建库建表并写入初始配置（Docker 首次启动自动执行）
--  引擎：InnoDB        字符集：utf8mb4        时区：+08:00（北京时间）
--  执行：mysql -uroot -p itops < sql/init.sql
--  说明：脚本幂等（CREATE TABLE IF NOT EXISTS / INSERT IGNORE），
--        可重复执行，不会清空已有业务数据。
--  兼容：MySQL 8.0 与 MariaDB 10.11 均可直接执行
--        （本脚本不使用 mysql_native_password / caching_sha2_password 等
--          数据库专有的建用户语法，账号由 Docker 入口按 env 自动创建）
--  作者：锦轩 (JinXuan) <2686389727@qq.com>    版本：1.2.2    创建：2026-10-29
--  Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
--  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
--        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';

-- =============================================================================
--  说明：数据库账号与库由容器入口脚本根据环境变量自动创建
--        （MARIADB_ROOT_PASSWORD / MARIADB_DATABASE / MARIADB_USER / MARIADB_PASSWORD）。
--        此处刻意不再写 CREATE USER / GRANT：
--        · MySQL 8 用 IDENTIFIED WITH mysql_native_password，MariaDB 不认这套语法；
--        · 而且入口脚本已按 env 建好账号，重复建会与 env 口令不一致，导致后端连不上库。
--        手工执行本脚本时，请先自行建库并授权：
--          CREATE DATABASE IF NOT EXISTS itops DEFAULT CHARSET utf8mb4;
-- =============================================================================

-- =============================================================================
--  一、系统基础表
-- =============================================================================
-- -----------------------------------------------------------------------------
-- 1. 用户表（登录账号 + 角色权限）
--    角色：admin 管理员 / auditor 审计员（全公司只读）/ service 服务台 / user 运维工程师
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sys_user` (
  `user_id`     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`    VARCHAR(50)  NOT NULL COMMENT '登录账号',
  `password`    VARCHAR(100) NOT NULL COMMENT 'bcrypt 加密存储',
  `real_name`   VARCHAR(50)  NOT NULL DEFAULT '' COMMENT '姓名',
  `role`        VARCHAR(20)  NOT NULL DEFAULT 'user' COMMENT 'admin/auditor/service/user',
  `is_enable`   TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '是否启用（停用后立即掉线）',
  `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表（权限隔离）';

-- -----------------------------------------------------------------------------
-- 2. 基础字典表（部门 / 应用系统 / 问题类别），前端下拉统一取此表
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sys_dict` (
  `dict_id`     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dict_type`   VARCHAR(30)  NOT NULL COMMENT 'dept / app_system / problem_type',
  `dict_label`  VARCHAR(100) NOT NULL COMMENT '显示名称',
  `dict_value`  VARCHAR(100) NOT NULL COMMENT '存储值（与 label 一致，便于扩展）',
  `sort`        INT          NOT NULL DEFAULT 0 COMMENT '排序（越小越靠前）',
  `is_enable`   TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '停用后历史保留，新单不可选',
  `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`dict_id`),
  KEY `idx_type` (`dict_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='基础字典表（部门/应用系统/问题类别）';

-- -----------------------------------------------------------------------------
-- 3. 系统公共设置（键值对：免登录入口开关、巡检模板等）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sys_setting` (
  `k`           VARCHAR(64) NOT NULL,
  `v`           TEXT NULL,
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`k`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统公共设置';

-- -----------------------------------------------------------------------------
-- 4. 系统元信息（一次性迁移标记，避免数据修复重复执行）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sys_meta` (
  `meta_key`    VARCHAR(64)  NOT NULL,
  `meta_value`  VARCHAR(255) NULL,
  `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`meta_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统元信息（一次性迁移标记）';

-- -----------------------------------------------------------------------------
-- 5. 操作审计日志（谁在什么时候改了什么）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `audit_log` (
  `log_id`      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NULL,
  `username`    VARCHAR(50)  NULL,
  `role`        VARCHAR(20)  NULL,
  `method`      VARCHAR(10)  NULL COMMENT 'GET/POST/PUT/DELETE',
  `path`        VARCHAR(255) NULL COMMENT '请求路径',
  `action`      VARCHAR(100) NULL COMMENT '动作描述',
  `target`      VARCHAR(255) NULL COMMENT '操作对象',
  `detail`      TEXT         NULL COMMENT '关键参数（已脱敏）',
  `ip`          VARCHAR(64)  NULL,
  `status_code` INT          NULL,
  `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`log_id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_time` (`create_time`),
  KEY `idx_path` (`path`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作审计日志';

-- =============================================================================
--  二、运维业务表
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 6. 运维工单表（核心）
--    状态机：pending 待接单 → processing 处理中 → done 已完成
--    SLA：创建时按「问题类别 + 优先级」算 respond_time / resolve_time 应达时间
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `ticket` (
  `ticket_id`        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`          INT UNSIGNED NOT NULL COMMENT '归属人（提单人）',
  `assignee_id`      INT UNSIGNED NULL COMMENT '指派/抢单给谁',
  `assign_time`      DATETIME     NULL COMMENT '指派时间',
  `respond_time`     DATETIME     NULL COMMENT '首次响应时间',
  `sla_respond_due`  DATETIME     NULL COMMENT '响应应达时间',
  `sla_resolve_due`  DATETIME     NULL COMMENT '解决应达时间',
  `happen_time`      DATETIME     NULL COMMENT '具体发生时间',
  `contact`          VARCHAR(100) NULL COMMENT '联系人',
  `dept`             VARCHAR(100) NULL COMMENT '部门（字典）',
  `service_content`  TEXT         NULL COMMENT '运维服务内容',
  `app_system`       VARCHAR(100) NULL COMMENT '应用系统（字典）',
  `problem_type`     VARCHAR(100) NULL COMMENT '问题类别（字典）',
  `finish_time`      DATETIME     NULL COMMENT '服务完成时间',
  `handle_desc`      TEXT         NULL COMMENT '处理说明',
  `status`           VARCHAR(20)  NOT NULL DEFAULT 'processing' COMMENT 'pending/processing/done',
  `priority`         VARCHAR(20)  NOT NULL DEFAULT 'normal' COMMENT 'low/normal/high/urgent',
  `sync_kb`          TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '完成后是否同步知识库',
  `source`           VARCHAR(20)  NOT NULL DEFAULT 'manual' COMMENT 'manual/qr/import',
  `report_no`        VARCHAR(24)  NULL COMMENT '报障单号（免登录报障入口生成）',
  `reporter_phone`   VARCHAR(30)  NULL COMMENT '报障人手机号',
  `satisfy_score`    TINYINT      NULL COMMENT '满意度 1-5',
  `satisfy_comment`  VARCHAR(500) NULL COMMENT '满意度评价内容',
  `satisfy_time`     DATETIME     NULL COMMENT '评价时间',
  `attachment`       JSON         NULL COMMENT '附件路径数组',
  `create_time`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`ticket_id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_assignee` (`assignee_id`),
  KEY `idx_happen` (`happen_time`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='运维工单表（核心表）';

-- -----------------------------------------------------------------------------
-- 7. 工单处理时长视图（分钟），报表/趋势图直接查询，避免前端重复计算
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `v_ticket_duration` AS
SELECT
  `ticket_id`,
  `user_id`,
  `happen_time`,
  `finish_time`,
  TIMESTAMPDIFF(MINUTE, `happen_time`, `finish_time`) AS `duration_minutes`
FROM `ticket`
WHERE `status` = 'done'
  AND `happen_time` IS NOT NULL
  AND `finish_time` IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 8. 待办任务表（手动待办 + 日报「明日计划」自动转待办 + 抢单提醒）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `todo` (
  `todo_id`     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL COMMENT '归属人',
  `ticket_id`   INT UNSIGNED NULL COMMENT '关联工单（抢单提醒，点击直达详情）',
  `todo_title`  VARCHAR(200) NOT NULL COMMENT '待办标题',
  `todo_detail` TEXT         NULL COMMENT '详情',
  `plan_date`   DATE         NULL COMMENT '计划执行日期',
  `is_finish`   TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否完成',
  `source`      VARCHAR(20)  NOT NULL DEFAULT 'manual' COMMENT 'manual / daily_report',
  `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`todo_id`),
  KEY `idx_user_plan` (`user_id`, `plan_date`),
  KEY `idx_finish` (`is_finish`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='待办任务表';

-- -----------------------------------------------------------------------------
-- 9. 月度目标表（权重仅标识重要性；完成时自动记录完成月份）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `month_goal` (
  `goal_id`      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`      INT UNSIGNED NOT NULL COMMENT '归属人',
  `goal_month`   VARCHAR(7)   NOT NULL COMMENT '归属月份，如 2026-10',
  `goal_content` TEXT         NOT NULL COMMENT '目标描述',
  `weight_score` INT          NOT NULL DEFAULT 0 COMMENT '权重分值',
  `is_finish`    TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否完成',
  `finish_month` VARCHAR(7)   NULL COMMENT '完成月份，如 2026-10',
  `create_time`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`goal_id`),
  KEY `idx_user_month` (`user_id`, `goal_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='月度目标表';

-- -----------------------------------------------------------------------------
-- 10. 个人运维知识库（可标记公开，作为「常见问题自助门户」FAQ）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `knowledge` (
  `kb_id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         INT UNSIGNED NOT NULL COMMENT '归属人',
  `app_system`      VARCHAR(100) NULL COMMENT '应用系统（字典）',
  `problem_type`    VARCHAR(100) NULL COMMENT '问题类别（字典）',
  `problem_summary` VARCHAR(300) NULL COMMENT '问题摘要',
  `solution`        TEXT         NULL COMMENT '处理方案',
  `keyword`         VARCHAR(300) NULL COMMENT '关键词（自动提取，可手动补充）',
  `is_public`       TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否公开到自助门户',
  `faq_hits`        INT          NOT NULL DEFAULT 0 COMMENT '自助门户查看次数',
  `source_ticket_id` INT UNSIGNED NULL COMMENT '来源工单 ID',
  `attachment`      JSON         NULL COMMENT '附件路径数组',
  `view_count`      INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '浏览次数',
  `create_time`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`kb_id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_app_type` (`app_system`, `problem_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='个人运维知识库表';

-- -----------------------------------------------------------------------------
-- 11. 日报记录表（每人每天一条，纯文本）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daily_report` (
  `report_id`     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       INT UNSIGNED NOT NULL COMMENT '归属人',
  `report_date`   DATE         NOT NULL COMMENT '汇报日期',
  `today_work`    TEXT         NULL COMMENT '今日工作汇报内容',
  `need_help`     TEXT         NULL COMMENT '需协调解决的问题',
  `tomorrow_plan` TEXT         NULL COMMENT '明日工作计划（提交后转待办）',
  `create_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`report_id`),
  UNIQUE KEY `uk_user_date` (`user_id`, `report_date`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='日报记录表';

-- -----------------------------------------------------------------------------
-- 12. 月度报告表（每人每月一条，可手动编写或一键生成）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `monthly_report` (
  `report_id`    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`      INT UNSIGNED NOT NULL COMMENT '归属人',
  `report_month` VARCHAR(7)   NOT NULL COMMENT '归属月份，如 2026-10',
  `content`      MEDIUMTEXT   NULL COMMENT '月度报告内容',
  `create_time`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`report_id`),
  UNIQUE KEY `uk_user_month` (`user_id`, `report_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='月度报告表';

-- -----------------------------------------------------------------------------
-- 13. 故障管理（大范围故障 / 事件管理，P1~P4）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `incident` (
  `incident_id`      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`          INT UNSIGNED NOT NULL COMMENT '登记人',
  `incident_no`      VARCHAR(24)  NOT NULL COMMENT '故障编号',
  `title`            VARCHAR(200) NOT NULL COMMENT '故障标题',
  `level`            VARCHAR(10)  NOT NULL DEFAULT 'P3' COMMENT 'P1/P2/P3/P4',
  `scope`            VARCHAR(200) NULL COMMENT '影响范围（部门/区域）',
  `affected_systems` VARCHAR(300) NULL COMMENT '受影响系统',
  `start_time`       DATETIME     NULL COMMENT '发生时间',
  `accept_time`      DATETIME     NULL COMMENT '接单时间',
  `finish_time`      DATETIME     NULL COMMENT '恢复时间',
  `cause`            TEXT         NULL COMMENT '故障原因',
  `process`          TEXT         NULL COMMENT '处理过程',
  `review`           TEXT         NULL COMMENT '复盘总结',
  `status`           VARCHAR(20)  NOT NULL DEFAULT 'ongoing' COMMENT 'ongoing/resolved',
  `create_time`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`incident_id`),
  UNIQUE KEY `uk_incident_no` (`incident_no`),
  KEY `idx_start` (`start_time`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='故障管理（事件）';

-- -----------------------------------------------------------------------------
-- 14. 机房 / 设备巡检记录（异常可一键转工单）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `inspection` (
  `inspection_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       INT UNSIGNED NOT NULL COMMENT '巡检人',
  `insp_date`     DATE         NOT NULL COMMENT '巡检日期',
  `area`          VARCHAR(100) NULL COMMENT '巡检区域（机房/楼层/设备组）',
  `items`         JSON         NULL COMMENT '巡检项 [{name,done,note}]',
  `result`        VARCHAR(20)  NOT NULL DEFAULT 'normal' COMMENT 'normal/abnormal',
  `remark`        TEXT         NULL COMMENT '备注',
  `ticket_id`     INT UNSIGNED NULL COMMENT '异常转工单 ID',
  `create_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`inspection_id`),
  KEY `idx_user_date` (`user_id`, `insp_date`),
  KEY `idx_date` (`insp_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='巡检记录';

-- -----------------------------------------------------------------------------
-- 15. 账号与权限台账
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `account_ledger` (
  `account_id`      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         INT UNSIGNED NOT NULL COMMENT '登记人',
  `system_name`     VARCHAR(100) NULL COMMENT '所属系统',
  `account_name`    VARCHAR(100) NULL COMMENT '账号',
  `owner_name`      VARCHAR(100) NULL COMMENT '使用人',
  `dept`            VARCHAR(100) NULL COMMENT '部门',
  `action`          VARCHAR(20)  NOT NULL DEFAULT '开通' COMMENT '开通/变更/注销',
  `permission_desc` TEXT         NULL COMMENT '权限说明',
  `operate_date`    DATE         NULL COMMENT '操作日期',
  `status`          VARCHAR(20)  NOT NULL DEFAULT 'active' COMMENT 'active/closed',
  `remark`          VARCHAR(300) NULL,
  `create_time`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`account_id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_owner` (`owner_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账号与权限台账';

-- -----------------------------------------------------------------------------
-- 16. 项目管理表
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `project` (
  `project_id`   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`      INT UNSIGNED NOT NULL COMMENT '归属人',
  `project_name` VARCHAR(200) NOT NULL COMMENT '项目名称',
  `project_desc` TEXT         NULL COMMENT '项目描述',
  `stages`       TEXT         NULL COMMENT '阶段 JSON 数组 [{name,done}]',
  `start_date`   DATE         NULL COMMENT '开始日期',
  `end_date`     DATE         NULL COMMENT '计划结束日期',
  `progress`     INT          NOT NULL DEFAULT 0 COMMENT '进度百分比',
  `status`       VARCHAR(20)  NOT NULL DEFAULT 'active' COMMENT 'active/done/paused',
  `create_time`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`project_id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_status_end` (`status`, `end_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目管理表';

-- -----------------------------------------------------------------------------
-- 17. SLA 时效策略（* 为默认兜底；priority 为 NULL 表示不限优先级）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sla_policy` (
  `policy_id`     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `problem_type`  VARCHAR(100)  NOT NULL DEFAULT '*' COMMENT '问题类别，* 为默认',
  `priority`      VARCHAR(20)   NULL COMMENT '优先级限制，NULL 表示不限',
  `respond_hours` DECIMAL(5,1)  NOT NULL DEFAULT 4.0 COMMENT '响应时限（小时）',
  `resolve_hours` DECIMAL(6,1)  NOT NULL DEFAULT 24.0 COMMENT '解决时限（小时）',
  `remark`        VARCHAR(200)  NULL,
  `create_time`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`policy_id`),
  KEY `idx_type` (`problem_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='SLA 时效策略';

-- -----------------------------------------------------------------------------
-- 18. 消息通知配置（企微 / 钉钉 / 飞书群机器人）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `notify_config` (
  `config_id`   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL COMMENT '归属人（管理员接收）',
  `channel`     VARCHAR(20)  NOT NULL DEFAULT 'wecom' COMMENT 'wecom/dingtalk/feishu/webhook',
  `webhook`     VARCHAR(512) NOT NULL COMMENT '机器人 Webhook 地址',
  `secret`      VARCHAR(200) NULL COMMENT '加签密钥（钉钉可选）',
  `events`      VARCHAR(300) NOT NULL DEFAULT 'overdue,report,incident' COMMENT '订阅事件',
  `is_enable`   TINYINT(1)   NOT NULL DEFAULT 1,
  `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`config_id`),
  UNIQUE KEY `uk_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='消息通知配置';

-- -----------------------------------------------------------------------------
-- 19. 用户 AI 接入配置（每人独立填写 Token，互不影响）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_ai_config` (
  `config_id`   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL COMMENT '归属用户',
  `provider`    VARCHAR(50)  NOT NULL DEFAULT 'deepseek' COMMENT 'deepseek/openai/qwen/kimi/ollama/custom',
  `api_url`     VARCHAR(512) NOT NULL COMMENT 'OpenAI 兼容的 /chat/completions 完整地址',
  `api_key`     VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '用户自己的 Token',
  `model`       VARCHAR(100) NOT NULL DEFAULT 'deepseek-chat' COMMENT '模型名',
  `is_enable`   TINYINT      NOT NULL DEFAULT 1 COMMENT '是否启用',
  `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`config_id`),
  UNIQUE KEY `uk_user` (`user_id`),
  CONSTRAINT `fk_uac_user` FOREIGN KEY (`user_id`) REFERENCES `sys_user` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户AI接入配置表';

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
--  三、初始数据
--  说明：管理员账号由后端首次启动时自动创建（bcrypt 哈希由程序生成，
--        默认 admin / admin123，登录后请立刻修改）。此处不硬编码密码。
-- =============================================================================

-- ---------------------------- 3.1 部门字典 ----------------------------
-- 按 dict_type 判空后整组写入：重复执行本脚本不会产生重复字典项
INSERT INTO `sys_dict` (`dict_type`, `dict_label`, `dict_value`, `sort`)
SELECT * FROM (
            SELECT 'dept' AS t, '总经办'           AS l, '总经办'           AS v,  1 AS s
  UNION ALL SELECT 'dept', '财务中心',         '财务中心',          2
  UNION ALL SELECT 'dept', '行政与后勤保障部', '行政与后勤保障部',  3
  UNION ALL SELECT 'dept', '研发中心',         '研发中心',          4
  UNION ALL SELECT 'dept', '营销中心',         '营销中心',          6
  UNION ALL SELECT 'dept', '组织与人才发展部', '组织与人才发展部',  7
  UNION ALL SELECT 'dept', '测试验证部',       '测试验证部',        8
  UNION ALL SELECT 'dept', '制造中心',         '制造中心',          8
  UNION ALL SELECT 'dept', '品质管理部',       '品质管理部',       10
  UNION ALL SELECT 'dept', '数自研发部',       '数自研发部',       10
  UNION ALL SELECT 'dept', '数自营销部',       '数自营销部',       10
  UNION ALL SELECT 'dept', '2025实验室',       '2025实验室',       10
  UNION ALL SELECT 'dept', '综合管理部',       '综合管理部',       10
) d
WHERE NOT EXISTS (SELECT 1 FROM `sys_dict` WHERE `dict_type` = 'dept');

-- ---------------------------- 3.2 应用系统字典 ----------------------------
INSERT INTO `sys_dict` (`dict_type`, `dict_label`, `dict_value`, `sort`)
SELECT * FROM (
            SELECT 'app_system' AS t, 'OA 办公系统' AS l, 'OA 办公系统' AS v,  1 AS s
  UNION ALL SELECT 'app_system', 'ERP 系统',      'ERP 系统',       2
  UNION ALL SELECT 'app_system', '邮件系统',      '邮件系统',       3
  UNION ALL SELECT 'app_system', '财务系统',      '财务系统',       4
  UNION ALL SELECT 'app_system', '计算机',        '计算机',         4
  UNION ALL SELECT 'app_system', '金蝶云',        '金蝶云',         4
  UNION ALL SELECT 'app_system', '天锐绿盾',      '天锐绿盾',       4
  UNION ALL SELECT 'app_system', '官网',          '官网',           5
  UNION ALL SELECT 'app_system', 'office',        'office',         5
  UNION ALL SELECT 'app_system', 'VPN',           'VPN',            6
  UNION ALL SELECT 'app_system', '打印机/外设',   '打印机/外设',    7
  UNION ALL SELECT 'app_system', '网络/交换机',   '网络/交换机',    8
  UNION ALL SELECT 'app_system', '钉钉',          '钉钉',           9
  UNION ALL SELECT 'app_system', '服务器',        '服务器',        10
  UNION ALL SELECT 'app_system', '云桌面',        '云桌面',        11
  UNION ALL SELECT 'app_system', 'i人事',         'i人事',         12
  UNION ALL SELECT 'app_system', '云盘',          '云盘',          13
) d
WHERE NOT EXISTS (SELECT 1 FROM `sys_dict` WHERE `dict_type` = 'app_system');

-- ---------------------------- 3.3 问题类别字典 ----------------------------
INSERT INTO `sys_dict` (`dict_type`, `dict_label`, `dict_value`, `sort`)
SELECT * FROM (
            SELECT 'problem_type' AS t, '账号权限问题' AS l, '账号权限问题' AS v, 1 AS s
  UNION ALL SELECT 'problem_type', '软件安装', '软件安装', 2
  UNION ALL SELECT 'problem_type', '网络问题', '网络问题', 3
  UNION ALL SELECT 'problem_type', '操作问题', '操作问题', 3
  UNION ALL SELECT 'problem_type', '配置问题', '配置问题', 3
  UNION ALL SELECT 'problem_type', '硬件问题', '硬件问题', 3
  UNION ALL SELECT 'problem_type', '硬件故障', '硬件故障', 4
  UNION ALL SELECT 'problem_type', '系统安装', '系统安装', 4
  UNION ALL SELECT 'problem_type', '系统配置', '系统配置', 5
  UNION ALL SELECT 'problem_type', '数据问题', '数据问题', 6
  UNION ALL SELECT 'problem_type', '数据导出', '数据导出', 6
  UNION ALL SELECT 'problem_type', '病毒/安全', '病毒/安全', 7
  UNION ALL SELECT 'problem_type', '其他咨询', '其他咨询', 8
  UNION ALL SELECT 'problem_type', '驱动问题', '驱动问题', 8
) d
WHERE NOT EXISTS (SELECT 1 FROM `sys_dict` WHERE `dict_type` = 'problem_type');

-- ---------------------------- 3.4 SLA 默认策略 ----------------------------
-- 匹配顺序：先精确匹配「问题类别 + 优先级」，再退回 priority 相同的 '*'，最后取
-- respond_hours 最宽的兜底策略。管理员可在「系统设置 → SLA」中调整。
INSERT IGNORE INTO `sla_policy` (`policy_id`, `problem_type`, `priority`, `respond_hours`, `resolve_hours`, `remark`) VALUES
(1, '*', 'low',    2.0, 24.0, '低优先级：2 小时内响应，24 小时内解决'),
(2, '*', 'normal', 1.0, 24.0, '普通问题：1 小时内响应，24 小时内解决'),
(3, '*', 'high',   0.5,  4.0, '高优先级：30 分钟内响应，4 小时内解决'),
(4, '*', 'urgent', 0.5,  2.0, '紧急问题：30 分钟内响应，2 小时内解决');

-- ---------------------------- 3.5 系统公共设置 ----------------------------
-- report_key（免登录报障入口密钥）由后端首次启动随机生成，保证每个部署实例不同
INSERT IGNORE INTO `sys_setting` (`k`, `v`) VALUES
('report_enable',      '1'),
('faq_enable',         '1'),
('service_desk_enable','0'),
('inspection_areas',   '["主机房","网络机房"]'),
('inspection_items',   '[{"name":"机房温湿度（拍照记录读数）","need_photo":true},{"name":"UPS / 电源指示正常","need_photo":false},{"name":"服务器运行状态正常","need_photo":false},{"name":"网络设备指示灯正常","need_photo":false},{"name":"监控平台无未处理告警","need_photo":false},{"name":"消防设施与门禁正常","need_photo":false}]');

-- =============================================================================
--  初始化完成。首次启动后端将自动：
--    1) 创建默认管理员账号 admin / admin123（请立即修改）
--    2) 生成免登录报障入口密钥 report_key
--    3) 校验并补齐任何缺失的字段/索引（幂等迁移）
-- =============================================================================
