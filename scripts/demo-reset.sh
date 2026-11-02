#!/usr/bin/env bash
# =============================================================================
#  IT 运维工单台账与日报系统 —— 演示数据清理脚本
#  -----------------------------------------------------------------------------
#  清空演示数据，恢复成「刚装好、只有 admin」的状态。
#
#  只删演示造出来的东西：
#    · ticket / todo 里的工单与待办
#    · knowledge 里的知识条目（含演示 FAQ）
#    · 演示账号 zhangwei / lijing / wangqiang
#    · uploads 里报障上传的截图
#  不会动：账号 admin、系统设置（含值班电话 / 入口密钥）、字典、SLA 策略。
#
#  用法：
#    bash scripts/demo-reset.sh          # 交互确认
#    bash scripts/demo-reset.sh -y       # 跳过确认
#  -----------------------------------------------------------------------------
#  作者：锦轩 (JinXuan) <2686389727@qq.com>   创建：2026-11-02   版本：1.2.1
#  Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
#  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
#        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

# 环境变量：优先 .env，没有就用 .env.example，再没有就用 docker-compose 里的默认值
ENV_FILE=""
if [ -f .env ]; then
  ENV_FILE=".env"
elif [ -f .env.example ]; then
  ENV_FILE=".env.example"
fi

read_env() {
  if [ -n "$ENV_FILE" ]; then
    grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true
  fi
}

DB_USER="$(read_env MYSQL_USER)"
DB_PASS="$(read_env MYSQL_PASSWORD)"
DB_NAME="$(read_env MYSQL_DATABASE)"
DB_USER="${DB_USER:-itops}"
DB_PASS="${DB_PASS:-itops_2026}"
DB_NAME="${DB_NAME:-itops}"

if [ "${1:-}" != "-y" ]; then
  echo "即将清空：全部工单、待办、知识条目，以及演示账号 zhangwei / lijing / wangqiang。"
  echo "账号 admin 和系统设置（含值班电话、入口密钥）会保留。"
  read -r -p "确认继续？[y/N] " ans
  case "$ans" in
    y|Y) ;;
    *) echo "已取消"; exit 0 ;;
  esac
fi

echo "==> 清空工单 / 待办 / 知识库"
docker compose exec -T db mariadb -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "
  DELETE FROM ticket;
  DELETE FROM todo;
  DELETE FROM knowledge;
  DELETE FROM sys_user WHERE username IN ('zhangwei','lijing','wangqiang');
"

echo "==> 清理报障上传的截图"
docker compose exec -T backend sh -c 'rm -f ./uploads/* 2>/dev/null || true'

echo "==> 完成。当前数据量："
docker compose exec -T db mariadb -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "
  SELECT '工单' AS 表, COUNT(*) AS 条数 FROM ticket
  UNION ALL SELECT '待办', COUNT(*) FROM todo
  UNION ALL SELECT '知识库', COUNT(*) FROM knowledge
  UNION ALL SELECT '用户', COUNT(*) FROM sys_user;
"
