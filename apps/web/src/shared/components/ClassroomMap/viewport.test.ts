import { clampView, fitView, wheelZoomFactor, zoomAt } from './viewport'

it('fits and centers the classroom', () => {
  const v = fitView({ w: 2000, h: 1000 }, { w: 1000, h: 800 })
  expect(v.s).toBe(0.5)
  expect(v.x).toBe(0)
  expect(v.y).toBe(150)
  expect(fitView({ w: 100, h: 100 }, { w: 1000, h: 1000 }).s).toBe(1.25)
})

it('zooms around the pointer and respects bounds', () => {
  const v = zoomAt({ s: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 }, 0.1)
  expect(v).toEqual({ s: 2, x: -100, y: -50 })
  expect(zoomAt({ s: 2.4, x: 0, y: 0 }, 2, { x: 0, y: 0 }, 0.1).s).toBe(2.5)
  expect(zoomAt({ s: 0.5, x: 0, y: 0 }, 0.5, { x: 0, y: 0 }, 0.45).s).toBe(0.45)
})

it('fits the whole classroom into a very short stage', () => {
  // 矮窗口里进入排座:舞台 314px 高,1292px 高的教室要缩到 0.3 以下才放得下;这就是适应比例,也是缩小下限
  const v = fitView({ w: 960, h: 1292 }, { w: 960, h: 314 })
  expect(v.s * 1292).toBeLessThanOrEqual(314)
  expect(v.y).toBeGreaterThanOrEqual(0)
})

it('clampView keeps a zoomed axis covering the stage and centres a short one', () => {
  const content = { w: 2000, h: 500 }, stage = { w: 800, h: 600 }
  expect(clampView({ s: 1, x: 50, y: -5000 }, content, stage)).toEqual({ s: 1, x: 0, y: 50 })
  expect(clampView({ s: 1, x: -5000, y: 0 }, content, stage).x).toBe(800 - 2000)
})

it('turns wheel delta into a zoom factor', () => {
  expect(wheelZoomFactor(0)).toBe(1)
  expect(wheelZoomFactor(-100)).toBeGreaterThan(1)
})

it('fits by the safe width so the core keeps its size and only the wings are cropped', () => {
  const stage = { w: 1000, h: 800 }
  const wide = fitView({ w: 2298, h: 1292 }, stage, 960)
  expect(wide.s).toBe(fitView({ w: 960, h: 1292 }, stage).s)
  expect(wide.x).toBeCloseTo((1000 - 2298 * wide.s) / 2)
  expect(wide.x + (669 + 960 / 2) * wide.s).toBeCloseTo(500)
})
