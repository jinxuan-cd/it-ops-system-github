# =============================================================================
#  IT 运维工单台账与日报系统 —— 管理端镜像（Node 构建 + Nginx 托管）
#  -----------------------------------------------------------------------------
#  作者：锦轩 (JinXuan) <2686389727@qq.com>    版本：1.2.1    创建：2026-10-29
#  Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
#  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
#        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
# =============================================================================

# 前端构建阶段
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# 生产阶段：nginx 托管静态资源并反代 /api
FROM nginx:1.27-alpine
LABEL maintainer="锦轩 <2686389727@qq.com>" \
      org.opencontainers.image.authors="锦轩 <2686389727@qq.com>" \
      org.opencontainers.image.title="IT 运维工单台账与日报系统 - 管理端" \
      org.opencontainers.image.version="1.2.0" \
      org.opencontainers.image.vendor="锦轩 (JinXuan)" \
      org.opencontainers.image.licenses="Commercial (see LICENSE)" \
      org.opencontainers.image.copyright="Copyright (c) 2026 锦轩 (JinXuan). All rights reserved."
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
