#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成演示数据 SQL（scripts/demo-data.sql）。

用途：本地/测试环境铺一年的工单数据，方便查看看板趋势图、年度汇总、
团队分析的「超期未闭环」分页、人员维度分析的真实效果。

用法：
    python scripts/gen-demo-data.py
    docker compose exec -T db mariadb -uitops -pitops_2026 itops < scripts/demo-data.sql

清空：scripts/demo-reset.sh

作者：锦轩 (JinXuan) <2686389727@qq.com>   创建：2026-11-02   版本：1.2.2
Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
      其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
"""
import os
import random
import datetime

random.seed(20261102)

NAMES = [("zhangwei", "张伟"), ("lijing", "李静"), ("wangqiang", "王强")]
TYPES = ["网络故障", "打印机故障", "系统登录异常", "软件安装",
         "账号权限", "硬件报修", "邮件问题", "VPN 连接"]
APPS = ["OA 办公系统", "ERP 系统", "财务系统", "邮件系统", "门禁系统"]
DEPTS = ["行政部", "财务部", "生产部", "销售部", "研发部", "仓储部"]
PRIORITIES = ["low", "normal", "normal", "high", "urgent"]

FAQS = [
    ("OA 系统登录不上怎么办？", "OA 办公系统", "登录问题", "登录,密码,OA",
     "先确认账号密码是否正确，再检查是否被锁定，连续 5 次错误会锁定 30 分钟。管理员可在「用户管理」里解锁。", 1),
    ("打印机卡纸如何处理？", "办公设备", "硬件故障", "打印机,卡纸",
     "关闭电源，打开后盖或纸盒取出卡纸，注意不要硬拉，清理纸屑后重启打印机。", 1),
    ("VPN 连接失败提示 691 错误", "网络", "网络故障", "VPN,691,远程",
     "691 一般是账号或密码错误，或账号已过期。请确认密码后重试，仍失败请联系 IT 重置。", 1),
    ("如何申请新的软件安装权限？", "OA 办公系统", "权限申请", "软件,安装,权限",
     "在 OA 提交「软件安装申请」，部门主管审批后由 IT 统一安装，请勿自行下载安装。", 1),
    ("邮箱容量满了怎么清理？", "邮件系统", "邮箱问题", "邮箱,容量,清理",
     "先删除带大附件的邮件并清空「已删除」文件夹；仍不足可申请扩容。", 0),
]


def main():
    # 基准时间取「当前月」，保证生成的年度趋势图一直有数据
    now = datetime.datetime.now().replace(day=2, hour=10, minute=14, second=0, microsecond=0)
    year = now.year
    cur_month = now.month

    lines = [
        "-- 自动生成，请勿手工编辑：python scripts/gen-demo-data.py",
        "-- 演示账号沿用 admin 的密码哈希，登录密码与 admin 相同",
        "SET @h = (SELECT password FROM sys_user WHERE username='admin');",
    ]
    for uid, (un, rn) in enumerate(NAMES, start=2):
        lines.append(
            "INSERT IGNORE INTO sys_user (user_id,username,password,real_name,role,is_enable) "
            "VALUES (%d,'%s',@h,'%s','user',1);" % (uid, un, rn)
        )

    rows = []
    for m in range(1, cur_month + 1):
        if m < cur_month - 1:
            n = 4           # 更早的月份：少量
        elif m == cur_month - 1:
            n = 14          # 上月：中等，便于看上月汇总
        else:
            n = 30          # 本月：多放，且一半未完成，便于看超期分页
        for i in range(n):
            if m == cur_month and i < 4:
                # 留几张「今天」的单，看板首屏的今日工单/今日已完成才不会全是 0
                happen = now.replace(hour=random.randint(8, 10), minute=random.randint(0, 59))
            else:
                happen = datetime.datetime(year, m, random.randint(1, 26),
                                           random.randint(8, 18), random.randint(0, 59))
            assignee = random.choice([2, 3, 4])
            user_id = random.choice([0, 2, 3, 4])   # 0 = 扫码报障（无登录账号）
            typ = random.choice(TYPES)
            app_ = random.choice(APPS)
            dept = random.choice(DEPTS)
            src = "qr" if user_id == 0 else "manual"

            # 本月放一半未完成（便于看积压与超期分页）；上月留 2 张未完成，
            # 这样上月完成率不会是 100%，比全绿更接近真实情况
            pending = ((m == cur_month and i % 2 == 0)
                       or (m == cur_month - 1 and i in (4, 9))
                       or (m == cur_month - 2 and i == 1))
            if pending:
                status = "processing"
                finish = hdesc = score = stime = "NULL"
                # 大多数单 SLA 已经过期，用于验证「超期未闭环」分页（要能翻到第 2 页）
                if i % 7 != 0:
                    due = now - datetime.timedelta(days=random.randint(1, 25))
                else:
                    due = now + datetime.timedelta(days=random.randint(2, 10))
            else:
                status = "done"
                finish_dt = happen + datetime.timedelta(hours=random.randint(1, 14))
                finish = "'%s'" % finish_dt.strftime("%Y-%m-%d %H:%M:%S")
                hdesc = "'已处理完成，用户确认恢复正常'"
                score = random.choice([3, 4, 5, 5, 5])
                stime = finish
                due = happen + datetime.timedelta(hours=8)

            rows.append(
                "(%d,%d,'%s','%s','%s','%s','%s','%s 处理','%s','%s','%s','%s','%s',%s,%s,%s,%s)"
                % (user_id, assignee,
                   happen.strftime("%Y-%m-%d %H:%M:%S"), happen.strftime("%Y-%m-%d %H:%M:%S"),
                   happen.strftime("%Y-%m-%d %H:%M:%S"), due.strftime("%Y-%m-%d %H:%M:%S"),
                   dept, typ, app_, typ, status, random.choice(PRIORITIES), src,
                   finish, hdesc, score, stime)
            )

    lines.append(
        "INSERT INTO ticket (user_id,assignee_id,assign_time,respond_time,happen_time,sla_resolve_due,"
        "dept,service_content,app_system,problem_type,status,priority,source,finish_time,handle_desc,"
        "satisfy_score,satisfy_time) VALUES\n" + ",\n".join(rows) + ";"
    )

    for summary, app_, cat, kw, sol, pub in FAQS:
        lines.append(
            "INSERT INTO knowledge (user_id,app_system,problem_type,problem_summary,keyword,solution,is_public) "
            "VALUES (1,'%s','%s','%s','%s','%s',%d);"
            % (app_, cat, summary.replace("'", "''"), kw, sol.replace("'", "''"), pub)
        )

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo-data.sql")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("已生成 %s：%d 张工单，%d 条常见问题" % (out, len(rows), len(FAQS)))


if __name__ == "__main__":
    main()
