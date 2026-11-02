import { expect, test, type Page } from '@playwright/test'

interface Box { x: number; y: number; width: number; height: number }

async function signIn(page: Page, name = 'teacher01') {
  await page.goto('/login')
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill('dev123')
  await page.getByRole('button', { name: /登录/ }).click()
  await expect(page.getByRole('heading', { name: '三年二班' })).toBeVisible()
}

const inside = (a: Box, b: Box) =>
  a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1

// 矮窗口(≥ 400px 高):教室页本身不整页滚动,舞台随之变矮,核心(讲台墙 + 全部座位)仍完整可见
const MODES = ['日常', '考勤', '点评', '排座']
for (const [w, h] of [[1280, 520], [1280, 480], [1024, 500], [1280, 400], [1024, 400]]) {
  test(`classroom does not scroll the page at ${w}×${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await signIn(page)
    for (const mode of MODES) {
      const tab = page.getByRole('tab', { name: mode })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('[data-seat]').first()).toBeVisible()
      if (mode === '排座') await expect(page.getByRole('button', { name: '随机打乱' })).toBeEnabled()
      await expect(async () => {
        const s = await page.evaluate(() => {
          const e = document.documentElement
          const m = document.getElementById('main')!
          return { html: e.scrollHeight - e.clientHeight, main: m.scrollHeight - m.clientHeight }
        })
        expect(s, `${mode} 页面滚动溢出`).toEqual({ html: 0, main: 0 })
        const stage = (await page.getByTestId('classroom-stage').boundingBox())!
        expect(inside((await page.locator('.cr-front-wall').boundingBox())!, stage), `${mode} 讲台墙在舞台内`).toBe(true)
        const seats = await page.locator('[data-seat]').all()
        expect(seats).toHaveLength(24)
        for (const seat of seats) expect(inside((await seat.boundingBox())!, stage), `${mode} 座位在舞台内`).toBe(true)
        const dock = (await page.getByRole('toolbar', { name: '教室工具' }).boundingBox())!
        expect(dock.y + dock.height, `${mode} 操作台在窗口内`).toBeLessThanOrEqual(h + 1)
      }).toPass()
    }
  })
}

// 排座托盘里有多位待安排同学时(托盘最高 96px),400px 高的窗口仍不整页滚动
test('seating with a full tray does not scroll the page at 1280×400', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 })
  await signIn(page)
  const tab = page.getByRole('tab', { name: '排座' })
  await tab.click()
  await expect(page.getByRole('button', { name: '随机打乱' })).toBeEnabled()
  for (let i = 0; i < 8; i++) {
    await page.locator('[data-seat]').nth(i).click()
    await page.getByRole('button', { name: '移到待安排' }).click()
  }
  await expect(page.getByRole('region', { name: /待安排 \(8\)/ })).toBeVisible()
  await expect(async () => {
    const s = await page.evaluate(() => {
      const e = document.documentElement
      const m = document.getElementById('main')!
      return { html: e.scrollHeight - e.clientHeight, main: m.scrollHeight - m.clientHeight }
    })
    expect(s, '页面滚动溢出').toEqual({ html: 0, main: 0 })
  }).toPass()
})
