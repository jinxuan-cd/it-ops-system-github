#!/usr/bin/env node
/**
 * @file scripts/gen-third-party-licenses.js
 * @description 扫描实际安装的第三方依赖，生成 THIRD-PARTY-LICENSES.txt 许可清单
 *
 * 第三方组件许可清单生成器 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-11-02
 */
/* ==========================================================================
   为什么需要这个脚本
   --------------------------------------------------------------------------
   1. Vue / Element Plus / ECharts 这类依赖都要求「在分发物中保留版权与许可
      声明」：MIT 要求保留 notice，Apache-2.0 要求附一份许可副本。而 Vite +
      esbuild 打包时会把这些注释全部剥离，dist 里一条声明都不会剩，光靠源码
      里的注释不算履约。所以必须在构建产物里放一份可访问的许可清单。
   2. 清单必须反映**实际安装的版本**，不能照抄 package.json 的范围号
      （^4.19.2 装出来可能是 4.22.3），否则清单与实物不符等于没写。
   3. 许可原文从各包自己的 LICENSE 文件里读，不手写标准条款 —— 手抄容易抄错，
      而且各包的版权行（Copyright (c) ...）是必须原样保留的，不能统一替换。

   用法：
       node scripts/gen-third-party-licenses.js
   产出：
       THIRD-PARTY-LICENSES.txt                             根目录，随源码分发
       frontend/public/THIRD-PARTY-LICENSES.txt              随构建进入 dist，可下载
   ========================================================================== */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const OUT_FILES = [
  path.join(ROOT, 'THIRD-PARTY-LICENSES.txt'),
  // 放进 public/ 的文件会被 Vite 原样复制到 dist 根目录，
  // 这样部署后可通过 /THIRD-PARTY-LICENSES.txt 直接访问，满足「随分发物提供」。
  path.join(ROOT, 'frontend', 'public', 'THIRD-PARTY-LICENSES.txt')
]

// 管理端「关于与开源许可」页面直接 import 这份 JSON，构建时被打进 bundle。
// 之所以要单独产出一份 JSON，是因为生产镜像里前端只有 dist 没有 node_modules，
// 运行时读不到依赖版本，只能在构建期把数据固化进去。
const OUT_JSON = path.join(ROOT, 'frontend', 'src', 'generated', 'third-party.json')

// 两个 node_modules 分开扫，输出时也分开列，方便对照是哪个服务的依赖
const TREES = [
  {
    key: 'backend',
    label: '后端服务 (backend)',
    root: path.join(ROOT, 'backend', 'node_modules'),
    manifest: path.join(ROOT, 'backend', 'package.json')
  },
  {
    key: 'frontend',
    label: '管理端前端 (frontend)',
    root: path.join(ROOT, 'frontend', 'node_modules'),
    manifest: path.join(ROOT, 'frontend', 'package.json')
  }
]

// 找许可文件。名字各包不统一，按优先级试
const LICENSE_NAMES = [
  'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE.markdown', 'LICENCE',
  'COPYING', 'COPYING.md', 'COPYING.txt', 'LICENSE-MIT', 'LICENSE.BSD'
]

// 宽松许可：可安全随闭源/商业项目分发，只需保留声明
const PERMISSIVE = new Set([
  'MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause',
  'BlueOak-1.0.0', 'Unlicense', '0BSD', 'MIT/X11', 'BSD', 'Zlib'
])

function readPkg(dir) {
  const pj = path.join(dir, 'package.json')
  if (!fs.existsSync(pj)) return null
  try {
    return JSON.parse(fs.readFileSync(pj, 'utf8'))
  } catch (e) {
    return null
  }
}

function licenseOf(pkg) {
  let lic = pkg.license
  // 老包用 licenses 数组（已废弃字段），兼容一下
  if (!lic && pkg.licenses) {
    lic = Array.isArray(pkg.licenses)
      ? pkg.licenses.map(l => l.type || l).join(' OR ')
      : pkg.licenses.type
  }
  return lic || ''
}

// 把各包五花八门的 repository 写法统一成可点击的 https 地址。
// 实际遇到的形态有 5 种：https://…、git+https://…、git://…、
// git@github.com:owner/repo、ssh://git@github.com/owner/repo，
// 还有 106 个包直接写的 owner/repo 简写 —— 简写如果不补全，拼上 https:// 就是坏链接。
function repoOf(pkg) {
  const r = pkg.repository
  if (!r) return ''
  let s = String(typeof r === 'string' ? r : r.url || '').trim()
  if (!s) return ''
  s = s.replace(/^git\+/, '')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git:\/\//, 'https://')
    .replace(/^git@([^:]+):/, 'https://$1/')
    // npm 还支持 github:owner/repo、gitlab:owner/repo 这种托管商简写
    .replace(/^github:/, 'https://github.com/')
    .replace(/^gitlab:/, 'https://gitlab.com/')
    .replace(/^bitbucket:/, 'https://bitbucket.org/')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
  if (/^https?:\/\//.test(s)) return s
  // 无协议但已带托管域名（gitlab / bitbucket 等）：补协议即可
  if (/^(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org|gitee\.com)\//.test(s)) return 'https://' + s
  // owner/repo 简写：npm 生态里默认按 GitHub 解析
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return 'https://github.com/' + s
  return 'https://' + s
}

function readLicenseText(dir) {
  for (const name of LICENSE_NAMES) {
    const f = path.join(dir, name)
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const txt = fs.readFileSync(f, 'utf8').trim()
      if (txt) return { file: name, text: txt }
    }
  }
  return null
}

// 收集一个 node_modules 下的全部包（含 @scope/name）
function collect(treeRoot, directNames, devNames) {
  const out = []
  if (!fs.existsSync(treeRoot)) return out
  for (const entry of fs.readdirSync(treeRoot)) {
    if (entry.startsWith('.')) continue
    const dirs = entry.startsWith('@')
      ? fs.readdirSync(path.join(treeRoot, entry)).map(n => path.join(entry, n))
      : [entry]
    for (const rel of dirs) {
      const dir = path.join(treeRoot, rel)
      const pkg = readPkg(dir)
      if (!pkg) continue
      const lic = readLicenseText(dir)
      const name = pkg.name || rel
      out.push({
        name,
        version: pkg.version || '?',
        license: licenseOf(pkg) || '(未声明)',
        repo: repoOf(pkg),
        // direct = 在 package.json 里直接点名；dev = 只在构建期使用，不进生产产物
        direct: directNames.has(name),
        dev: devNames.has(name),
        text: lic ? lic.text : null,
        textFile: lic ? lic.file : null
      })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// 许可原文去重：不同包常常共用同一份标准条款，只有版权行不同。
// 内容完全相同的合并成一条，清单不至于把同一段 MIT 抄 300 遍。
function dedupeByText(pkgs) {
  const byHash = new Map()
  for (const p of pkgs) {
    if (!p.text) continue
    const norm = p.text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim()
    const hash = crypto.createHash('sha1').update(norm).digest('hex')
    if (!byHash.has(hash)) {
      byHash.set(hash, { text: norm, license: p.license, members: [] })
    }
    byHash.get(hash).members.push(p)
  }
  return [...byHash.values()].sort((a, b) => b.members.length - a.members.length)
}

function main() {
  const trees = TREES.map(t => {
    // 从各自的 package.json 取「直接依赖」清单，用来区分直接依赖与传递依赖
    let manifest = {}
    try {
      manifest = JSON.parse(fs.readFileSync(t.manifest, 'utf8'))
    } catch (e) { /* 缺 manifest 就当作全是传递依赖 */ }
    const directNames = new Set(Object.keys(manifest.dependencies || {}))
    const devNames = new Set(Object.keys(manifest.devDependencies || {}))
    return { ...t, pkgs: collect(t.root, directNames, devNames) }
  })
  const all = trees.flatMap(t => t.pkgs)

  if (!all.length) {
    console.error('没有扫描到任何依赖。请先在 backend/ 与 frontend/ 执行 npm install。')
    process.exit(1)
  }

  // 许可分布统计
  const dist = {}
  for (const p of all) dist[p.license] = (dist[p.license] || 0) + 1

  const L = []
  const line = ch => L.push(ch.repeat(80))
  const when = new Date().toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })

  line('=')
  L.push('  第三方组件许可清单 (THIRD-PARTY LICENSES)')
  L.push('  IT 运维工单台账与日报自动管理系统')
  line('=')
  L.push('')
  L.push('  本文件由 scripts/gen-third-party-licenses.js 自动生成，请勿手工编辑。')
  L.push('  重新生成：node scripts/gen-third-party-licenses.js')
  L.push('  生成时间：' + when)
  L.push('')
  L.push('  说明：')
  L.push('  1. 本文件列出本项目运行时所依赖的全部第三方组件的名称、实际安装版本、')
  L.push('     许可协议与来源仓库，并在第四节附上各许可协议的完整原文。')
  L.push('  2. 这些组件各自适用其原有许可协议，著作权归各自作者所有，')
  L.push('     不受本项目 LICENSE 的约束，本项目也不对其作任何再授权。')
  L.push('  3. 若你基于本项目二次开发或对外分发，请随分发物一并保留本文件；')
  L.push('     MIT / BSD 类许可要求保留版权与许可声明，Apache-2.0 要求附许可副本。')
  L.push('  4. 清单反映的是生成本文件时所处环境的实际安装结果。在 Windows 开发机上')
  L.push('     安装时会出现 @esbuild/win32-x64、@rollup/rollup-win32-* 这类平台专用')
  L.push('     二进制包，它们不会进入 Linux 生产镜像，属正常现象。')
  L.push('')
  L.push('  统计：共 ' + all.length + ' 个第三方组件')
  L.push('')

  // ---------- 一、许可分布 ----------
  line('-')
  L.push('  一、许可协议分布')
  line('-')
  L.push('')
  for (const k of Object.keys(dist).sort((a, b) => dist[b] - dist[a])) {
    L.push('  ' + String(dist[k]).padStart(4) + ' 个   ' + k)
  }
  L.push('')

  // ---------- 二、组件清单 ----------
  for (const t of trees) {
    line('-')
    L.push('  二、组件清单 — ' + t.label + '（' + t.pkgs.length + ' 个）')
    line('-')
    L.push('')
    const w = Math.max(...t.pkgs.map(p => (p.name + '@' + p.version).length), 20)
    for (const p of t.pkgs) {
      const id = (p.name + '@' + p.version).padEnd(w)
      L.push('  ' + id + '  ' + p.license.padEnd(26) + (p.repo || '(无仓库地址)'))
    }
    L.push('')
  }

  // ---------- 三、需要特别说明的组件 ----------
  line('-')
  L.push('  三、需要特别说明的组件')
  line('-')
  L.push('')
  L.push('  1) jszip@3.10.x —— 双许可 (MIT OR GPL-3.0-or-later)')
  L.push('     jszip 同时以 MIT 和 GPL-3.0-or-later 两个协议授权，使用者可任选其一。')
  L.push('     本项目明确选择适用 MIT（SPDX 标识符：MIT），而非 GPL-3.0-or-later。')
  L.push('     因此 jszip 不构成本项目适用 GPL 传染性条款的原因，也不要求本项目')
  L.push('     以 GPL 发布。若你二次开发后希望改用 GPL-3.0-or-later 分发，')
  L.push('     请自行按该协议重新履行义务（涉及全部分发代码）。')
  L.push('     jszip 由 exceljs 间接引入，用于 Excel 文件的压缩容器读写。')
  L.push('')
  L.push('  2) buffers@0.1.1 —— 上游未声明许可字段')
  L.push('     该包 package.json 中没有 license 字段，包内也没有 LICENSE 文件，')
  L.push('     属上游历史遗留问题（作者 James Halliday，2012 年发布）。其源码仓库')
  L.push('     github.com/substack/node-buffers 长期以 MIT 发布，但严格从包元数据看')
  L.push('     属于「未明示授权」。本项目通过 exceljs → unzipper → binary 间接引入，')
  L.push('     仅在服务端进程内使用，不修改、不再分发该包源码（分发时 node_modules')
  L.push('     通常不随包，由使用者自行 npm install 获取）。')
  L.push('     风险评估：低。如需彻底消除该瑕疵，可改用不依赖 unzipper 的 Excel 库，')
  L.push('     或升级到已移除该依赖的版本。')
  L.push('')
  L.push('  3) pako@1.0.11 —— (MIT AND Zlib)')
  L.push('     需同时满足 MIT 与 Zlib 两个许可，二者均为宽松许可、可商用、可闭源分发，')
  L.push('     仅要求保留声明，无冲突。')
  L.push('')
  L.push('  4) MariaDB 10.11 —— GPL-2.0（独立进程，不传染）')
  L.push('     MariaDB 以 GPL-2.0 发布。本项目以「独立数据库进程」方式使用它，')
  L.push('     通过 SQL 网络协议通信，不链接其任何库代码、不修改其源码、')
  L.push('     不将其与自身代码编译成单一作品，因此不构成 GPL 意义上的衍生作品，')
  L.push('     本项目无需按 GPL 发布。这是业界（含商业软件）使用 MySQL/MariaDB 的')
  L.push('     通行且被广泛接受的方式。')
  L.push('     注意：本项目使用的驱动是 mysql2（MIT），它是纯 JavaScript 的协议实现，')
  L.push('     不链接 libmysqlclient / libmariadb 等 GPL 客户端库。')
  L.push('     若你改用官方 C 客户端库或 GPL 版连接器，则可能构成链接从而触发 GPL，')
  L.push('     请务必先评估。')
  L.push('')
  L.push('  5) Node.js / Nginx / Docker —— 属运行环境，非本项目分发物')
  L.push('     本项目以容器镜像方式部署时，基础镜像内含上述软件，其许可各自适用，')
  L.push('     详见对应官方发行说明。Node.js 为 MIT，Nginx 为 BSD-2-Clause，')
  L.push('     Docker Engine 为 Apache-2.0。')
  L.push('')

  // ---------- 四、许可原文 ----------
  const groups = dedupeByText(all)
  line('-')
  L.push('  四、许可协议原文（按引用包数量排序，内容相同的已合并）')
  line('-')
  L.push('')

  const missing = all.filter(p => !p.text)
  if (missing.length) {
    L.push('  说明：下列组件包内未附带 LICENSE 文件，其许可协议以上方清单中记录的')
    L.push('  package.json 声明值为准（多数为 MIT / ISC）。其中 buffers 连声明值都')
    L.push('  缺失，已在上文第三节单独说明。')
    L.push('')
    for (const p of missing) L.push('    · ' + p.name + '@' + p.version + '  (' + p.license + ')')
    L.push('')
  }

  groups.forEach((g, i) => {
    L.push('')
    line('-')
    L.push('  [' + (i + 1) + '] ' + g.license)
    const names = g.members.map(m => m.name + '@' + m.version)
    // 成员太多的（如 MIT 被上百个包引用）只列前 8 个，避免清单臃肿
    const shown = names.slice(0, 8).join(', ')
    L.push('      适用组件：' + shown + (names.length > 8 ? ' 等共 ' + names.length + ' 个' : ''))
    line('-')
    L.push('')
    for (const l of g.text.split('\n')) L.push('  ' + l)
    L.push('')
  })

  // ---------- 结尾 ----------
  line('=')
  L.push('  本文件到此结束。')
  L.push('  版权与授权咨询：锦轩 (JinXuan) <2686389727@qq.com>')
  line('=')
  L.push('')

  const content = L.join('\n')
  for (const out of OUT_FILES) {
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, content, 'utf8')
  }

  // 页面用的精简 JSON：去掉许可全文，只留展示需要的最小字段。
  // 全文已在 TXT 里，重复塞进 bundle 没意义，还白白撑大构建产物。
  const json = {
    generatedAt: when,
    total: all.length,
    trees: trees.map(t => ({
      key: t.key,
      label: t.label,
      packages: t.pkgs.map(p => ({
        name: p.name,
        version: p.version,
        license: p.license,
        repo: p.repo,
        direct: p.direct,
        dev: p.dev
      }))
    }))
  }
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true })
  fs.writeFileSync(OUT_JSON, JSON.stringify(json, null, 2), 'utf8')

  // 把本项目的 LICENSE 与 NOTICE 也放进 public/：容器镜像里只有 dist，
  // 不分发源码时第三方清单之外还得能看到项目本身的授权条款，否则拿到镜像的人
  // 只能看到一堆 MIT/Apache，不知道这套系统本身要怎么用。
  // 由脚本复制而不是手工拷贝，避免根目录改了这两份、dist 里还是旧版。
  for (const name of ['LICENSE', 'NOTICE']) {
    const src = path.join(ROOT, name)
    if (!fs.existsSync(src)) continue
    const dst = path.join(ROOT, 'frontend', 'public', name)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
  }
  console.log('\n已随构建产物发布：LICENSE、NOTICE、THIRD-PARTY-LICENSES.txt')
  console.log('（部署后可在站根目录直接访问，例如 http://管理端地址/LICENSE）')

  console.log('第三方组件总数：' + all.length)
  console.log('许可原文去重后：' + groups.length + ' 份')
  console.log('未提供 LICENSE 文件的组件：' + (missing.length ? missing.map(m => m.name).join(', ') : '无'))
  console.log('已写入：')
  for (const out of [...OUT_FILES, OUT_JSON]) {
    console.log('  ' + path.relative(ROOT, out) + '  (' + (fs.statSync(out).size / 1024).toFixed(1) + ' KB)')
  }
  // 有非宽松许可时提示一声，避免以后新增依赖引入问题时没人发现
  const risky = all.filter(p => /GPL|AGPL|SSPL|BUSL|Commons Clause|CC-BY-NC|Proprietary/i.test(p.license))
  if (risky.length) {
    console.log('\n注意：以下组件许可含传染性或限制性字样，请确认已在第三节说明：')
    for (const p of risky) console.log('  ' + p.license + '  ' + p.name + '@' + p.version)
  }
}

main()
