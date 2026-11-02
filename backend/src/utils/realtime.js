/**
 * @file backend/src/utils/realtime.js
 * @description SSE 客户端注册、单用户发送、全员广播与在线数统计
 *
 * 实时推送连接池 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 实时事件推送（SSE）
// 场景：员工报障后，所有运维的浏览器右下角立刻弹出「有新工单」；某人接单后其他人同步消失
//
// 部署形态：**单个后端进程**同时服务管理端（内网端口）与员工自助门户（公网端口）。
// 两个端口只是两个 nginx 入口，最终都反代到同一个 backend，所以事件在内存里分发即可，
// 不需要跨进程转发。断线由浏览器 EventSource 自动重连。

const clients = new Set()
// 连接自增序号：仅用于区分连接，不做业务标识
let seq = 1

// 建立一个 SSE 连接（token 由调用方校验好）
/**
 * 注册一个 SSE 客户端并保持长连接。
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res 已由调用方完成鉴权，本函数直接写头
 * @param {{user_id:number, role:string}} user 已登录用户
 * @returns {{id:number, userId:number, role:string, res:import('express').Response}} 客户端句柄
 * @sideeffect 写入 SSE 响应头并占用该连接；注册心跳定时器；登记 req 的关闭事件
 *
 * 连接池清理逻辑（本项目只有一个后端进程，连接只存在内存里）：
 * · req 'close' / 'aborted' 任一触发即 cleanup：清掉心跳定时器 + 从 Set 移除；
 * · 心跳写失败时不在这里删，留到 close 事件统一处理，避免同一连接被删两次；
 * · 真正写出错时由 writeTo 兜底移除，防止「已死但没收到 close」的僵尸连接一直留着。
 * 三处出口最终都指向 clients.delete，因此在线数（count）不会虚高。
 */
function subscribe(req, res, user) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // 关掉 nginx 缓冲，否则事件会被攒着一起发，前端就不是「实时」了
    'X-Accel-Buffering': 'no'
  })
  res.write(': connected\n\n')

  const client = { id: seq++, userId: Number(user.user_id), role: user.role, res }
  clients.add(client)

  // 心跳：25 秒一次，防止中间代理把空闲连接掐掉
  const ping = setInterval(() => {
    try { res.write(': ping\n\n') } catch (e) { /* 连接已断，交给 close 处理 */ }
  }, 25000)

  const cleanup = () => {
    clearInterval(ping)
    clients.delete(client)
  }
  req.on('close', cleanup)
  req.on('aborted', cleanup)
  return client
}

/**
 * 向单个连接写一条事件。
 * 写失败（客户端已断开、socket 已销毁）时顺手把连接从池里摘掉，
 * 这是「没收到 close 事件」场景下的兜底清理。
 *
 * @param {object} client subscribe 返回的句柄
 * @param {string} event 事件名，前端按此 addEventListener
 * @param {*} data 任意可 JSON 序列化的数据
 * @returns {void}
 */
function writeTo(client, event, data) {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  } catch (e) {
    clients.delete(client)
  }
}

// userIds 为 null/undefined 时广播给所有在线用户
/**
 * 按用户定向推送。
 *
 * @param {number[]|null} userIds 目标用户 ID 列表；传 null 表示广播
 * @param {string} event 事件名
 * @param {*} data 事件数据
 * @returns {number} 实际写入的连接数（同一用户多标签页会各算一次，仅供日志参考）
 *
 * 遍历前先 [...clients] 复制一份：writeTo 可能在失败时删除元素，
 * 直接遍历原 Set 会踩到「迭代中修改集合」的坑。
 */
function send(userIds, event, data) {
  const ids = userIds ? new Set(userIds.map(Number)) : null
  let n = 0
  for (const c of [...clients]) {
    if (ids && !ids.has(c.userId)) continue
    writeTo(c, event, data)
    n++
  }
  return n
}

/**
 * 向全部在线客户端广播。
 *
 * @param {string} event 事件名
 * @param {*} data 事件数据
 * @returns {number} 实际推送的连接数
 */
function broadcast(event, data) { return send(null, event, data) }
/**
 * 当前在线连接数（含同一用户的多标签页），用于系统状态页展示。
 *
 * @returns {number}
 */
function count() { return clients.size }

module.exports = { subscribe, send, broadcast, count }
