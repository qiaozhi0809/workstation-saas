/** 从 User-Agent 取"浏览器 · 系统"的短写;空值给"—",认不出给"其他" */
export function browserSummary(ua: string | null): string {
  if (!ua) return '—'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null
  if (!browser && !os) return '其他'
  return [browser, os].filter(Boolean).join(' · ')
}
