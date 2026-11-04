const KEY = 'ws-login-flash'

/** 一次性登录页提示(跨 logout 触发的重定向仍然存在,不依赖 router state) */
export function setLoginFlash(message: string): void {
  try { sessionStorage.setItem(KEY, message) } catch { /* 存储不可用时静默 */ }
}

/** 只读不清(StrictMode 下初始化器会重复执行,清除放在 effect 里) */
export function peekLoginFlash(): string | null {
  try { return sessionStorage.getItem(KEY) } catch { return null }
}

export function clearLoginFlash(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* 静默 */ }
}
