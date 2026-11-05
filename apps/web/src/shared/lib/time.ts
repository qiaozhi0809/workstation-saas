import { formatInTz } from './date'

/** 浏览器时区;取不到或为空时用 Asia/Shanghai */
export function localTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  } catch {
    return 'Asia/Shanghai'
  }
}

/** 截止时间的短写:`MM-DD HH:mm 截止`(本地时区) */
export function formatDeadline(iso: string): string {
  return `${formatInTz(iso, localTz()).slice(5)} 截止`
}
