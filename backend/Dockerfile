# =============================================================================
#  IT 运维工单台账与日报系统 —— 后端服务镜像
#  -----------------------------------------------------------------------------
#  作者：锦轩 (JinXuan) <2686389727@qq.com>    版本：1.4.0    创建：2026-10-29
#  Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
#  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
#        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
# =============================================================================
FROM node:20-alpine
LABEL maintainer="锦轩 <2686389727@qq.com>" \
      org.opencontainers.image.authors="锦轩 <2686389727@qq.com>" \
      org.opencontainers.image.title="IT 运维工单台账与日报系统 - 后端 API" \
      org.opencontainers.image.version="1.4.0" \
      org.opencontainers.image.vendor="锦轩 (JinXuan)" \
      org.opencontainers.image.licenses="LicenseRef-ITOps-Source-Available-1.0 (see LICENSE)" \
      org.opencontainers.image.copyright="Copyright (c) 2026 锦轩 (JinXuan). All rights reserved."
ENV TZ=Asia/Shanghai
WORKDIR /app

# 按锁文件安装并跳过 devDependencies：保证容器内版本与开发机一致，
# 否则 THIRD-PARTY-LICENSES.txt 记录的实际版本会与运行时部署的版本对不上
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p uploads backups

EXPOSE 3000
CMD ["node", "src/index.js"]
