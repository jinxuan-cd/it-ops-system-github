/**
 * @file backend/src/utils/portalVersion.js
 * @description 用于公众门户静态资源 ?v= 破缓存；修改时必须与 index.html、app.js 中的版本串同步
 *
 * 门户资源版本号 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-11-02
 */
// 员工自助门户的版本标识
// -----------------------------------------------------------------------------
// 改动 public-portal/ 下的 index.html / app.js / style.css 时，务必同步修改这里，
// 以及以下两处（三处保持一致，门户才能识别「页面还是旧缓存」）：
//   1) public-portal/index.html 里 style.css / app.js 的 ?v= 版本串
//   2) public-portal/app.js 顶部的 PORTAL_VER
// 版本在门户页脚和「系统设置 → 自助服务入口」都会显示，排查「扫码看到旧样式」
// 时先看两边版本号是否一致。
/**
 * 门户静态资源版本号（形如 20261102，按日期递增）。
 *
 * 三处必须同步，否则会出现「后端已更新、用户仍看到旧页面」：
 *   1) 本文件的 PORTAL_VERSION
 *   2) public-portal/index.html 中 style.css / app.js 的 ?v= 参数
 *   3) public-portal/app.js 顶部的 PORTAL_VER
 * 前端把该值拼到接口上并显示在页脚，后端「系统设置」也展示同一个值，
 * 两边不一致即说明浏览器在跑旧缓存。
 */
module.exports = { PORTAL_VERSION: '20261112b' }
