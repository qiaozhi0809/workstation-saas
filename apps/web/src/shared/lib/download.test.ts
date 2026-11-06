import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { downloadBlob } from './download'

const anchors: HTMLAnchorElement[] = []
let click: ReturnType<typeof vi.spyOn>
const createUrl = vi.fn(() => 'blob:ws/1')
const revokeUrl = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  anchors.length = 0
  createUrl.mockClear()
  revokeUrl.mockClear()
  Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl })
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    anchors.push(this)
  })
})
afterEach(() => {
  click.mockRestore()
  vi.useRealTimers()
})

it('downloadBlob', () => {
  const blob = new Blob(['x'], { type: 'application/zip' })
  downloadBlob(blob, 'ws-diagnostics-20261106.zip')
  expect(createUrl).toHaveBeenCalledWith(blob)
  expect(anchors).toHaveLength(1)
  expect(anchors[0].download).toBe('ws-diagnostics-20261106.zip')
  expect(anchors[0].href).toBe('blob:ws/1')
  // 临时 <a> 点完即移除;对象地址等到下一轮再释放,避免个别浏览器取消下载
  expect(document.body.contains(anchors[0])).toBe(false)
  expect(revokeUrl).not.toHaveBeenCalled()
  vi.runAllTimers()
  expect(revokeUrl).toHaveBeenCalledWith('blob:ws/1')
})
