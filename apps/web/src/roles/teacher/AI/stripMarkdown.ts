/** 去掉 Markdown 记号(# * > ` 与表格竖线),合并多余空行,去首尾空白;用于"记到成长记录"的纯文本。 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/[#*>`]/g, '')
    .replace(/\|/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
