/**
 * @file frontend/src/store/user.js
 * @description 登录态、用户资料与角色权限的集中管理
 *
 * 用户状态 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
import { defineStore } from 'pinia'

// localStorage 里的用户信息可能是旧版本残留或被手工改坏，解析失败不能让整个应用白屏
function readUser() {
  try {
    return JSON.parse(localStorage.getItem('itops_user') || 'null')
  } catch (e) {
    localStorage.removeItem('itops_user')
    localStorage.removeItem('itops_token')
    return null
  }
}

// 登录态的唯一真相来源：
//   itops_token —— JWT，api 请求拦截器每次从这里读出来塞进 Authorization 头
//   itops_user  —— 当前用户对象（user_id / username / real_name / role），供路由守卫和菜单即时判断角色
// 两者都存在 localStorage 而不是内存，是为了刷新页面、开新标签页都不掉登录；
// 也正因为可被手改，后端每个接口都会重新校验角色，前端判断只用于「藏入口」而不是安全边界
export const useUserStore = defineStore('user', {
  state: () => ({
    // 初始化时直接回填存储里的值：SPA 首屏渲染就要知道登没登录、是什么角色
    token: localStorage.getItem('itops_token') || '',
    user: readUser()
  }),
  getters: {
    // 管理员：全部数据 + 系统配置 + 用户管理
    isAdmin: (s) => s.user && s.user.role === 'admin',
    // 审计员：只读查看全公司数据（不能新增/修改业务数据）
    isAuditor: (s) => s.user && s.user.role === 'auditor',
    // 服务台（可选角色）：负责派单，可查看全部工单
    isService: (s) => s.user && s.user.role === 'service',
    // 可查看全公司数据（管理员 + 审计员）
    canViewAll: (s) => !!(s.user && (s.user.role === 'admin' || s.user.role === 'auditor')),
    // 可派单（管理员 + 服务台）：决定顶栏显示「派单」还是「接单」
    canDispatch: (s) => !!(s.user && (s.user.role === 'admin' || s.user.role === 'service')),
    // 能接单（审计员只读，不能接单）：新单提醒弹窗只在 canClaim 为真时才挂载
    canClaim: (s) => !!(s.user && s.user.role !== 'auditor'),
    // 角色中文名：顶栏用户菜单和移动端抽屉底部直接显示，避免各页面各写一套映射
    roleLabel: (s) => {
      const r = s.user && s.user.role
      return r === 'admin' ? '管理员' : r === 'auditor' ? '审计员' : r === 'service' ? '服务台' : '运维工程师'
    },
    // 当前用户主键：待办、目标等只属于本人的数据用它做归属判断
    userId: (s) => (s.user && s.user.user_id) || null,
    // 展示名：没填真实姓名时退回登录名，再退回「未登录」
    realName: (s) => (s.user && s.user.real_name) || (s.user && s.user.username) || '未登录'
  },
  actions: {
    // 登录成功后调用：内存与 localStorage 同时写，保证后续请求和刷新都能拿到
    setAuth(token, user) {
      this.token = token
      this.user = user
      localStorage.setItem('itops_token', token)
      localStorage.setItem('itops_user', JSON.stringify(user))
    },
    // 局部更新用户信息（改姓名后刷新页面不该又变回旧值）
    patchUser(patch) {
      this.user = { ...(this.user || {}), ...patch }
      localStorage.setItem('itops_user', JSON.stringify(this.user))
    },
    // 退出登录：两边一起清，否则残留的 user 会让路由守卫误判成「还登着」
    logout() {
      this.token = ''
      this.user = null
      localStorage.removeItem('itops_token')
      localStorage.removeItem('itops_user')
    }
  }
})
