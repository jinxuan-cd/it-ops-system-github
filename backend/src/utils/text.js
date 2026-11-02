/**
 * @file backend/src/utils/text.js
 * @description 把富文本/HTML 内容转为纯文本，供 AI 分析与导出报表使用
 *
 * 文本清洗 —— IT 运维工单台账与日报自动管理系统
 *
 * @author 锦轩 (JinXuan) <2686389727@qq.com>
 * @copyright Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
 * @license 个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
 *          其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
 * @created 2026-10-29
 */
// 纯文本清洗：AI 大模型很爱输出 Markdown（**加粗**、## 标题、- 列表、`代码`），
// 但日报 / 月报是要直接复制到微信、邮件、OA 里的纯文本，符号必须去掉。
// 这里做两层防御：① 提示词里明确禁止 Markdown；② 落库 / 返回前统一清洗一遍。
/**
 * 把 Markdown / 富文本压成适合粘贴到微信、邮件、OA 的纯文本。
 *
 * 处理顺序有讲究：先删代码块与图片，再删行内符号，最后按行处理标题/列表/表格，
 * 顺序颠倒会导致 `**` 被先删掉后列表符识别错位。
 *
 * @param {*} input 原始文本（可为 null / undefined）
 * @returns {string} 清洗后的纯文本，永不为 null
 *
 * 注意：本函数不做 HTML 实体解码，也不负责 XSS 转义——
 * 它只服务「喂给模型」与「导出报表」两个场景，展示层仍需前端转义。
 */
function toPlain(input) {
  if (input === null || input === undefined) return ''
  let t = String(input).replace(/\r\n?/g, '\n')

  // 代码块围栏 ``` 与缩进代码
  t = t.replace(/```[a-zA-Z0-9+#-]*\n?/g, '')
  // 行内代码 `xx`
  t = t.replace(/`([^`\n]*)`/g, '$1')
  // 图片 ![alt](url) 直接去掉，链接 [文字](url) 只留文字
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  t = t.replace(/\[([^\]\n]+)\]\([^)]*\)/g, '$1')
  // 标题 ### / ## / #
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, '')
  // 分割线 --- / *** / ___
  t = t.replace(/^[ \t]{0,3}([-*_])[ \t]*\1[ \t]*\1[ \t]*$/gm, '')
  // 引用 >
  t = t.replace(/^[ \t]{0,3}>[ \t]?/gm, '')
  // 加粗 / 斜体 / 删除线（成对出现才处理，避免误伤单个 * 号）
  t = t.replace(/\*\*\*([^*\n]+)\*\*\*/g, '$1')
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1')
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
  t = t.replace(/___([^_\n]+)___/g, '$1')
  t = t.replace(/__([^_\n]+)__/g, '$1')
  t = t.replace(/~~([^~\n]+)~~/g, '$1')
  // 无序列表 - / * / +  →  中文习惯的「· 」
  t = t.replace(/^([ \t]*)[-*+][ \t]+/gm, (m, sp) => sp + '· ')
  // 表格分隔行 |---|---|
  t = t.replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, '')
  // 表格竖线：保留单元格间的分隔感，去掉首尾竖线
  t = t.replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (m, inner) => inner.split('|').map(s => s.trim()).join('　'))
  // 零宽字符 / 行尾空白
  t = t.replace(/\u200b/g, '')
  t = t.replace(/[ \t]+$/gm, '')
  // 连续空行压成一行
  t = t.replace(/\n{3,}/g, '\n\n')
  return t.trim()
}

module.exports = { toPlain }
