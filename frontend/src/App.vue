<!--
  根组件 —— IT 运维工单台账与日报自动管理系统
  仅承载路由出口，全局样式由各布局组件承担

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.1
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <router-view />
</template>

<script setup>
// 根组件：只做路由出口。
// 之所以不在这里放布局，是因为 /login、/report、/faq 这类页面要脱离后台框架单独展示，
// 由路由表把 MainLayout 挂成「/」的父路由，只有登录后的业务页才套用侧边栏与顶栏。
</script>
