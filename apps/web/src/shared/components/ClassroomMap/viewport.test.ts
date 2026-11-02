import { clampView, fitView, wheelZoomFactor, zoomAt } from './viewport'

it('fits and centers the classroom', () => {
  const v = fitView({ w: 2000, h: 1000 }, { w: 1000, h: 800 })
  expect(v.s).toBe(0.5)
  expect(v.x).toBe(0)
  expect(v.y).toBe(150)
  expect(fitView({ w: 100, h: 100 }, { w: 1000, h: 1000 }).s).toBe(1.25)
})

it('zooms around the pointer and respects bounds', () => {
  const v = zoomAt({ s: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 })
  expect(v).toEqual({ s: 2, x: -100, y: -50 })
  expect(zoomAt({ s: 2.4, x: 0, y: 0 }, 2, { x: 0, y: 0 }).s).toBe(2.5)
  expect(zoomAt({ s: 0.31, x: 0, y: 0 }, 0.5, { x: 0, y: 0 }).s).toBe(0.3)
})

it('fits the whole classroom into a short stage, below the manual zoom-out limit', () => {
  // 矮窗口里进入排座:舞台 314px 高,1292px 高的教室要缩到 0.3 以下才放得下
  const v = fitView({ w: 960, h: 1292 }, { w: 960, h: 314 })
  expect(v.s * 1292).toBeLessThanOrEqual(314)
  expect(v.y).toBeGreaterThanOrEqual(0)
})

it('does not jump when zooming from a fit below the manual zoom-out limit', () => {
  const fitted = { s: 0.2, x: 0, y: 0 }
  expect(zoomAt(fitted, 0.5, { x: 0, y: 0 }).s).toBe(0.2)
  expect(zoomAt(fitted, 1.2, { x: 0, y: 0 }).s).toBeCloseTo(0.24)
})

it('keeps at least 140px of the classroom on screen', () => {
  const v = clampView({ s: 1, x: -5000, y: 5000 }, { w: 1000, h: 800 }, { w: 800, h: 600 })
  expect(v.x).toBe(140 - 1000)
  expect(v.y).toBe(600 - 140)
})

it('turns wheel delta into a zoom factor', () => {
  expect(wheelZoomFactor(0)).toBe(1)
  expect(wheelZoomFactor(-100)).toBeGreaterThan(1)
})
