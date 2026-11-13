/**
 * @file frontend/src/store/menu.js
 * @description 菜单可见性（菜单管理）的集中状态。
 *
 * 管理员在「系统设置 → 菜单管理」里关闭某些功能菜单后，所有登录用户的侧边栏与路由都会隐藏对应入口。
 * 这个 store 在应用启动时（main.js）先拉一次，路由守卫和侧边栏都从这里读「哪些菜单被关了」。
 * 管理员保存后调用 load() 刷新即可，不必刷新页面。
 */

import { defineStore } from 'pinia'
import R from '../api'

export const useMenuStore = defineStore('menu', {
  state: () => ({
    // 当前被关闭的菜单路径集合（来自 sys_setting.disabled_menus）
    disabled: [],
    // 可关闭项白名单（用于设置页渲染开关，也用于守卫校白）
    toggleable: [],
    loaded: false
  }),
  getters: {
    // 判断某个路由路径是否被关闭（守卫与侧边栏共用）
    isDisabled: (s) => (path) => Array.isArray(s.disabled) && s.disabled.includes(path)
  },
  actions: {
    // 拉取菜单设置；失败不阻塞启动（按「无关闭项」处理，菜单全显示）
    async load() {
      try {
        const d = await R.getMenuSettings()
        this.toggleable = Array.isArray(d.toggleable) ? d.toggleable : []
        this.disabled = Array.isArray(d.disabled) ? d.disabled : []
      } catch (e) {
        this.toggleable = []
        this.disabled = []
      }
      this.loaded = true
    }
  }
})
