/**
 * @file frontend/src/main.js
 * @description 创建应用实例，注册 Element Plus、Pinia、路由与全局样式
 *
 * 前端入口 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import App from './App.vue'
import router from './router'
import './assets/global.css'
import { applyTheme } from './utils/theme'

applyTheme() // 应用用户自定义主题（含个性化主色）

const app = createApp(App)

// 全量注册 Element Plus 图标：各页面模板直接写 <Monitor /> / <Plus /> 即可，
// 不用逐个 import，代价是打包体积包含整套图标（内部系统可接受）
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

// 先装 Pinia 再挂路由：布局组件挂载时会立刻 useUserStore()，store 必须已经可用
app.use(createPinia())
app.use(router)
// 中文语言包：日期/月份选择器、分页、表格空数据提示、确认框等全部显示中文
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')
