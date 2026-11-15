import { expect, test, type Page } from '@playwright/test'

// 只读:登录、折叠 / 展开侧栏、进出全屏,不写任何共享数据。
// 侧栏状态存在浏览器 localStorage,每个用例都是全新上下文,互不影响。

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function signIn(page: Page, name: string, landing: RegExp) {
  await page.goto('/login')
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill('dev123')
  await page.getByRole('button', { name: /登录/ }).click()
  await expect(page).toHaveURL(landing)
}

async function signInTeacher(page: Page) {
  await signIn(page, 'teacher01', /\/teacher\/classroom/)
  await expect(page.getByRole('heading', { name: '三年二班' })).toBeVisible()
}

const inside = (a: Box, b: Box) =>
  a.x >= b.x - 1 &&
  a.y >= b.y - 1 &&
  a.x + a.width <= b.x + b.width + 1 &&
  a.y + a.height <= b.y + b.height + 1

// 成绩页、看板里也有 <aside>,只认带名字的侧栏
const aside = (page: Page) => page.getByRole('complementary', { name: '侧栏' })
const asideWidth = async (page: Page) => (await aside(page).boundingBox())!.width
const canvasTransform = (page: Page) => page.locator('.cr-canvas').getAttribute('style')

async function mapReady(page: Page) {
  await expect(page.locator('[data-seat]').first()).toBeVisible()
  await expect.poll(() => canvasTransform(page)).toContain('translate(')
}

async function seatsInsideStage(page: Page) {
  await expect(async () => {
    const stage = (await page.getByTestId('classroom-stage').boundingBox())!
    const seats = await page.locator('[data-seat]').all()
    expect(seats).toHaveLength(24)
    for (const seat of seats)
      expect(inside((await seat.boundingBox())!, stage), '座位在舞台内').toBe(true)
  }).toPass()
}

test('collapse persists across reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, 'principal01', /\/admin\/today/)
  await expect.poll(() => asideWidth(page)).toBeCloseTo(264, 0)
  await page.getByRole('button', { name: '折叠侧栏' }).click()
  await expect.poll(() => asideWidth(page)).toBeCloseTo(72, 0)
  await page.reload()
  await expect(page.getByRole('button', { name: '展开侧栏' })).toBeVisible()
  expect(await asideWidth(page)).toBeCloseTo(72, 0)
  expect(await page.evaluate(() => localStorage.getItem('ws-sidebar'))).toBe('1')
})

test('[ toggles the sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, 'principal01', /\/admin\/today/)
  await expect.poll(() => asideWidth(page)).toBeCloseTo(264, 0)
  await page.keyboard.press('[')
  await expect.poll(() => asideWidth(page)).toBeCloseTo(72, 0)
  await page.keyboard.press('[')
  await expect.poll(() => asideWidth(page)).toBeCloseTo(264, 0)
})

// G-X-1:rail 只有 72 宽,账号菜单和通知面板必须在侧栏右边整块展开,不被侧栏或祖先裁掉
for (const [name, trigger, layer] of [
  ['account menu', { name: '账号菜单' }, { role: 'menu', name: '账号菜单' }],
  ['notice panel', { name: /^通知/ }, { role: 'dialog', name: '通知' }],
] as const) {
  test(`rail ${name} opens to the right and stays inside the viewport`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, 'principal01', /\/admin\/today/)
    await page.getByRole('button', { name: '折叠侧栏' }).click()
    await expect.poll(() => asideWidth(page)).toBeCloseTo(72, 0)
    await aside(page).getByRole('button', trigger).click()
    const box = page.getByRole(layer.role, { name: layer.name })
    await expect(box).toBeVisible()
    const side = (await aside(page).boundingBox())!
    const b = (await box.boundingBox())!
    const vp = page.viewportSize()!
    expect(b.x, '在侧栏右边').toBeGreaterThanOrEqual(side.x + side.width + 4)
    expect(b.y).toBeGreaterThanOrEqual(0)
    expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 1)
    expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1)
    // 没被裁:四条边的中点和中心点(各向内缩 2px,避开 16px 圆角)真的命中浮层自己,
    // 而不是被祖先裁掉后露出下面的页面
    const hit = await box.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      return [
        [cx, r.top + 2],
        [cx, r.bottom - 2],
        [r.left + 2, cy],
        [r.right - 2, cy],
        [cx, cy],
      ].every(([x, y]) => el.contains(document.elementFromPoint(x, y)))
    })
    expect(hit).toBe(true)
  })
}

test('admin nav scrolls fully above the footer buttons at 1280×800', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signIn(page, 'principal01', /\/admin\/today/)
  const nav = aside(page).getByRole('navigation', { name: '主导航' })
  const last = nav.getByRole('link').last()
  // 滚到底:最后一项的底边在导航区底边上方,至少留出 pb-4 的 16px 内边距
  await nav.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(async () => {
    const n = (await nav.boundingBox())!
    const l = (await last.boundingBox())!
    expect(l.y).toBeGreaterThanOrEqual(n.y - 1)
    expect(l.y + l.height).toBeLessThanOrEqual(n.y + n.height - 16 + 1)
  }).toPass()
  // 最后一项与底部按钮区(折叠按钮、通知 / 主题 / 账号)的盒子不相交
  const l = (await last.boundingBox())!
  const toggle = (await aside(page).getByRole('button', { name: '折叠侧栏' }).boundingBox())!
  const account = (await aside(page).getByRole('button', { name: '账号菜单' }).boundingBox())!
  for (const b of [toggle, account])
    expect(l.y + l.height, '不与底部按钮区相交').toBeLessThanOrEqual(b.y + 1)
})

test('classroom defaults to rail', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signInTeacher(page)
  await mapReady(page)
  expect(await asideWidth(page)).toBeCloseTo(72, 0)
  expect(await page.evaluate(() => localStorage.getItem('ws-sidebar:classroom'))).toBeNull()
})

test('rail toggle keeps seats inside the stage', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signInTeacher(page)
  await mapReady(page)
  await seatsInsideStage(page)
  const railTransform = await canvasTransform(page)

  await page.keyboard.press('[')
  await expect.poll(() => asideWidth(page)).toBeCloseTo(264, 0)
  await expect.poll(() => canvasTransform(page)).not.toBe(railTransform)
  await seatsInsideStage(page)

  await page.keyboard.press('[')
  await expect.poll(() => asideWidth(page)).toBeCloseTo(72, 0)
  await seatsInsideStage(page)
})

test('fullscreen round trip keeps sidebar state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signInTeacher(page)
  await mapReady(page)
  const width = await asideWidth(page)
  const stage = (await page.getByTestId('classroom-stage').boundingBox())!

  await page.getByRole('button', { name: '全屏' }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  // 全屏时按 [ 不折叠侧栏
  await page.keyboard.press('[')
  await page.getByRole('button', { name: '退出全屏' }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false)

  await expect.poll(() => asideWidth(page)).toBeCloseTo(width, 0)
  await expect(async () => {
    const back = (await page.getByTestId('classroom-stage').boundingBox())!
    expect(back.width).toBeCloseTo(stage.width, 0)
    expect(back.height).toBeCloseTo(stage.height, 0)
  }).toPass()
})

test('rail has no vertical scrollbar at 1280×400', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 })
  await signInTeacher(page)
  const side = aside(page)
  await expect(side).toBeVisible()
  const overflow = await side.evaluate((el) => el.scrollHeight - el.clientHeight)
  expect(overflow).toBeLessThanOrEqual(0)
  const account = page.getByRole('button', { name: '账号菜单' })
  await expect(account).toBeVisible()
  const sideBox = (await side.boundingBox())!
  expect(inside((await account.boundingBox())!, sideBox), '账号按钮在侧栏内').toBe(true)
})

test('drawer below 1024', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await signIn(page, 'principal01', /\/admin\/today/)
  await expect(aside(page)).toHaveCount(0)
  await page.getByRole('button', { name: '打开菜单' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('navigation', { name: '主导航' })).toBeVisible()
  await dialog.getByRole('link', { name: '全校看板' }).click()
  await expect(page).toHaveURL(/\/admin\/board/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('drawer keeps the footer inside the viewport at 768×1024', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await signIn(page, 'principal01', /\/admin\/today/)
  await page.getByRole('button', { name: '打开菜单' }).click()
  const dialog = page.getByRole('dialog')
  const account = dialog.getByRole('button', { name: '账号菜单' })
  await expect(account).toBeVisible()
  const box = (await account.boundingBox())!
  expect(box.y + box.height, '账号菜单按钮底边在视口内').toBeLessThanOrEqual(1024)
  expect(box.y).toBeGreaterThanOrEqual(0)
})

test('classroom is a drawer below 1280 so the stage keeps the full width', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await signInTeacher(page)
  await mapReady(page)
  await expect(aside(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '打开菜单' })).toBeVisible()
  // 顶部条里还看得到班名
  await expect(page.getByText(/三年二班/).first()).toBeVisible()
})
