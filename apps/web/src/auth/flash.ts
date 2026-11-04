const KEY = 'ws-login-flash'

/** 一次性登录页提示(跨 logout 触发的重定向仍然存在,不依赖 router state) */
export function setLoginFlash(message: string): void {
  try { sessionStorage.setItem(KEY, message) } catch { /* 存储不可用时静默 */ }
}

/** 读取并清除 */
export function takeLoginFlash(): string | null {
  try {
    const m = sessionStorage.getItem(KEY)
    if (m !== null) sessionStorage.removeItem(KEY)
    return m
  } catch {
    return null
  }
}
