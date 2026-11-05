import { clampView, fitView, rectFullyShownInFit, wheelZoomFactor, zoomAt } from './viewport'

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
  const content = { w: 2000, h: 500 },
    stage = { w: 800, h: 600 }
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

it('judges whether a rect is fully inside the stage in the fit view', () => {
  const content = { w: 2298, h: 1292 }
  // 宽 1000 的舞台:适应比例由安全区 960 决定,两翼对称被裁
  const stage = { w: 1000, h: 1292 }
  expect(rectFullyShownInFit(content, stage, 960, { x: 100, y: 40, w: 120, h: 146 })).toBe(false)
  expect(rectFullyShownInFit(content, stage, 960, { x: 700, y: 40, w: 120, h: 146 })).toBe(true)
  // 舞台尺寸未知(0)时不算看得到
  expect(rectFullyShownInFit(content, { w: 0, h: 0 }, 960, { x: 700, y: 40, w: 120, h: 146 })).toBe(
    false,
  )
  // 不加宽时整个场景都在舞台内
  expect(
    rectFullyShownInFit({ w: 960, h: 1292 }, { w: 960, h: 1292 }, 960, {
      x: 0,
      y: 0,
      w: 960,
      h: 1292,
    }),
  ).toBe(true)
})

// 6 × 4 加宽场景:2298 × 1292,安全区宽 960,核心 y 16 起、高 1138
describe('fit with a core', () => {
  const content = { w: 2298, h: 1292 },
    core = { y: 16, h: 1138 }
  const shown = (v: { s: number; x: number; y: number }, stage: { w: number; h: number }) => ({
    coreTop: v.y + core.y * v.s,
    coreBottom: v.y + (core.y + core.h) * v.s,
    cover: (Math.min(stage.w, v.x + content.w * v.s) - Math.max(0, v.x)) / stage.w,
  })

  it('is identical to the old fit without a core, and when the height fit already fills the width', () => {
    for (const stage of [
      { w: 992, h: 618 },
      { w: 744, h: 882 },
      { w: 351, h: 626 },
      { w: 800, h: 600 },
    ]) {
      // stage.w / W ≤ stage.h / H:今天已经横向铺满,比例与位置逐值不变
      expect(stage.w / content.w).toBeLessThanOrEqual(stage.h / content.h)
      expect(fitView(content, stage, 960, core)).toEqual(fitView(content, stage, 960))
    }
    expect(fitView(content, { w: 1888, h: 930 }, 960, undefined)).toEqual(
      fitView(content, { w: 1888, h: 930 }, 960),
    )
  })

  it('keeps the 1024 × 768 core at exactly the old, height-bound size', () => {
    const v = fitView(content, { w: 992, h: 618 }, 960, core)
    expect(v.s).toBe(618 / 1292)
  })

  it('grows a wide short stage until the core just fits, filling ≥ 90% of the width', () => {
    const stage = { w: 1888, h: 930 }
    const old = fitView(content, stage, 960),
      v = fitView(content, stage, 960, core)
    expect(old.s).toBe(930 / 1292)
    expect(v.s).toBe(930 / 1138)
    expect(v.s).toBeGreaterThan(old.s)
    const z = shown(v, stage)
    expect(z.cover).toBeGreaterThanOrEqual(0.99)
    expect(z.coreTop).toBeGreaterThanOrEqual(-1e-9)
    expect(z.coreBottom).toBeLessThanOrEqual(stage.h + 1e-9)
    expect(v.x).toBeCloseTo((stage.w - content.w * v.s) / 2)
  })

  it('stops at filling the width and slides vertically so the core stays whole', () => {
    // 宽度先铺满(stage.w / W < stage.h / core.h):比例 = stage.w / W;居中会裁到核心顶部,夹到核心顶贴舞台顶
    const stage = { w: 1888, h: 1000 }
    const v = fitView(content, stage, 960, core)
    expect(v.s).toBe(1888 / 2298)
    expect(v.x).toBeCloseTo(0)
    const centred = (stage.h - content.h * v.s) / 2
    expect(centred + core.y * v.s).toBeLessThan(0)
    expect(v.y).toBeCloseTo(-core.y * v.s)
    const z = shown(v, stage)
    expect(z.cover).toBeCloseTo(1)
    expect(z.coreBottom).toBeLessThanOrEqual(stage.h)
  })

  it('never exceeds the safe-width bound or the zoom range', () => {
    // 安全区宽度约束仍然生效:舞台比安全区还窄时按安全区宽适应
    const narrow = fitView(content, { w: 600, h: 2000 }, 960, core)
    expect(narrow.s).toBe(600 / 960)
    expect(fitView({ w: 100, h: 100 }, { w: 1000, h: 1000 }, 100, { y: 0, h: 50 }).s).toBe(1.25)
  })

  it('judges board visibility with the same fit', () => {
    const stage = { w: 1888, h: 930 },
      board = { x: 481, y: 38, w: 192, h: 146 }
    expect(rectFullyShownInFit(content, stage, 960, board, core)).toBe(true)
    // 舞台很矮、核心放不下(比例被夹到下限)时也不出错:核心居中
    const tiny = fitView(content, { w: 1888, h: 50 }, 960, core)
    expect(tiny.s).toBe(0.1)
    expect(tiny.y + (core.y + core.h / 2) * tiny.s).toBeCloseTo(25)
  })
})
