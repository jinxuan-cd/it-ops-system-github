/**
 * @file frontend/src/utils/workflow.js
 * @description 工单状态常量与流转合法性判断
 *
 * 工单状态机 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 工单流转配置（服务台是否启用）：全局共享一份，避免各页面重复请求
// service_desk_enable 决定核心口径：
//   false —— 抢单模式，工单进公海池，工程师自己「接取」
//   true  —— 派单模式，由服务台统一指派给工程师，界面文案也从「接单」变「指派」
// 用 reactive 而不是 Pinia store：这里只是一份只读配置，谁都能直接读，省掉一层依赖
import { reactive } from 'vue'
import R from '../api'

export const workflow = reactive({ service_desk_enable: false, loaded: false })

/**
 * 加载流转配置。默认只拉一次，改完设置后用 loadWorkflow(true) 强制刷新。
 * 请求失败也把 loaded 置 true：宁可沿用默认的抢单模式，也不要在弱网下被各页面反复重试打爆接口。
 *
 * @param {boolean} [force] 是否忽略缓存强制重新拉取
 * @returns {Promise<object>} 共享的配置对象
 */
export async function loadWorkflow(force = false) {
  if (workflow.loaded && !force) return workflow
  try {
    Object.assign(workflow, await R.getWorkflowSettings(), { loaded: true })
  } catch (e) {
    workflow.loaded = true
  }
  return workflow
}
