import { useAuthStore } from './auth'

const KEY = 'ws-auth'

interface Persisted {
  accessToken: string | null
  userId: string | null
}

/** 解析另一标签写入的存档;null = 已登出,undefined = 无法解析(忽略) */
function parse(raw: string | null): Persisted | null | undefined {
  if (raw === null) return null
  try {
    const state = (JSON.parse(raw) as { state?: Record<string, unknown> } | null)?.state
    if (!state || typeof state !== 'object') return undefined
    const token =
      typeof state.accessToken === 'string' && state.accessToken ? state.accessToken : null
    const user = state.user as { id?: unknown } | null | undefined
    return { accessToken: token, userId: typeof user?.id === 'string' ? user.id : null }
  } catch {
    return undefined
  }
}

/** 监听其他标签对 ws-auth 的写入,同步登出 / 换号 / 刷新后的 access。返回取消监听函数。 */
export function startAuthSync(storage: Window = window): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    if (e.storageArea && e.storageArea !== storage.localStorage) return
    const next = parse(e.newValue)
    if (next === undefined) return
    const cur = useAuthStore.getState()
    if (!next || !next.accessToken) {
      if (!cur.accessToken) return // 本标签已登出:不重复处理,避免回环
      cur.logout()
      if (storage.location.pathname !== '/login') storage.location.assign('/login')
      return
    }
    if (cur.user && next.userId && next.userId !== cur.user.id) {
      storage.location.assign('/')
      return
    }
    if (next.accessToken !== cur.accessToken) void useAuthStore.persist.rehydrate()
  }
  storage.addEventListener('storage', onStorage as EventListener)
  return () => storage.removeEventListener('storage', onStorage as EventListener)
}
