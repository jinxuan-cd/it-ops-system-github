-- =============================================================================
--  IT 运维工单台账与日报自动管理系统 —— 数据库初始化脚本
--  ---------------------------------------------------------------------------
--  用途：全新部署时自动建库建表并写入初始配置（Docker 首次启动自动执行）
--  引擎：InnoDB        字符集：utf8mb4        时区：+08:00（北京时间）
--  执行：mysql -uroot -p itops < sql/init.sql
--  说明：脚本幂等（CREATE TABLE IF NOT EXISTS / INSERT IGNORE / WHERE NOT EXISTS），
--        可重复执行，不会清空已有业务数据；初始化即自带 43 条自助排障常见问题。
--  兼容：MySQL 8.0 与 MariaDB 10.11 均可直接执行
--        （本脚本不使用 mysql_native_password / caching_sha2_password 等
--          数据库专有的建用户语法，账号由 Docker 入口按 env 自动创建）
--  作者：锦轩 (JinXuan) <2686389727@qq.com>    版本：1.4.2    创建：2026-10-29
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
  `assign_time`      DATETIME     NULL COMMENT '最近一次指派/派单时间（转单会覆盖）',
  `respond_time`     DATETIME     NULL COMMENT '响应时间：补单时按录入时刻自动生成，员工提单后由接单/派单时刻写入；绝不取完成时间',
  `accept_time`      DATETIME     NULL COMMENT '开始处理时间：首次接单/派单时刻，转单不覆盖；补单为空（按发生时间起算）',
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
-- 口径（2026-11 起）：响应时限从「发生时间」起算到接单/派单；完成时限从「接单时间」起算到结束时间。
-- 默认只放一条兜底策略（4 小时响应 / 24 小时解决），小团队够用；
-- 需要按优先级收紧时，再在「系统设置 → SLA」里给具体「类别 + 优先级」加行，
-- 精确行会覆盖这条默认策略。
INSERT IGNORE INTO `sla_policy` (`policy_id`, `problem_type`, `priority`, `respond_hours`, `resolve_hours`, `remark`) VALUES
(1, '*', NULL, 4.0, 24.0, '默认策略：4 小时内响应，接单后 24 小时内解决');

-- ---------------------------- 3.5 系统公共设置 ----------------------------
-- report_key（免登录报障入口密钥）由后端首次启动随机生成，保证每个部署实例不同
INSERT IGNORE INTO `sys_setting` (`k`, `v`) VALUES
('report_enable',      '1'),
('faq_enable',         '1'),
('service_desk_enable','0'),
('inspection_areas',   '["主机房","网络机房"]'),
('inspection_items',   '[{"name":"机房温湿度（拍照记录读数）","need_photo":true},{"name":"UPS / 电源指示正常","need_photo":false},{"name":"服务器运行状态正常","need_photo":false},{"name":"网络设备指示灯正常","need_photo":false},{"name":"监控平台无未处理告警","need_photo":false},{"name":"消防设施与门禁正常","need_photo":false}]');

-- ---------------------------- 3.6 面向电脑小白的自助排障常见问题 ----------------------------
-- 43 条分步问答，初始化即写入并标记 is_public = 1（员工在自助门户免登录可见），
-- 不依赖后端启动迁移，删库重建 / 换机器部署都会自带这批数据。
-- 归属人固定为 1：全新库首次启动由后端创建的管理员，自增必为 1；知识表无外键，
-- 该账号后续改名或停用不影响门户展示；管理员在「常见问题管理」里可正常编辑。
-- 每条带 WHERE NOT EXISTS：重复执行本脚本不会插出第二份，也不会覆盖手工改过的内容。
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '电脑与系统', '开不了机', '电脑按开机键没反应，屏幕一直是黑的', '1. 先看主机或显示器上的电源灯亮不亮；不亮就把电源线两头重新插紧，再按一次开机键。
2. 换一个墙上插座试试（插排开关有时被关掉），确认插排指示灯是亮的。
3. 显示器单独检查：按一下显示器电源键，看它是否提示「无信号」。有提示说明显示器正常，问题在主机。
4. 长按开机键 10 秒彻底关机，等 30 秒后再按一次开机。
5. 都试过还是没反应，请报障，并写明：电源灯亮不亮、有没有听到风扇声、主机有没有「滴」的一声。', '开不了机 黑屏 没反应 电源 主机 开机', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '电脑按开机键没反应，屏幕一直是黑的');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '电脑与系统', '黑屏', '电脑开了但屏幕黑屏，提示「无信号」', '1. 确认显示器电源灯亮着；不亮就检查显示器电源线和开关。
2. 把连接主机和显示器的那根线（HDMI / DP / VGA）两头拔下来重新插紧。
3. 显示器上一般有个「信号源 / Source / Input」按钮，按一下切换到对应的 HDMI 或 DP。
4. 如果主机接着两台显示器，换一根线或换到另一个接口试一下。
5. 仍黑屏请报障，写明屏幕上具体显示的文字，以及换线后有没有变化。', '黑屏 无信号 显示器 信号线 HDMI VGA', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '电脑开了但屏幕黑屏，提示「无信号」');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '电脑与系统', '蓝屏', '电脑突然蓝屏，出现一堆英文和一个哭脸', '1. 先别慌，蓝屏一般不会删除你的文件。用手机把整块蓝屏拍一张照，报障时非常有用。
2. 长按开机键 10 秒关机，等半分钟再开机，看能否正常进系统。
3. 能进系统后，先把正在编辑的文档保存好；回想一下蓝屏前是不是刚插了 U 盘、装了软件或接了新设备，先拔掉再观察。
4. 如果一天内蓝屏两次以上，不要继续反复重启，直接报障。
5. 报障时请附上蓝屏照片，并写明大约什么时间、当时在打开什么软件。', '蓝屏 死机 重启 英文 哭脸', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '电脑突然蓝屏，出现一堆英文和一个哭脸');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '电脑与系统', '自动重启', '电脑用着用着自己重启了，或者反复重启进不去系统', '1. 如果屏幕上有「正在更新 / 请勿关闭电源」之类提示，请耐心等 20～30 分钟，更新中途断电容易出问题。
2. 没有更新提示却反复重启，先拔掉所有外接设备（U 盘、移动硬盘、打印机线），再开机。
3. 记下重启前正在做的事和大约时间点。
4. 重启超过 3 次就不要再试了，报障并写明出现频率，避免硬盘里的文件受损。', '自动重启 反复重启 循环 更新', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '电脑用着用着自己重启了，或者反复重启进不去系统');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '电脑与系统', '运行变慢', '电脑特别卡，打开软件、切换窗口都要等很久', '1. 先保存手头文件，然后把暂时不用的软件窗口关掉，尤其是浏览器里开着的很多标签页。
2. 按 Ctrl + Shift + Esc 打开任务管理器，看「CPU / 内存 / 磁盘」哪一栏长期接近 100%，把占用最高的、你自己认识的程序结束掉（不认识的程序不要动）。
3. 重启一次电脑，很多临时卡顿重启后就好了。
4. 如果只有打开某个软件才卡，把这个软件名字记下来。
5. 每天都很卡请报障，写明什么时候开始的、卡的时候在用什么软件。', '卡顿 很慢 转圈 无响应 死机', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '电脑特别卡，打开软件、切换窗口都要等很久');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '电脑与系统', '发热异响', '电脑风扇声音特别大，机身很烫', '1. 把电脑从被褥、书本、纸箱等软物上移到硬质桌面上，四周留出空隙，别挡住侧面和底部的出风口。
2. 用软毛刷或干布轻轻清理出风口表面的灰尘，不要往机器里吹气或喷水。
3. 关掉暂时不用的大型软件，观察 10 分钟声音是否变小。
4. 如果出现焦味、机身烫到不能碰、或伴随自动关机，请立刻关机断电并报障，不要再开机。', '发烫 风扇响 噪音 散热 过热', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '电脑风扇声音特别大，机身很烫');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '电脑与系统', '磁盘空间', '电脑提示「磁盘空间不足」，C 盘变红了', '1. 先清空回收站：桌面找到「回收站」，右键选「清空回收站」（先确认里面没有还要的文件）。
2. 打开「此电脑」，右键 C 盘 → 属性 → 磁盘清理，勾选临时文件后清理。
3. 把桌面上大的视频、压缩包、安装包移到 D 盘或公司共享盘；不要直接删除不认识的系统文件夹。
4. 微信 / 企业微信会在电脑里存很多聊天图片，可在它的「设置 → 文件管理」里清理缓存。
5. 清理后仍然告警，或不确定哪些能删，请报障，不要自行删除系统文件。', '磁盘满 C盘红 空间不足 存不下', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '电脑提示「磁盘空间不足」，C 盘变红了');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '电脑与系统', '系统更新', '电脑一直卡在「正在更新」，很久都不动', '1. 只要屏幕上的百分比或转圈还在动，就说明在更新，请耐心等待，大更新可能要 30 分钟以上。
2. 更新期间请接上电源，不要合盖、不要长按电源键强制关机。
3. 超过 1 小时完全没有任何变化（数字不动、灯不闪），用手机拍张照再报障。
4. 报障时写明卡在百分之多少、已经等了多久，方便判断是正常等待还是真卡死。', '系统更新 卡住 百分比 请勿关机', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '电脑一直卡在「正在更新」，很久都不动');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '电脑与系统', '时间不对', '电脑右下角的时间不对，差了几分钟或几小时', '1. 右键点击右下角时间 →「调整日期/时间」，把「自动设置时间」打开。
2. 点「立即同步」（Windows 10/11 在「其他设置」里），等它同步完成。
3. 如果提示同步失败，可能是网络问题，先按「连不上网」那条排查。
4. 时间不准会影响登录、打卡和证书，反复不准请报障。', '时间不准 日期错误 时钟 同步', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '电脑右下角的时间不对，差了几分钟或几小时');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '电脑与系统', 'U盘', 'U 盘插上电脑没反应，找不到盘符', '1. 换一个 USB 口再插一次，优先插主机后面（台式机）而不是前面板或扩展坞。
2. 打开「此电脑」看有没有多出来一个盘；也可以等 10 秒，第一次识别会慢一点。
3. 把这个 U 盘插到另一台电脑试一下：另一台也不认，多半是 U 盘本身的问题。
4. 不要反复插拔或用力晃动接口。
5. 里面有重要文件时不要自行格式化或点「修复磁盘」，直接报障说明情况。', 'U盘 移动硬盘 不识别 没反应 读不到', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = 'U 盘插上电脑没反应，找不到盘符');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '电脑与系统', '键鼠外设', '键盘或鼠标突然不能用了', '1. 无线的先换新电池，或确认开关在「ON」、接收器插好了。
2. 有线的把插头重新插紧，换一个 USB 口试试。
3. 按一下键盘上的 Num Lock 键看指示灯是否亮，判断键盘有没有供电。
4. 重启一次电脑，很多临时失灵会恢复。
5. 只有某一个软件里不能用，多半是软件问题；全局都不能用请报障，写明有线还是无线。', '键盘 鼠标 失灵 没反应 无线', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '键盘或鼠标突然不能用了');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '电脑与系统', '显示异常', '屏幕闪烁、颜色发黄或显示很模糊', '1. 把显示器信号线两头重新插紧，换一个接口试一下。
2. 桌面空白处右键 →「显示设置」→ 把分辨率改成带「推荐」两个字的那一项。
3. 关掉台灯直射或强反光，确认不是环境光造成的错觉。
4. 如果屏幕出现彩色竖条、白线或局部黑块，用手机拍照后报障，这类通常是硬件问题。', '闪烁 花屏 颜色不对 模糊 分辨率', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '屏幕闪烁、颜色发黄或显示很模糊');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '网络与上网', '连不上网', '电脑上不了网，网页全都打不开', '1. 先确认是不是只有你一台电脑这样：问下旁边同事，或手机连公司 WiFi 试一下。别人也上不了，可能是整体网络故障，直接报障即可。
2. 只有你不行：把网线两头重新插紧，看网口小灯是否亮/闪。
3. 右键点任务栏的网络图标 →「疑难解答」，让它自动修复一次。
4. 还不行就重启电脑，再重启一次你工位上的小交换机（如果有）。
5. 仍不行请报障，写明：工位位置、有线还是 WiFi、网口灯亮不亮、别人是否正常。', '上不了网 断网 网页打不开 网络 无Internet', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '电脑上不了网，网页全都打不开');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '网络与上网', 'WiFi', 'WiFi 列表里找不到公司的无线网络', '1. 确认笔记本的无线开关已打开，或按一下键盘上的飞行模式键把它关掉。
2. 点任务栏网络图标，看是否显示「WiFi 已关闭」，打开后等 10 秒刷新列表。
3. 走到离路由器/AP 近一点的位置再搜，隔墙太远可能搜不到。
4. 重启一次电脑。
5. 别人能搜到只有你搜不到，请报障并写明电脑型号和所在楼层/区域。', 'WiFi 无线 搜不到 找不到 网络名称', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = 'WiFi 列表里找不到公司的无线网络');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '网络与上网', 'WiFi', 'WiFi 显示「已连接，无 Internet」，还是上不了网', '1. 点网络图标 → 先「断开」这个 WiFi，再重新连一次并输入密码。
2. 确认密码没输错：注意大小写，公司 WiFi 密码改过的话要用新密码。
3. 手机上连同一个 WiFi 试试：手机也不行，说明是网络侧问题，直接报障。
4. 手机正常、只有电脑不行，右键网络图标 →「疑难解答」让它自动修复。
5. 仍不行请报障，写明网络名称和电脑上提示的原文。', 'WiFi 已连接 无Internet 感叹号 上不了', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = 'WiFi 显示「已连接，无 Internet」，还是上不了网');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '网络与上网', '网速慢', '网速特别慢，网页转圈、文件传半天', '1. 先确认是不是有人在下载大文件或在线看高清视频，部门共用带宽会互相影响。
2. 关掉浏览器里不用的标签页、网盘同步和自动更新，再试一次。
3. 用手机连同一个网络对比一下：手机也慢就是整体网络问题。
4. 换个时间段再试，记录下慢的具体时间点（比如每天上午 10 点）。
5. 持续很慢请报障，写明：慢的时间段、是有线还是 WiFi、测速结果（如果有）。', '网速慢 卡 慢 下载 上传 转圈', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '网速特别慢，网页转圈、文件传半天');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '网络与上网', 'VPN', 'VPN 连不上，提示账号或密码错误', '1. 先确认输入法是大写还是小写、有没有多打了空格，重新手动输入一次密码。
2. 用同一组账号密码登录公司邮箱或 OA：也登不上说明是账号密码问题，按「忘记密码 / 账号锁定」那条处理。
3. 确认自己的账号没有被停用（离职、长期未用等情况）。
4. 检查电脑时间是否准确，时间差太多会导致连接失败。
5. 以上都正常仍连不上，请报障并附上报错截图，不要连续反复试错（可能导致账号锁定）。', 'VPN 连不上 密码错误 远程 外网 登录失败', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = 'VPN 连不上，提示账号或密码错误');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '网络与上网', 'VPN', 'VPN 连上了，但内网系统还是打不开', '1. 确认你打开的地址是完整的公司系统地址（从收藏夹进，不要自己手敲）。
2. 换一个浏览器（Edge / Chrome）再试一次，或按 Ctrl + F5 强制刷新。
3. 断开 VPN 重新连一次，等显示「已连接」后再打开系统。
4. 试一下能不能打开另一个内网系统，判断是单个系统的问题还是整体不通。
5. 仍不行请报障，写明：打不开的系统名、浏览器提示的原文（比如 404 / 502 / 无法访问）。', 'VPN 已连接 打不开 内网 系统 地址', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = 'VPN 连上了，但内网系统还是打不开');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '网络与上网', '共享文件', '共享文件夹打不开，提示「没有权限」或要输账号密码', '1. 确认你输的是从 IT 那里拿到的完整共享路径，别从聊天记录里复制半个路径。
2. 提示要账号密码时，试一下自己的公司账号；不要勾选「记住凭据」在公用电脑上。
3. 问下同部门同事能不能打开：只有你不行，多半是权限没开通。
4. 权限需要由管理员开通，请报障并写明：共享文件夹名称、你的部门、提示的原文。
5. 不要尝试用别人的账号登录共享盘。', '共享盘 共享文件夹 没权限 访问被拒绝 部门盘', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '共享文件夹打不开，提示「没有权限」或要输账号密码');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '网络与上网', '浏览器报错', '打开网站提示「证书错误」「不安全」或一串英文报错', '1. 先按 Ctrl + F5 强制刷新一次，或换一个浏览器打开。
2. 检查电脑右下角时间是否正确，时间不对会误报证书错误。
3. 把浏览器提示的原文用手机拍下来，或记下错误码（如 502、404、ERR_ 开头的一串）。
4. 如果是网址手敲的，改从收藏夹或公司门户里的链接进入。
5. 提示「不安全」时不要在这个页面输入账号密码，直接报障附上截图。', '证书 不安全 隐私错误 502 404 白屏 网页报错', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '打开网站提示「证书错误」「不安全」或一串英文报错');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '打印与会议', '打印机', '打印机不打印，任务一直排在队列里', '1. 先看打印机面板有没有报错（缺纸、卡纸、墨粉不足、盖板未关），按屏幕提示先处理。
2. 电脑上点「开始 → 设置 → 蓝牙和其他设备 → 打印机」，找到这台打印机，看是否显示「脱机」；脱机就关掉打印机电源等 10 秒再开。
3. 打开打印队列，把状态是「错误」的那一条删掉，再重新点一次打印。
4. 确认你选的打印机名字是对的（公司常有多台同名相似的设备）。
5. 重启打印机后仍不打印请报障，写明：打印机所在位置/名称、面板上的报错文字。', '打印机 不打印 排队 脱机 卡住 打印任务', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '打印机不打印，任务一直排在队列里');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '打印与会议', '打印质量', '打印出来是白纸、字迹很淡或颜色不对', '1. 先打印一张测试页（打印机面板「设置 → 打印测试页」），判断是打印机还是电脑的问题。
2. 测试页也淡或空白，多半是墨粉/碳粉用完，不要自己加粉，直接报障。
3. 测试页正常但你的文件不正常，检查打印设置里是不是选了「草稿 / 省墨」或「仅黑白」。
4. 彩色文件打印前确认选的是彩色打印机。
5. 报障时写明打印机位置，以及测试页是否正常。', '打印 白纸 字迹淡 颜色不对 墨粉 碳粉', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '打印出来是白纸、字迹很淡或颜色不对');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '打印与会议', '卡纸', '打印机提示卡纸、缺纸，或有纸在里面取不出来', '1. 按打印机屏幕提示的图示位置，打开对应盖板。
2. 双手捏住纸的两边，顺着出纸方向慢慢、平直地抽出，不要反向硬拽，也不要用剪刀等硬物去掏。
3. 抽完检查有没有碎纸片留在里面，盖好盖板，等屏幕恢复「就绪」。
4. 纸盒重新放整齐纸张，把导纸板贴紧纸边（不要压得太紧）。
5. 纸卡在深处够不到、或反复在同一位置卡纸，请报障，不要强行拆机。', '卡纸 缺纸 取纸 纸盒 打印机', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '打印机提示卡纸、缺纸，或有纸在里面取不出来');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '打印与会议', '扫描', '不知道怎么把纸质文件扫描到电脑里', '1. 把纸质文件正面朝下放在扫描玻璃上（或按图示放进自动送纸器），对齐角落标记。
2. 在打印机面板上点「扫描」，选择「扫描到电脑 / 扫描到文件夹」或「扫描到邮箱」。
3. 如果让选格式，一般选 PDF；要编辑文字才选图片（JPG）。
4. 按开始，到电脑上约定的文件夹里找刚生成的文件，确认能打开再收好原件。
5. 面板上没有扫描选项，或找不到文件存到哪里了，请报障并写明打印机位置。', '扫描 扫描件 纸质 转PDF 一体机', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '不知道怎么把纸质文件扫描到电脑里');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '打印与会议', '投屏', '开会投屏没画面，投影/大屏不显示电脑桌面', '1. 确认大屏/投影已开机，并用遥控器把「信号源」切到你接的那一路（HDMI1 / HDMI2 / 无线投屏）。
2. 把 HDMI 线两头重新插紧，换一根线或换一个接口试一下。
3. 电脑上按 Win + P，选「复制」（两边显示一样）或「扩展」（把窗口拖到大屏）。
4. 无线投屏的话，确认电脑和大屏连的是同一个网络，重新输入一次投屏码。
5. 仍没画面请报障，写明：哪间会议室、有线还是无线、大屏上显示的提示文字。', '投屏 投影仪 会议室 大屏 HDMI 没画面', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '开会投屏没画面，投影/大屏不显示电脑桌面');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '打印与会议', '视频会议', '开会时对方听不到我说话，或我看不到对方画面', '1. 先看会议软件底部的麦克风/摄像头图标有没有被划掉（红斜杠表示已关闭），点一下打开。
2. 点图标旁边的小箭头，确认选中的设备是「耳机麦克风 / 内置摄像头」，不要选到不存在的设备。
3. 检查耳机或摄像头的插头、USB 是否插紧；无线耳机确认有电。
4. 让对方说一句话，同时看软件里的音量条有没有跳动，判断是输入还是输出问题。
5. 软件里显示设备正常但对方仍听不到，请报障并写明：会议软件名、设备型号、是听不到还是看不到。', '视频会议 麦克风 摄像头 没声音 听不到 腾讯会议 企业微信', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '开会时对方听不到我说话，或我看不到对方画面');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '打印与会议', '双屏', '接了第二个显示器不显示，或者不知道怎么把窗口移过去', '1. 确认第二台显示器已开机，信号源选对了，线两头插紧。
2. 桌面空白处右键 →「显示设置」，点「检测」，看是否出现两个标着 1 / 2 的屏幕。
3. 在「多显示器设置」里选「扩展这些显示器」（选「复制」会两边显示一样）。
4. 按住窗口标题栏往屏幕边缘拖，就能拖到另一块屏上；也可以按 Win + 左右方向键快速贴边。
5. 检测不到第二块屏请报障，写明显示器型号和用的什么转接头。', '双屏 副屏 扩展屏 显示器 不显示 拖不过去', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '接了第二个显示器不显示，或者不知道怎么把窗口移过去');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '账号与密码', '忘记密码', '忘记开机密码，电脑锁屏进不去了', '1. 先确认大小写锁定（Caps Lock）没开、输入法没切到中文，慢慢重新输一次。
2. 如果界面有「忘记密码 / 重置密码」且绑定过公司账号或手机，按提示自助重置。
3. 不要连续试很多次，也不要找网上的「破解教程」或用 U 盘启动盘，可能造成数据丢失或违反公司规定。
4. 直接报障，写明电脑编号/工位和当时显示的提示，由 IT 协助处理。', '忘记密码 开机密码 锁屏 进不去 Windows', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '忘记开机密码，电脑锁屏进不去了');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '账号与密码', '账号锁定', '提示「账户已锁定」，公司系统登不进去', '1. 停止继续尝试登录，连输错会延长锁定时间。
2. 一般等待 15～30 分钟会自动解锁，期间先做别的事。
3. 等待后先确认密码是不是最近改过、有没有记混旧密码。
4. 超过半小时仍锁定，或急着用，请报障并写明：哪个系统、你的登录账号、提示原文。', '账号锁定 被锁 登录失败次数 冻结', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '提示「账户已锁定」，公司系统登不进去');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '账号与密码', '修改密码', '不知道怎么修改公司系统或邮箱的密码', '1. 登录后找页面右上角头像 →「个人设置 / 账号安全」→「修改密码」。
2. 按页面要求填旧密码和新密码，注意长度、大小写、特殊符号要求。
3. 改完立刻在另一个地方试登一次，确认新密码生效。
4. 把新密码记在公司的密码管理工具或自己的记事本里，不要写在便签贴显示器上。
5. 页面上找不到入口，或旧密码不对，请报障并写明是哪个系统。', '改密码 修改密码 首次登录 定期更换', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '不知道怎么修改公司系统或邮箱的密码');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '账号与密码', '邮箱', '邮箱登录不上，提示密码错误', '1. 检查大小写、输入法，以及账号要不要带后缀（@公司域名），重新输一次。
2. 用同一组账号去登录 OA 或公司其他系统：能登上说明邮箱客户端的配置可能要更新。
3. 网页版邮箱能登、只有电脑上的邮件软件登不上，先关掉软件重开一次。
4. 都登不上按「忘记密码 / 账号锁定」流程处理。
5. 仍不行请报障，写明是网页版还是电脑软件、报错原文。', '邮箱 登录 密码错误 Outlook 企业邮箱 收不到', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '邮箱登录不上，提示密码错误');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '账号与密码', '验证码', '收不到短信或邮箱验证码', '1. 等 1～2 分钟，短信偶有延迟；不要连点「重新发送」，新码会把旧码顶掉。
2. 检查手机号有没有填错、有没有欠费停机；邮箱验证码去看一下「垃圾邮件 / 广告邮件」文件夹。
3. 确认手机没开骚扰拦截，把公司短信号码加进白名单。
4. 换「语音验证码」或「邮箱验证码」（如果页面提供）。
5. 多次都收不到请报障，写明：哪个系统、用的是短信还是邮箱、大概几点尝试的。', '验证码 收不到 短信 邮件 登录验证', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '收不到短信或邮箱验证码');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '办公软件', '软件卡死', 'Word / Excel 卡住不动了，文档还没保存', '1. 先等 2～3 分钟，大文件有时只是慢，不要立刻强关。
2. 确实不动了再按 Ctrl + Shift + Esc 打开任务管理器，结束这个软件。
3. 重新打开同一个软件，通常会弹出「文档恢复」窗格，点里面的文件另存为一个新名字。
4. 没有弹恢复窗格，重新打开原文件看内容是否还在；也可以到「文件 → 信息 → 管理文档 → 恢复未保存的文档」里找。
5. 重要文件找不回来请立刻报障，先别继续往原位置写新文件。', 'Word Excel 无响应 卡死 未保存 恢复 自动恢复', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = 'Word / Excel 卡住不动了，文档还没保存');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '办公软件', '文件误删', '文件不小心删掉了，怎么找回来', '1. 刚删的先按 Ctrl + Z 撤销。
2. 打开桌面「回收站」，按名称或删除时间找到文件，右键「还原」，它会回到原来的位置。
3. 共享盘/网络盘里删的文件，问下管理员有没有快照或备份，不要自己再往里写东西。
4. 回收站也清空了，请尽快报障，写明：文件名、原来放在哪个盘、大概什么时候删的——越早找回来概率越高。', '误删 回收站 找回 文件丢失 撤销删除', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '文件不小心删掉了，怎么找回来');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '办公软件', '文件打不开', '文件打不开，提示格式不支持或要选打开方式', '1. 看文件名最后的小尾巴（.docx / .xlsx / .pdf / .zip），确认该用哪个软件打开。
2. 右键文件 →「打开方式」，选对应的软件（Word / Excel / PDF 阅读器 / 压缩软件）。
3. 别人发来的文件，让对方重新发一次，传输中断也会导致打不开。
4. 提示「文件已损坏」时不要反复重试，把原文件保留好。
5. 仍打不开请报障，附上报错截图和文件后缀名（文件本身不用发，涉密内容不要外传）。', '打不开 格式不支持 打开方式 文件损坏 后缀', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '文件打不开，提示格式不支持或要选打开方式');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '办公软件', '附件过大', '邮件附件太大发不出去', '1. 先把附件压成 zip：右键文件 →「发送到 → 压缩(zipped)文件夹」。
2. 图片类附件可另存为 JPG 并调低分辨率，体积会小很多。
3. 视频、多个大文件建议放到公司共享盘/网盘，邮件里只放链接。
4. 拆成几封邮件分开发也可以。
5. 公司有固定的大文件传递方式，不确定请报障问一下，不要用私人网盘传公司资料。', '附件 太大 发不出去 超限 压缩 大文件', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '邮件附件太大发不出去');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '办公软件', '软件安装', '装软件时提示「没有管理员权限」', '1. 公司电脑的软件由 IT 统一安装，这是正常限制，不要找网上的「绕过权限」教程。
2. 确认这个软件是不是工作必需，以及有没有公司已经提供的替代软件。
3. 先关掉安装包，不要反复点「重试」。
4. 需要安装请报障，写明：软件全名和版本、用来做什么、从哪下载的。
5. 不要自行下载来路不明的安装包，容易带入病毒和广告软件。', '安装软件 权限不足 管理员 UAC 装不上', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '装软件时提示「没有管理员权限」');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '办公软件', '浏览器异常', '浏览器弹窗广告很多，主页被改了', '1. 不要点弹窗里的任何按钮（包括「关闭」「立即清理」），直接点窗口右上角的 ×。
2. 浏览器「设置 → 启动时」把主页改回常用地址；「扩展程序」里把不认识的插件停用或删除。
3. 检查「设置 → 应用/程序和功能」里最近是否多出没装过的软件，先记下名字，不要自己卸载系统组件。
4. 全盘扫一次病毒（用公司指定的安全软件）。
5. 广告仍不断弹出请报障，把弹窗截图发给 IT，这通常意味着装了捆绑软件。', '弹窗 广告 主页被改 浏览器 劫持 流氓软件', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '浏览器弹窗广告很多，主页被改了');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '办公软件', '即时通讯', '企业微信 / 钉钉收不到消息，或者登录不上', '1. 先按「上不了网」那条确认网络是否正常，这两个软件断网时表现就是收不到消息。
2. 完全退出软件（右下角图标右键退出，不是只关窗口），再重新打开登录一次。
3. 手机端试试能不能收到：手机也没有，多半是账号或网络问题；只有电脑没有，检查电脑端「设置 → 消息通知」是否被关掉。
4. 检查是不是误开了「免打扰 / 专注模式」。
5. 仍不行请报障，写明：哪个软件、电脑还是手机、是完全收不到还是延迟。', '企业微信 钉钉 收不到消息 登录不上 通知', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '企业微信 / 钉钉收不到消息，或者登录不上');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '办公软件', '业务系统', 'OA / 业务系统打开报错、白屏或一直加载', '1. 从收藏夹重新进一次，不要手敲地址；按 Ctrl + F5 强制刷新。
2. 换一个浏览器（Edge / Chrome）再试，或退出重新登录一次。
3. 问下同事是不是也打不开：别人也不行说明是系统侧故障，直接报障。
4. 记下页面上显示的错误码或文字（如 502、404、403、超时），用手机拍张照。
5. 报障时写明：系统名称、错误原文、大概时间、是否所有人都一样。', 'OA 业务系统 502 404 白屏 加载中 打不开', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = 'OA / 业务系统打开报错、白屏或一直加载');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '安全与规范', '可疑邮件', '收到可疑邮件或不认识的链接，不确定是不是诈骗', '1. 不要点链接、不要下载附件、不要回复，更不要在里面填账号密码或验证码。
2. 看发件人地址是不是公司域名，拼写差一个字母的往往是冒充的。
3. 直接把邮件转发给 IT 或按公司规定举报，然后删除。
4. 已经点开或填过密码，请立刻修改相关账号密码，并马上报障说明情况，越早处理损失越小。
5. 拿不准就当作可疑处理，误报没有关系。', '钓鱼邮件 诈骗 可疑链接 陌生邮件 安全', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '收到可疑邮件或不认识的链接，不确定是不是诈骗');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '安全与规范', '病毒提示', '电脑弹出病毒警告，或杀毒软件一直报毒', '1. 先断开网络（拔网线或关 WiFi），不要继续打开文件或插 U 盘。
2. 不要点弹窗里陌生的「立即修复 / 下载清理工具」，只使用公司装好的安全软件。
3. 用公司安全软件做一次全盘扫描，按提示隔离（不要选「删除」以免误删文件）。
4. 记下报毒的文件名和位置，用手机拍照。
5. 尽快报障，写明：弹窗文字、是否插过外来 U 盘、是否下载过文件。', '病毒 报毒 木马 杀毒 警告 安全软件', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '电脑弹出病毒警告，或杀毒软件一直报毒');
INSERT INTO `knowledge` (`user_id`, `app_system`, `problem_type`, `problem_summary`, `solution`, `keyword`, `is_public`)
SELECT 1, '安全与规范', '数据安全', '下班要不要关机？重要文件该怎么备份', '1. 重要工作文件不要只放桌面或 C 盘，统一存到公司共享盘/网盘，那里有定期备份。
2. 每天下班前把正在编辑的文件保存并关闭；有未保存的文档先保存再走。
3. 普通办公电脑按公司要求关机或睡眠即可；贴了「请勿关机」标签的机器不要动。
4. 笔记本带出公司前确认文件已同步到共享盘，不要只留本地一份。
5. 不确定某个文件夹是否会被备份，报障问一下再存，别等丢了才查。', '关机 备份 数据保存 共享盘 下班', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `knowledge` WHERE `problem_summary` = '下班要不要关机？重要文件该怎么备份');

-- =============================================================================
--  初始化完成。首次启动后端将自动：
--    1) 创建默认管理员账号 admin / admin123（请立即修改）
--    2) 生成免登录报障入口密钥 report_key
--    3) 校验并补齐任何缺失的字段/索引（幂等迁移）
--  注意：43 条自助排障常见问题已在上面 3.6 节写入，不依赖后端启动；
--        即使只导入本脚本、后端从未启动，员工门户也能看到这批问答。
-- =============================================================================
