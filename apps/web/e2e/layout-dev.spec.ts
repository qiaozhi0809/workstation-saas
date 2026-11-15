/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { expectBaselineLayout, applyTheme } from './helpers/layout'

test('ui gallery meets the baseline in light and dark', async ({ page }) => {
  for (const theme of ['light', 'dark'] as const) {
    await applyTheme(page, theme)
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

test('narrow page body is capped at 768 and the title stays on the left edge', async ({ page }) => {
  await page.goto('/dev/ui')
  const h1 = await page.getByRole('heading', { level: 1 }).boundingBox()
  const title = await page.getByTestId('narrow-title').boundingBox()
  const body = await page.getByTestId('narrow-body').boundingBox()
  expect(h1 && title && body).toBeTruthy()
  expect(Math.abs(title!.x - h1!.x)).toBeLessThanOrEqual(1)
  expect(body!.width).toBeGreaterThan(0)
  expect(body!.width).toBeLessThanOrEqual(768)
})

test('hidden on an arc button wins over arc display', async ({ page }) => {
  await page.goto('/dev/ui')
  await expect(page.getByTestId('btn-override-hidden')).toBeHidden()
  await expect(page.getByTestId('btn-ghost-plain')).toBeVisible()
})

test('arc buttons keep their own surface', async ({ page }) => {
  await page.goto('/dev/ui')
  const primary = page.getByTestId('arc-button-md')
  const styles = await primary.evaluate((el) => {
    const s = getComputedStyle(el)
    return {
      background: s.backgroundColor,
      paddingLeft: parseFloat(s.paddingLeft),
      height: el.getBoundingClientRect().height,
    }
  })
  expect(styles.background).not.toBe('rgba(0, 0, 0, 0)')
  expect(styles.paddingLeft).toBeGreaterThan(0)
  expect(styles.height).toBe(40)
  const border = await page
    .getByTestId('arc-button-secondary-md')
    .evaluate((el) => getComputedStyle(el).borderTopWidth)
  expect(border).toBe('1px')
})

test('baseline counts the page h1 while a dialog or sheet is open', async ({ page }) => {
  for (const scene of ['dialog', 'sheet']) {
    await page.goto(`/dev/ui?scene=${scene}`)
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true')
    await expectBaselineLayout(page, { checkTitleX: true })
  }
})

test('full-width page title sits at main left plus padding', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto('/dev/ui?scene=full')
  await expect(page.locator('[data-page-container]')).toHaveAttribute('data-width', 'full')
  const main = await page.locator('main').first().boundingBox()
  const h1 = await page.locator('h1').boundingBox()
  expect(main && h1).toBeTruthy()
  expect(Math.abs(h1!.x - (main!.x + 32))).toBeLessThanOrEqual(1)
  await expectBaselineLayout(page, { checkTitleX: true })
})

test('dark table-only page has a table container to measure', async ({ page }) => {
  await applyTheme(page, 'dark')
  await page.goto('/dev/ui?scene=full')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.locator('[data-slot=card]')).toHaveCount(0)
  await expect(page.locator('[data-slot=table-container]')).toHaveCount(1)
  await expectBaselineLayout(page)
})

test('dark baseline skips transparent table containers inside a card', async ({ page }) => {
  await applyTheme(page, 'dark')
  await page.goto('/dev/ui?scene=card-table')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.locator('[data-slot=card]')).toHaveCount(1)
  const bg = await page
    .locator('[data-slot=table-container]')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg).toMatch(/^(transparent|rgba\(0, 0, 0, 0\)|rgb\(0 0 0 \/ 0\))$/)
  await expectBaselineLayout(page)
})

test('segmented tabs: pill container 40 with 32 tabs, underline tabs 32', async ({ page }) => {
  await page.goto('/dev/ui')
  const sample = page.getByTestId('tabs-sample')
  const pill = sample.getByRole('tablist', { name: '胶囊页签' })
  await expect(pill).toBeVisible()
  expect((await pill.boundingBox())!.height).toBeCloseTo(40, 0)
  for (const tab of await pill.getByRole('tab').all())
    expect((await tab.boundingBox())!.height).toBeCloseTo(32, 0)
  const underline = sample.getByRole('tablist', { name: '下划线页签' })
  for (const tab of await underline.getByRole('tab').all())
    expect((await tab.boundingBox())!.height).toBeCloseTo(32, 0)
})
