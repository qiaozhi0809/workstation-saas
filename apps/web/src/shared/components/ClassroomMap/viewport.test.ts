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

it('keeps at least 140px of the classroom on screen', () => {
  const v = clampView({ s: 1, x: -5000, y: 5000 }, { w: 1000, h: 800 }, { w: 800, h: 600 })
  expect(v.x).toBe(140 - 1000)
  expect(v.y).toBe(600 - 140)
})

it('turns wheel delta into a zoom factor', () => {
  expect(wheelZoomFactor(0)).toBe(1)
  expect(wheelZoomFactor(-100)).toBeGreaterThan(1)
})
