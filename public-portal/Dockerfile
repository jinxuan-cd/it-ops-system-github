#  ==========================================================================
#  门户镜像构建 —— IT 运维工单台账与日报自动管理系统
#  基于 nginx 的静态站点镜像
#  
#  作者：锦轩 (JinXuan) <2686389727@qq.com>
#  创建：2026-10-29　　版本：1.2.2
#  Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
#  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
#        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
#  ==========================================================================
FROM nginx:1.27-alpine
LABEL maintainer="锦轩 <2686389727@qq.com>" \
      org.opencontainers.image.authors="锦轩 <2686389727@qq.com>" \
      org.opencontainers.image.title="IT 运维工单台账与日报系统 - 员工自助门户" \
      org.opencontainers.image.version="1.2.2" \
      org.opencontainers.image.vendor="锦轩 (JinXuan)" \
      org.opencontainers.image.licenses="LicenseRef-ITOps-Source-Available-1.0 (see LICENSE)" \
      org.opencontainers.image.copyright="Copyright (c) 2026 锦轩 (JinXuan). All rights reserved."

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html style.css app.js /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
