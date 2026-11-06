import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '@/shared/components/Markdown'
import { downloadText } from '@/shared/lib/csv'

const STYLE =
  'body{font-family:SimSun,"宋体",serif;font-size:12pt;line-height:1.6} table{border-collapse:collapse} td,th{border:1px solid;padding:4px 8px}'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 标题 → 文件名:非法字符换成 _,最多 60 字,去首尾空格(截断后再去一次,免得正好切在空格上,L96),空标题用"AI 草稿" */
function fileName(title: string): string {
  const base = title
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 60)
    .trim()
  return `${base || 'AI 草稿'}.doc`
}

/** 把 Markdown 导出为 Word 能直接打开的 .doc(带 Office 命名空间的 HTML,前置 BOM) */
export function exportWord(title: string, markdown: string): void {
  const body = renderToStaticMarkup(createElement(Markdown, { text: markdown }))
  const html =
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">' +
    `<head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>` +
    `<body><h1>${escapeHtml(title)}</h1>${body}</body></html>`
  downloadText(fileName(title), '﻿' + html, 'application/msword')
}
