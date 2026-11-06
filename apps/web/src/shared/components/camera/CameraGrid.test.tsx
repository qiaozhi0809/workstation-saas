import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraBrief } from '@/shared/types/camera'
import { CameraGrid } from './CameraGrid'

const h = vi.hoisted(() => {
  type Handler = (event: string, data: unknown) => void
  class FakeHls {
    static instances: FakeHls[] = []
    static isSupported = () => true
    static Events = {
      ERROR: 'hlsError',
      MANIFEST_PARSED: 'hlsManifestParsed',
      FRAG_LOADED: 'hlsFragLoaded',
    }
    static ErrorDetails = {
      MANIFEST_LOAD_ERROR: 'manifestLoadError',
      LEVEL_LOAD_ERROR: 'levelLoadError',
    }
    handlers = new Map<string, Handler[]>()
    src = ''
    loadSource = vi.fn((s: string) => void (this.src = s))
    attachMedia = vi.fn()
    stopLoad = vi.fn()
    startLoad = vi.fn()
    destroy = vi.fn()
    constructor() {
      FakeHls.instances.push(this)
    }
    on(event: string, cb: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb])
    }
    off() {}
    emit(event: string, data?: unknown) {
      for (const cb of this.handlers.get(event) ?? []) cb(event, data)
    }
  }
  return { FakeHls }
})
vi.mock('hls.js', () => ({ default: h.FakeHls }))

const cams = (n: number): CameraBrief[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    name: `机位${i}`,
    location: '教室',
    status: 'streaming',
  }))

beforeEach(() => void (h.FakeHls.instances = []))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('CameraGrid', () => {
  it.each([
    [1, 'grid-cols-1'],
    [4, 'grid-cols-2'],
    [9, 'grid-cols-3'],
  ] as const)('size %i uses %s and caps tiles', (size, cls) => {
    const { container } = render(<CameraGrid cameras={cams(12)} size={size} />)
    expect(container.firstElementChild).toHaveClass('grid', cls)
    expect(h.FakeHls.instances).toHaveLength(size)
    expect(screen.getByLabelText('机位0')).toBeInTheDocument()
  })

  it('busy tile does not break others', () => {
    render(<CameraGrid cameras={cams(9)} size={9} />)
    const bad = h.FakeHls.instances[3]
    act(() =>
      bad.emit('hlsError', {
        details: 'manifestLoadError',
        fatal: true,
        response: { code: 503, text: '' },
        networkDetails: { responseText: JSON.stringify({ error: { code: 'STREAM_BUSY' } }) },
      }),
    )
    act(() => h.FakeHls.instances[0].emit('hlsFragLoaded'))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('同时观看的摄像头太多')
    expect(screen.getAllByText('加载中')).toHaveLength(7)
    expect(h.FakeHls.instances.filter((i) => i.destroy.mock.calls.length > 0)).toHaveLength(1)
    expect(screen.getAllByLabelText(/机位/)).toHaveLength(9)
  })

  it('shows tile titles and watermark only when all props given', () => {
    const { rerender } = render(<CameraGrid cameras={cams(2)} size={4} />)
    expect(screen.getByText('机位1')).toBeInTheDocument()
    expect(screen.queryByText(/正在直播/)).toBeNull()
    rerender(
      <CameraGrid
        cameras={cams(2)}
        size={4}
        schoolName="示例小学"
        viewerName="赵老师"
        timeZone="Asia/Shanghai"
      />,
    )
    expect(screen.getAllByText(/正在直播/)).toHaveLength(2)
    rerender(<CameraGrid cameras={cams(2)} size={4} schoolName="示例小学" />)
    expect(screen.queryByText(/正在直播/)).toBeNull()
  })
})
