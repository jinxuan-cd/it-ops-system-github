/**
 * @file frontend/vite.config.js
 * @description Vue 插件、构建产物目录与开发环境接口代理
 *
 * 构建配置 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'

// 版本号与版权信息在构建期注入，登录页、侧边栏、员工门户页脚共用一份来源，
// 避免发版时漏改某个硬编码的 v1.x
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// 开发时前端跑在 5173，调用后端 3000；生产由 nginx 反代 /api
export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COPYRIGHT__: JSON.stringify('© 2026 锦轩 (JinXuan)')
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})
