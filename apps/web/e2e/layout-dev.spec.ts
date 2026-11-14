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
