import { expect, test, type Page } from '@playwright/test'

interface Box { x: number; y: number; width: number; height: number }

async function signIn(page: Page, name = 'teacher01') {
  await page.goto('/login')
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill('dev123')
  await page.getByRole('button', { name: /登录/ }).click()
  await expect(page.getByRole('heading', { name: '三年二班' })).toBeVisible()
}

async function switchMode(page: Page, name: string) {
  const tab = page.getByRole('tab', { name })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}

const inside = (a: Box, b: Box) =>
  a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

// 地图的位置变换:适应时是固定值,放大后随缩放 / 平移变化
const canvasTransform = (page: Page) => page.locator('.cr-canvas').getAttribute('style')

// 等地图排好版:座位都画出来、变换已写入
async function mapReady(page: Page) {
  await expect(page.locator('[data-seat]').first()).toBeVisible()
  await expect.poll(() => canvasTransform(page)).toContain('translate(')
}

const stageBox = async (page: Page) => (await page.getByTestId('classroom-stage').boundingBox())!

for (const [w, h] of [[1920, 1080], [1280, 720], [1024, 768], [768, 1024]]) {
  test(`core stays whole at ${w}×${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await signIn(page)
    await mapReady(page)
    // 窗口缩放后舞台会重新适应,用重试断言等它稳定
    await expect(async () => {
      const stage = await stageBox(page)
      expect(inside((await page.locator('.cr-front-wall').boundingBox())!, stage), '讲台墙在舞台内').toBe(true)
      const seats = await page.locator('[data-seat]').all()
      expect(seats).toHaveLength(24)
      for (const seat of seats) expect(inside((await seat.boundingBox())!, stage), '座位在舞台内').toBe(true)
    }).toPass()
  })
}

test('16:9 fills the stage with the wings', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await signIn(page)
  await mapReady(page)
  await expect(async () => {
    const stage = await stageBox(page)
    const svg = (await page.locator('.cr-canvas > svg').boundingBox())!
    const visibleWidth = Math.min(svg.x + svg.width, stage.x + stage.width) - Math.max(svg.x, stage.x)
    expect(visibleWidth, '地图在舞台内的可见宽度').toBeGreaterThanOrEqual(stage.width * 0.9)
    const wing = (await page.locator('[data-wing="left"]').boundingBox())!
    expect(intersects(wing, stage), '左侧窗户与舞台相交').toBe(true)
  }).toPass()
})

test('the map cannot be dragged at fit and never leaves the stage after zooming', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await signIn(page)
  await mapReady(page)
  // 等适应稳定:间隔后再读一次,两次相同才算
  // (首次探测一定不通过,所以被接受的两次读数至少相隔一个重试间隔)
  let fitTransform: string | null = null
  await expect(async () => {
    const now = await canvasTransform(page)
    const same = now === fitTransform
    fitTransform = now
    expect(same).toBe(true)
  }).toPass({ intervals: [200, 300, 500] })
  const stage = await stageBox(page)
  // 前提:地图比舞台宽出一截,拖动才有可动的余地;否则"拖不动"的断言什么也证明不了
  const fitSvg = (await page.locator('.cr-canvas > svg').boundingBox())!
  expect(fitSvg.width, '地图比舞台宽出至少 20px,保证拖动锁定的断言有意义').toBeGreaterThan(stage.width + 20)

  const drag = async (dx: number, dy: number) => {
    // 舞台左上角空白处,避开右下角的缩放悬浮钮
    const sx = stage.x + 8
    const sy = stage.y + 8
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move(sx + dx / 2, sy + dy / 2, { steps: 5 })
    await page.mouse.move(sx + dx, sy + dy, { steps: 5 })
    await page.mouse.up()
  }

  await drag(300, 200)
  expect(await canvasTransform(page), '适应时拖不动').toBe(fitTransform)

  const zoomIn = page.getByRole('group', { name: '缩放' }).getByRole('button', { name: '放大' })
  for (let i = 0; i < 3; i++) await zoomIn.click()
  await expect.poll(() => canvasTransform(page)).not.toBe(fitTransform)
  await expect(page.locator('.cr-stage')).toHaveAttribute('data-pan', '')

  await drag(3000, 3000)
  await expect(async () => {
    const svg = (await page.locator('.cr-canvas > svg').boundingBox())!
    const s = await stageBox(page)
    expect(inside(s, svg), '拖到尽头后地图仍包住舞台').toBe(true)
  }).toPass()

  await page.getByRole('group', { name: '缩放' }).getByRole('button', { name: '适应' }).click()
  await expect.poll(() => canvasTransform(page)).toBe(fitTransform)
})

test('seat size popover applies a typed value when clicking the stage', async ({ page }) => {
  await signIn(page)
  await switchMode(page, '排座')
  await expect(page.getByRole('button', { name: '随机打乱' })).toBeEnabled()
  await page.getByRole('button', { name: /6 排 × 4 列/ }).click()
  const dialog = page.getByRole('dialog', { name: '座位行列' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('spinbutton', { name: '排数' })).toBeFocused()
  await dialog.getByRole('spinbutton', { name: '排数' }).fill('7')
  const stage = await stageBox(page)
  await page.mouse.click(stage.x + 8, stage.y + 8)
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: /7 排 × 4 列/ })).toBeVisible()
  // 只改了草稿,不保存:放弃修改
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '放弃修改' }).click()
  await expect(page.getByRole('button', { name: /6 排 × 4 列/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存座位' })).toBeDisabled()
})

test('account menu works from the keyboard', async ({ page }) => {
  await signIn(page)
  const trigger = page.getByRole('button', { name: '账号菜单' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: '我的偏好' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: '退出登录' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem', { name: '退出登录' })).toBeHidden()
  await expect(trigger).toBeFocused()
})

// 操作台:≥ 1024 宽所有模式、概况栏开 / 关都是一行;窄屏允许换行但页面不滚动
const DOCK_MODES = ['日常', '考勤', '点评', '排座']
for (const [w, h] of [[1024, 768], [1280, 720], [1920, 1080]]) {
  for (const rail of [true, false]) {
    test(`dock fits on one row at ${w}×${h} with the rail ${rail ? 'open' : 'closed'}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await signIn(page)
      await mapReady(page)
      const railButton = page.getByRole('button', { name: '概况栏' })
      if ((await railButton.getAttribute('aria-pressed') === 'true') !== rail) await railButton.click()
      for (const mode of DOCK_MODES) {
        await switchMode(page, mode)
        await expect(async () => {
          const items = await page.getByRole('toolbar', { name: '教室工具' }).locator('button, [role="tab"]').all()
          const tops: number[] = []
          for (const it of items) {
            const box = await it.boundingBox()
            if (box) tops.push(box.y)
          }
          expect(tops.length).toBeGreaterThan(4)
          const groups = tops.sort((a, b) => a - b).reduce<number[]>((g, t) => (g.length && t - g[g.length - 1] <= 10 ? g : [...g, t]), [])
          expect(groups, `${mode} 的按钮行数(top 分组 ${tops.join(',')})`).toHaveLength(1)
        }).toPass()
      }
    })
  }
}

for (const [w, h] of [[768, 1024], [375, 812]]) {
  test(`dock wraps without scrolling the page at ${w}×${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await signIn(page)
    for (const mode of DOCK_MODES) {
      await switchMode(page, mode)
      await expect(async () => {
        const s = await page.evaluate(() => {
          const e = document.documentElement
          return { x: e.scrollWidth - e.clientWidth, y: e.scrollHeight - e.clientHeight }
        })
        expect(s, `${mode} 页面滚动溢出`).toEqual({ x: 0, y: 0 })
      }).toPass()
    }
  })
}
