// hls.js 只在第一个播放器挂载时才下载(L171)。单独一个文件:模块级缓存从零开始,才观察得到"还没请求"。
// vitest 的 vi.mock 工厂在模块第一次被 import 时才调用,所以工厂被调用的次数 = hls.js 被请求的次数
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CameraPlayer } from './CameraPlayer'

const h = vi.hoisted(() => {
  class FakeHls {
    static instances: FakeHls[] = []
    static isSupported = () => true
    static Events = {
      ERROR: 'hlsError',
      MANIFEST_PARSED: 'hlsManifestParsed',
      LEVEL_LOADED: 'hlsLevelLoaded',
      FRAG_LOADED: 'hlsFragLoaded',
    }
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' }
    static ErrorDetails = {
      MANIFEST_LOAD_ERROR: 'manifestLoadError',
      LEVEL_LOAD_ERROR: 'levelLoadError',
      FRAG_LOAD_ERROR: 'fragLoadError',
    }
    loadSource = vi.fn()
    attachMedia = vi.fn()
    stopLoad = vi.fn()
    startLoad = vi.fn()
    recoverMediaError = vi.fn()
    destroy = vi.fn()
    constructor() {
      FakeHls.instances.push(this)
    }
    on() {}
    off() {}
  }
  return { FakeHls, factoryCalls: 0 }
})
vi.mock('hls.js', () => {
  h.factoryCalls += 1
  return { default: h.FakeHls }
})

afterEach(cleanup)

it('loads hls lazily', async () => {
  // 导入 CameraPlayer 模块本身不会去拿 hls.js(以前是静态 import,这里就已经是 1 了)
  expect(h.factoryCalls).toBe(0)
  // 还没拿到 hls.js 就卸载的播放器:之后也不会替它建实例
  const early = render(<CameraPlayer cameraId="c0" title="早卸载" />)
  early.unmount()
  render(<CameraPlayer cameraId="c1" title="一号机位" />)
  // 挂载那一刻还没拿到 hls.js:先显示"加载中",没有实例
  expect(screen.getByRole('status')).toHaveTextContent('加载中')
  expect(h.FakeHls.instances).toHaveLength(0)
  await waitFor(() => expect(h.FakeHls.instances).toHaveLength(1))
  expect(h.factoryCalls).toBe(1)
  expect(h.FakeHls.instances[0].loadSource).toHaveBeenCalledWith('/api/v1/cameras/c1/stream.m3u8')
  expect(h.FakeHls.instances[0].attachMedia).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status')).toHaveTextContent('加载中')
  // 第二个播放器直接用缓存:挂载即同步建实例,hls.js 不再请求
  render(<CameraPlayer cameraId="c2" title="二号机位" />)
  expect(h.FakeHls.instances).toHaveLength(2)
  expect(h.FakeHls.instances[1].loadSource).toHaveBeenCalledWith('/api/v1/cameras/c2/stream.m3u8')
  expect(h.factoryCalls).toBe(1)
  // 卸载时实例销毁,早卸载的那个始终没有实例
  cleanup()
  expect(h.FakeHls.instances.map((i) => i.destroy.mock.calls.length)).toEqual([1, 1])
})
