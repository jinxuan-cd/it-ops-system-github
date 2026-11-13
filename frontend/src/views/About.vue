<!--
  关于与开源许可 —— IT 运维工单台账与日报自动管理系统
  版权信息、授权摘要、第三方组件许可清单与合规说明

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-11-02　　版本：1.2.2
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page">
    <h3 class="it-section-title">关于与开源许可</h3>

    <!-- 系统标识区：谁做的、什么版本、怎么联系。部署到客户现场时这一块要能被找到 -->
    <div class="it-card about-hero">
      <div class="hero-main">
        <div class="hero-logo">IT</div>
        <div class="hero-text">
          <div class="hero-title">IT 运维工单台账与日报自动管理系统</div>
          <div class="hero-sub">
            <el-tag size="small" effect="plain">v{{ version }}</el-tag>
            <span>私有化部署 · 源码可见（Source Available）</span>
          </div>
        </div>
      </div>
      <el-descriptions :column="descColumns" border size="small" class="hero-desc">
        <el-descriptions-item label="开发者">锦轩 (JinXuan)</el-descriptions-item>
        <el-descriptions-item label="联系方式">2686389727@qq.com</el-descriptions-item>
        <el-descriptions-item label="版权归属">Copyright (c) 2026 锦轩 (JinXuan)</el-descriptions-item>
        <el-descriptions-item label="本项目许可">自定义分级授权，见 LICENSE</el-descriptions-item>
        <el-descriptions-item label="第三方组件">{{ total }} 个</el-descriptions-item>
        <el-descriptions-item label="清单生成时间">{{ generatedAt }}</el-descriptions-item>
      </el-descriptions>
    </div>

    <!-- 授权摘要：放在这页是为了让部署方和最终用户都能直接看到边界，不用去翻 LICENSE -->
    <div class="it-card">
      <h4 class="block-title">本项目授权范围</h4>
      <el-alert type="warning" :closable="false" show-icon class="lic-note">
        <template #title>
          本项目<strong>不是</strong> MIT / Apache / GPL 等开放源代码许可，而是「源码可见 + 分级授权」。
        </template>
        源码可以查看和修改，但使用范围受 LICENSE 约束；对外分发、SaaS 托管、代运维等商业用途需单独购买授权。
      </el-alert>

      <div class="lic-grid">
        <div class="lic-col free">
          <div class="lic-head"><el-icon><CircleCheck /></el-icon> 免费使用</div>
          <ul>
            <li>个人自用：学习、研究、测试、个人事务管理</li>
            <li>员工（含兼职与长期外包）≤ 10 人，且上一会计年度营收 ≤ 200 万元人民币的小团队</li>
            <li>上述范围内用于自身经营，同样免费</li>
            <li>部署实例数、修改与二次开发均不额外收费</li>
          </ul>
        </div>
        <div class="lic-col paid">
          <div class="lic-head"><el-icon><Money /></el-icon> 需商业授权</div>
          <ul>
            <li>超出上述规模的组织使用</li>
            <li>对外销售、出租、分发本软件或修改版本</li>
            <li>部署为 SaaS / 云服务 / 托管服务并收费</li>
            <li>以本软件为基础提供收费的运维外包、集成、实施、技术支持</li>
            <li>嵌入其他商业产品交付，或去标识后贴牌交付</li>
          </ul>
        </div>
      </div>
      <div class="lic-contact">
        商业授权申请：<a href="mailto:2686389727@qq.com?subject=商业授权申请">2686389727@qq.com</a>
        <span class="lic-contact-tip">邮件标题格式「商业授权申请 - 公司名称」</span>
      </div>
      <div class="lic-activate">
        <p class="lic-activate-main">
          <el-icon><Key /></el-icon>
          <strong>激活方式：</strong>商业授权经邮箱购买后，作者会下发一串「授权码」。
          在系统「系统设置 → 授权管理」粘贴并验证，即可解除免费版限制（账号上限与功能开关按授权码放开）。
        </p>
        <p class="lic-activate-sub">
          免费版内置技术限制：仅 1 管理员 + 2 运维账号，并可在「菜单管理」关闭不需要的模块；
          软件不含任何在线支付 / 内购功能，授权交易全部在邮箱线下完成。授权码由作者私钥签名，无法伪造。
        </p>
      </div>
      <!-- 这两份文件随构建产物一起发布，镜像里也能直接打开，不用回源码仓库找 -->
      <div class="lic-files">
        <a href="/LICENSE" target="_blank" rel="noopener">查看完整许可协议（LICENSE）</a>
        <span class="sep">·</span>
        <a href="/NOTICE" target="_blank" rel="noopener">版权与第三方声明（NOTICE）</a>
      </div>
    </div>

    <!-- 第三方组件：默认只看直接依赖，需要时再展开全部传递依赖 -->
    <div class="it-card">
      <div class="it-between" style="margin-bottom:12px">
        <h4 class="block-title" style="margin:0">第三方组件</h4>
        <div class="pk-actions">
          <el-input
            v-model="keyword"
            placeholder="搜索组件名或许可协议"
            clearable
            size="small"
            style="width:220px"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-button size="small" @click="downloadList">
            <el-icon><Download /></el-icon> 下载完整许可清单
          </el-button>
        </div>
      </div>

      <el-tabs v-model="tab" @tab-change="resetPage">
        <el-tab-pane :label="`直接依赖（${directRows.length}）`" name="direct" />
        <el-tab-pane :label="`全部依赖（${allRows.length}）`" name="all" />
      </el-tabs>

      <el-table :data="pageRows" stripe size="small" class="pk-table">
        <el-table-column prop="name" label="组件" min-width="200">
          <template #default="{ row }">
            <span class="pk-name">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="version" label="实际安装版本" width="120" />
        <el-table-column label="许可协议" width="200">
          <template #default="{ row }">
            <!-- 双许可单独标色：这类组件必须明确选了哪一个，否则容易被误读成 GPL 传染 -->
            <el-tag size="small" :type="licTagType(row.license)" effect="plain">{{ row.license }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="所属服务" width="110">
          <template #default="{ row }">
            {{ row.treeLabel }}{{ row.dev ? ' · 构建期' : '' }}
          </template>
        </el-table-column>
        <el-table-column label="来源" min-width="220">
          <template #default="{ row }">
            <!-- 地址在生成阶段已统一规范成 https 完整地址，这里不再拼接 -->
            <a v-if="row.repo" :href="row.repo" target="_blank" rel="noopener" class="pk-repo">{{ row.repo }}</a>
            <span v-else class="pk-repo-none">上游未声明</span>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="filteredRows.length > pageSize"
        v-model:current-page="page"
        :page-size="pageSize"
        :total="filteredRows.length"
        layout="prev, pager, next, total"
        small
        class="pk-pager"
      />

      <div class="pk-foot">
        完整许可原文（含各组件版权行）已随系统分发，可通过
        <a href="/THIRD-PARTY-LICENSES.txt" target="_blank" rel="noopener">/THIRD-PARTY-LICENSES.txt</a>
        在线查看或下载。清单由 <code>node scripts/gen-third-party-licenses.js</code> 自动生成，
        版本号取自实际安装结果而非 package.json 的声明范围。
      </div>
    </div>

    <!-- 合规说明：把「为什么用了 GPL 组件却不传染」讲清楚，避免交付时被客户安全部门反复盘问 -->
    <div class="it-card">
      <h4 class="block-title">许可合规说明</h4>
      <el-collapse v-model="openFaq" class="comp">
        <el-collapse-item name="gpl" title="项目里有没有 GPL / AGPL 代码？会不会传染？">
          <p>
            经全量扫描，本系统直接与传递依赖共 {{ total }} 个组件，其中
            <strong>没有任何 AGPL、GPL-only、SSPL、BUSL、CC-BY-NC 等强传染或限制商用的许可</strong>。
            涉及 GPL 字样的只有一处：<code>jszip</code> 的声明是
            <code>(MIT OR GPL-3.0-or-later)</code>，属于双许可，本项目明确选择适用 <strong>MIT</strong>，
            因此不触发 GPL 义务。
          </p>
          <p>
            数据库 MariaDB 采用 GPL-2.0，但本系统以<strong>独立数据库进程</strong>方式使用它，
            通过 SQL 网络协议通信，不链接其库代码、不修改其源码、不与其编译成单一作品，
            不构成衍生作品。所用驱动 <code>mysql2</code> 是 MIT 许可的纯 JavaScript 协议实现，
            不链接 libmysqlclient / libmariadb 这类 GPL 客户端库。
          </p>
        </el-collapse-item>
        <el-collapse-item name="copy" title="有没有拷贝知名开源项目的核心实现？">
          <p>
            没有。业务代码（后端路由与工具、管理端页面、员工门户、部署脚本、数据库结构）
            均为独立编写，仓库内不存在 vendor 目录、压缩混淆代码、内联的第三方库、
            CDN 外链脚本或内嵌的第三方字体与图片。
          </p>
          <p>
            所有第三方能力均以依赖包形式引入，通过 <code>package.json</code> 声明、
            由包管理器安装，未复制其源码进本仓库。
          </p>
        </el-collapse-item>
        <el-collapse-item name="notice" title="MIT / Apache-2.0 要求保留声明，本项目怎么做的？">
          <p>
            打包工具会剥离依赖里的版权注释，因此不能只靠源码注释履约。本项目的做法是：
            构建时把完整的第三方许可清单输出到站点根目录
            （<code>/THIRD-PARTY-LICENSES.txt</code>），随分发物一并提供；
            本页面也在线列出全部组件、实际版本、许可与来源仓库。
          </p>
          <p>
            这同时满足 MIT / BSD 的「保留版权与许可声明」要求，以及
            Apache-2.0（ECharts 等）的「附一份许可副本」要求。
          </p>
        </el-collapse-item>
        <el-collapse-item name="exceptions" title="有哪些需要留意的例外？">
          <p>
            <strong>buffers@0.1.1</strong>：上游 package.json 未声明 license 字段、包内也没有 LICENSE 文件，
            严格从元数据看属「未明示授权」。其源码仓库长期以 MIT 发布，本项目通过
            exceljs → unzipper → binary 间接引入，仅在服务端进程内使用，不修改也不再分发该包源码。
            风险评估为低；若需彻底消除，可换用不依赖 unzipper 的 Excel 库。
          </p>
          <p>
            <strong>pako@1.0.11</strong>：声明为 <code>(MIT AND Zlib)</code>，需同时满足两者，
            但均为宽松许可、可商用、可闭源分发，仅要求保留声明，无冲突。
          </p>
        </el-collapse-item>
      </el-collapse>
    </div>

    <div class="about-foot">{{ copyright }} · v{{ version }}</div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { CircleCheck, Money, Search, Download, Key } from '@element-plus/icons-vue'
import thirdParty from '../generated/third-party.json'

// 构建期由 vite.config.js 的 define 注入，来源是 frontend/package.json 的 version，
// 只改 package.json 一处即可，不用到处找版本号
const version = __APP_VERSION__
const copyright = __APP_COPYRIGHT__

// 依赖数据在构建时固化进 bundle：生产镜像里只有 dist 没有 node_modules，
// 运行时读不到版本信息，所以只能靠 scripts/gen-third-party-licenses.js 预先生成
const total = thirdParty.total
const generatedAt = thirdParty.generatedAt

// 两个 node_modules 摊平成一个列表，附带所属服务标签，表格里一眼能看出是后端还是前端的依赖
const rowsWithTree = thirdParty.trees.flatMap(t =>
  t.packages.map(p => ({ ...p, treeKey: t.key, treeLabel: t.key === 'backend' ? '后端' : '前端' }))
)

// 直接依赖 = package.json 里点名的（含构建期的 vite / plugin-vue，这类会标「构建期」）
const directRows = rowsWithTree.filter(p => p.direct || p.dev)
// 全部依赖 = 含传递依赖，用于回答「到底引进了多少东西」
const allRows = rowsWithTree

const tab = ref('direct')
const keyword = ref('')
const page = ref(1)
// 每页 20 行：全部依赖有 400 多条，不分页会拉出极长的滚动条
const pageSize = 20
// 折叠面板默认展开最关键的那一条（GPL 问题），其余收起，页面不至于一进来就被文字淹没
const openFaq = ref(['gpl'])

// 搜索同时匹配组件名与许可协议：排查「哪些是 Apache-2.0」这类问题很常用
const filteredRows = computed(() => {
  const base = tab.value === 'direct' ? directRows : allRows
  const kw = keyword.value.trim().toLowerCase()
  const list = kw
    ? base.filter(r => r.name.toLowerCase().includes(kw) || r.license.toLowerCase().includes(kw))
    : base
  // 直接依赖排在前面，其余按名称，保证默认视图先看到最需要关注的东西
  return [...list].sort((a, b) => {
    const da = a.direct || a.dev ? 0 : 1
    const db = b.direct || b.dev ? 0 : 1
    return da - db || a.name.localeCompare(b.name)
  })
})

const pageRows = computed(() => {
  const start = (page.value - 1) * pageSize
  return filteredRows.value.slice(start, start + pageSize)
})

// 切 tab 或改搜索词后回到第一页，否则可能停在超出范围的空页上
function resetPage() {
  page.value = 1
}
// 搜索词变一次就回首页，否则输入后看到的可能是第 5 页的空结果
watch(keyword, resetPage)

// 双许可 / 未声明的许可单独用颜色区分，避免被扫一眼误判
function licTagType(lic) {
  if (/未声明/.test(lic)) return 'danger'
  if (/OR|AND/i.test(lic)) return 'warning'
  if (/GPL|AGPL/i.test(lic)) return 'danger'
  return 'info'
}

// 下载完整清单：用 a[download] 触发浏览器下载，不新开标签页
function downloadList() {
  const a = document.createElement('a')
  a.href = '/THIRD-PARTY-LICENSES.txt'
  a.download = 'THIRD-PARTY-LICENSES.txt'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
</script>

<style scoped>
/* 顶部标识区：深色渐变呼应侧边栏，让「关于」页也有品牌感 */
.about-hero {
  background: linear-gradient(135deg, #1f2a44 0%, #2b3a5c 100%);
  color: #fff;
  border: none;
}
.hero-main { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
.hero-logo {
  width: 52px; height: 52px; border-radius: 12px; flex: none;
  background: rgba(255, 255, 255, 0.14);
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; font-weight: 700; letter-spacing: 0.5px;
}
.hero-title { font-size: 17px; font-weight: 600; margin-bottom: 6px; }
.hero-sub { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: rgba(255, 255, 255, 0.72); }
/* 深底上的标签用半透明，避免白底标签过于抢眼 */
.hero-sub :deep(.el-tag) {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.3);
  color: #fff;
}

/* descriptions 在白底卡片里放，深底上文字会看不清，所以单独给浅底 */
.hero-desc { background: #fff; border-radius: 8px; overflow: hidden; }
.hero-desc :deep(.el-descriptions__label) { width: 96px; color: var(--it-text-sub); }

.block-title { font-size: 14px; font-weight: 600; margin: 0 0 12px; color: var(--it-text); }

.lic-note { margin-bottom: 14px; }

/* 免费 / 付费两栏对比，宽屏并排、窄屏堆叠 */
.lic-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}
.lic-col {
  border: 1px solid var(--it-border);
  border-radius: 10px;
  padding: 14px 16px;
  background: #fafbfd;
}
/* 付费栏用淡黄底强调「这一栏要花钱」，免费栏用淡绿，但都不上饱和色，避免花哨 */
.lic-col.paid { background: #fffbf3; border-color: #f5e2bd; }
.lic-col.free { background: #f6fbf7; border-color: #d6ecd9; }
.lic-head {
  display: flex; align-items: center; gap: 6px;
  font-weight: 600; font-size: 13.5px; margin-bottom: 8px;
}
.lic-col.free .lic-head { color: #2e7d4f; }
.lic-col.paid .lic-head { color: #b7791f; }
.lic-col ul { margin: 0; padding-left: 18px; }
.lic-col li { font-size: 12.5px; line-height: 1.9; color: var(--it-text-sub); }

.lic-contact {
  margin-top: 14px; padding-top: 12px;
  border-top: 1px dashed var(--it-border);
  font-size: 12.5px; color: var(--it-text-sub);
}
.lic-contact a { color: var(--it-primary); font-weight: 600; }
.lic-contact-tip { margin-left: 10px; opacity: 0.75; }
/* 激活说明区：承接在联系方式之后，强调“邮箱购买 + 授权码激活 + 无内购” */
.lic-activate {
  margin-top: 12px; padding: 12px 14px;
  border-radius: 8px; background: #f4f7fc; border: 1px solid var(--it-border);
}
.lic-activate-main { display: flex; align-items: flex-start; gap: 6px; margin: 0 0 6px; font-size: 12.8px; color: var(--it-text); }
.lic-activate-main .el-icon { margin-top: 2px; color: var(--it-primary); }
.lic-activate-main strong { color: var(--it-text); }
.lic-activate-sub { margin: 0; font-size: 12px; line-height: 1.85; color: var(--it-text-sub); }
/* 许可文件入口：与上面的联系方式分开一行，视觉上属于「补充材料」而非主要动作 */
.lic-files { margin-top: 8px; font-size: 12.5px; color: var(--it-text-sub); }
.lic-files a { color: var(--it-primary); text-decoration: none; }
.lic-files a:hover { text-decoration: underline; }
.lic-files .sep { margin: 0 8px; opacity: 0.5; }

.pk-actions { display: flex; align-items: center; gap: 8px; }
/* 组件名用等宽字体，技术用户扫视时更容易对上 npm 包名 */
.pk-name { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
.pk-repo { color: var(--it-primary); font-size: 12px; text-decoration: none; }
.pk-repo:hover { text-decoration: underline; }
.pk-repo-none { color: var(--it-text-sub); }
.pk-table { margin-top: 4px; }
.pk-pager { margin-top: 12px; justify-content: flex-end; }
.pk-foot {
  margin-top: 14px; padding-top: 12px;
  border-top: 1px dashed var(--it-border);
  font-size: 12px; line-height: 1.9; color: var(--it-text-sub);
}
.pk-foot code {
  background: #f2f4f8; padding: 1px 5px; border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.comp :deep(.el-collapse-item__content) { font-size: 12.8px; line-height: 1.95; color: var(--it-text-sub); }
.comp p { margin: 0 0 10px; }
.comp code {
  background: #f2f4f8; padding: 1px 5px; border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.about-foot {
  text-align: center; font-size: 12px; color: var(--it-text-sub);
  padding: 8px 0 24px;
}

/* 手机端：卡片内边距收窄，两栏变单栏，操作按钮换行 */
@media (max-width: 768px) {
  .hero-main { gap: 12px; }
  .hero-title { font-size: 15px; }
  .pk-actions { width: 100%; flex-wrap: wrap; }
  .pk-actions :deep(.el-input) { width: 100% !important; }
}
</style>
