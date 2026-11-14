/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { expectBaselineLayout, useTheme } from './helpers/layout'

test('ui gallery meets the baseline in light and dark', async ({ page }) => {
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme)
    await page.goto('/dev/ui')
    await expect(page.getByRole('heading', { level: 1, name: '界面件陈列' })).toBeVisible()
    if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
    await expectBaselineLayout(page, { checkTitleX: true })
  }
})

test('caller className wins over arc styles', async ({ page }) => {
  await page.goto('/dev/ui')
  const color = (id: string) => page.getByTestId(id).evaluate((el) => getComputedStyle(el).color)
  const height = (id: string) =>
    page.getByTestId(id).evaluate((el) => el.getBoundingClientRect().height)

  const override = await color('btn-override-color')
  expect(override).not.toBe(await color('btn-ghost-plain'))
  expect(override).toBe(await color('destructive-ref'))
  expect(await height('btn-override-minh')).toBeGreaterThanOrEqual(44)
  expect(await height('btn-override-h')).toBeGreaterThanOrEqual(44)
})
