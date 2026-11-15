/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { applyTheme, expectBaselineLayout } from './helpers/layout'

// 只读:只打开 /login,不提交表单,不登录。

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
] as const

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of VIEWPORTS) {
    test(`login page meets the baseline at ${viewport.width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await applyTheme(page, theme)
      await page.goto('/login')
      await expect(page.getByRole('heading', { level: 1, name: '班级工作台' })).toBeVisible()
      if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
      await expectBaselineLayout(page)

      const card = page.locator('[data-slot=card]').first()
      const box = await card.boundingBox()
      expect(box).not.toBeNull()
      // 卡片:宽 384(max-w-sm),窄屏则是视口减左右各 16 的边距
      const expectedWidth = Math.min(384, viewport.width - 32)
      expect(Math.abs((box?.width ?? 0) - expectedWidth)).toBeLessThanOrEqual(1)
      // 垂直居中:上下空白相差 ≤ 2
      const top = box?.y ?? 0
      const bottom = viewport.height - top - (box?.height ?? 0)
      expect(Math.abs(top - bottom)).toBeLessThanOrEqual(2)
    })
  }
}

test('login page title is 20px medium weight', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/login')
  const style = await page
    .getByRole('heading', { level: 1, name: '班级工作台' })
    .evaluate((el) => ({
      size: getComputedStyle(el).fontSize,
      weight: getComputedStyle(el).fontWeight,
    }))
  expect(style.size).toBe('20px')
  expect(style.weight).toBe('500')
})
