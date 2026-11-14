/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page, name: string, password = 'dev123') {
  await page.goto('/login')
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: /登录/ }).click()
}

test('arc button and badge follow the baseline', async ({ page }) => {
  await page.goto('/dev/ui')
  const md = page.getByTestId('arc-button-md')
  const sm = page.getByTestId('arc-button-sm')
  await expect(md).toBeVisible()
  expect((await md.boundingBox())?.height).toBe(40)
  expect((await sm.boundingBox())?.height).toBe(32)
  expect(await md.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('12px')
  expect(await sm.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('12px')
})

test('dark mode reaches arc components', async ({ page }) => {
  // 把计算出的背景色(Chromium 可能序列化成 oklch)经 1x1 canvas 转成 sRGB,再算相对亮度
  const luminanceOf = (testId: string) =>
    page.getByTestId(testId).evaluate((el) => {
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.fillStyle = getComputedStyle(el).backgroundColor
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data).map((v) => v / 255)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    })

  await page.goto('/dev/ui')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark')
  const light = await luminanceOf('arc-button-secondary-md')

  await page.evaluate(() => localStorage.setItem('ws-theme', 'dark'))
  await page.reload()
  const html = page.locator('html')
  await expect(html).toHaveClass(/dark/)
  await expect(html).toHaveAttribute('data-theme', 'dark')
  const dark = await luminanceOf('arc-button-secondary-md')

  expect(light).toBeGreaterThan(0.5)
  expect(dark).toBeLessThan(0.5)
  expect(dark).not.toBe(light)
  await page.evaluate(() => localStorage.removeItem('ws-theme'))
})

test('dark card on /dev/ui is visible', async ({ page }) => {
  const luminanceOf = (selector: string) =>
    page.locator(selector).first().evaluate((el) => {
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.fillStyle = getComputedStyle(el).backgroundColor
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data).map((v) => v / 255)
      const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    })

  await page.goto('/dev/ui')
  await page.evaluate(() => localStorage.setItem('ws-theme', 'dark'))
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  // UiGallery 归 C 段,没有 card-sample 钩子;用 Card 的 data-slot 定位陈列页里的卡片
  await expect(page.locator('[data-slot="card"]').first()).toBeVisible()
  const card = await luminanceOf('[data-slot="card"]')
  const body = await luminanceOf('body')
  const [hi, lo] = [card, body].sort((a, b) => b - a)
  expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(1.15)
  await page.evaluate(() => localStorage.removeItem('ws-theme'))
})

test('keyboard focus on admin nav menu items is visible', async ({ page }) => {
  await signIn(page, 'principal01')
  await expect(page).toHaveURL(/\/admin\/today/)
  const group = page.getByRole('navigation', { name: '主导航' }).getByRole('button', {
    name: '学校管理',
  })
  await group.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  const item = page.locator('[role=menuitem]:focus')
  await expect(item).toBeVisible()
  // Arc 的焦点规则对 menuitem 去掉了 outline,键盘位置靠 overlay/Menu 的 focus:bg-accent 填充显示
  const { bg, menuBg } = await item.evaluate((el) => ({
    bg: getComputedStyle(el).backgroundColor,
    menuBg: getComputedStyle(el.closest('[role=menu]')!).backgroundColor,
  }))
  expect(bg).not.toBe('rgba(0, 0, 0, 0)')
  expect(bg).not.toBe(menuBg)
})
