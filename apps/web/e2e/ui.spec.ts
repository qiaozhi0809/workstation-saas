/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('登录名').fill('teacher01')
  await page.getByLabel('密码').fill('dev123')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('heading', { name: '三年二班' })).toBeVisible()
}

test('theme choice persists across reload without a flash', async ({ page }) => {
  await page.goto('/login')
  await page.evaluate(() => localStorage.removeItem('ws-theme'))
  await page.reload()
  const toggle = page.getByRole('button', { name: /^主题:/ })
  while (!(await toggle.getAttribute('aria-label'))?.endsWith('深色')) await toggle.click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.evaluate(() => localStorage.removeItem('ws-theme'))
})

test('skip link moves focus to main content', async ({ page }) => {
  await signIn(page)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: '跳到主要内容' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
})

test('keyboard focus is visible', async ({ page }) => {
  await page.goto('/login')
  await page.keyboard.press('Tab')
  const focused = page.locator(':focus')
  const ring = await focused.evaluate((el) => {
    const s = getComputedStyle(el)
    return s.outlineStyle !== 'none' || s.boxShadow !== 'none'
  })
  expect(ring).toBe(true)
})

for (const path of ['/login', '/teacher/classroom', '/teacher/preferences']) {
  test(`no horizontal scroll at 375px on ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    if (path !== '/login') await signIn(page)
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}

test('profile drawer traps focus and closes with Escape', async ({ page }) => {
  await signIn(page)
  await page.getByRole('button', { name: '王小一' }).click()
  const drawer = page.getByRole('dialog', { name: '王小一' })
  await expect(drawer).toBeVisible()
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
  expect(await drawer.evaluate((d) => d.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
})
