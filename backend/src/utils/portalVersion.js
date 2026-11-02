// 员工自助门户的版本标识
// -----------------------------------------------------------------------------
// 改动 public-portal/ 下的 index.html / app.js / style.css 时，务必同步修改这里，
// 以及以下两处（三处保持一致，门户才能识别「页面还是旧缓存」）：
//   1) public-portal/index.html 里 style.css / app.js 的 ?v= 版本串
//   2) public-portal/app.js 顶部的 PORTAL_VER
// 版本在门户页脚和「系统设置 → 自助服务入口」都会显示，排查「扫码看到旧样式」
// 时先看两边版本号是否一致。
module.exports = { PORTAL_VERSION: '20261102' }
