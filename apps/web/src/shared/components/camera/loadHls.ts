import type HlsClass from 'hls.js'

export type HlsCtor = typeof HlsClass

let cached: HlsCtor | null = null
let loading: Promise<HlsCtor> | null = null

/** 已经拿到的 hls.js 构造函数;还没下载到时为 null(播放器据此走同步路径) */
export const loadedHls = (): HlsCtor | null => cached

/**
 * hls.js 只在第一个播放器挂载时才下载(这里的 `import()` 让 Vite 把它拆成单独的 chunk),没有摄像头的页面
 * 不会请求它(L171)。拿到过一次之后同步可用;消费方也可以提前调用预热。下载失败不缓存,下次再试
 */
export function loadHls(): Promise<HlsCtor> {
  if (cached) return Promise.resolve(cached)
  loading ??= import('hls.js').then(
    (m) => (cached = m.default),
    (err: unknown) => {
      loading = null
      throw err
    },
  )
  return loading
}
