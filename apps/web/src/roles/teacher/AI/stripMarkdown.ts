// 整行只有 3 个以上 - * _(可夹空格)= Markdown 分隔线,连同换行一起去掉;
// 列表的 "- 要点" 和正文里的 "2026-11-02" 不受影响
const HORIZONTAL_RULE = /^[ \t]*(?:[-*_][ \t]*){3,}(?:\n|$)/gm

/** 去掉 Markdown 记号(# * > ` 与表格竖线)和分隔线,合并多余空行,去首尾空白;用于"记到成长记录"的纯文本。 */
export function stripMarkdown(text: string): string {
  return text
    .replace(HORIZONTAL_RULE, '')
    .replace(/[#*>`]/g, '')
    .replace(/\|/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
