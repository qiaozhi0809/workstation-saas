/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'
import { applyTheme, expectBaselineLayout, patchJson, signInAs } from './helpers/layout'

// 只读:只登录与打开页面;/api/v1 下除 auth/ 之外的非 GET 请求一律中止
const guardReadOnly = (page: Page) =>
  page.route(/\/api\/v1\/(?!auth\/)/, (route) =>
    route.request().method() === 'GET' ? route.fallback() : route.abort(),
  )

const VIEWS = [
  { width: 1280, height: 800, theme: 'light', checkTitleX: true },
  { width: 1920, height: 1080, theme: 'light', checkTitleX: true },
  { width: 1280, height: 800, theme: 'dark', checkTitleX: false },
  { width: 375, height: 812, theme: 'light', checkTitleX: false },
] as const

/** 页面标题出现、没有加载中、网络空闲 */
async function settle(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /加载中/ })).toHaveCount(0)
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
}

const STATIC_PAGES = [
  { name: '今日关注', path: '/admin/today' },
  { name: '全校看板', path: '/admin/board' },
  { name: '成绩汇总', path: '/admin/reports/scores' },
  { name: '月度考勤报告', path: '/admin/reports/attendance' },
  { name: '年级联考', path: '/admin/grade-exams' },
  { name: '往年班级', path: '/admin/history' },
  { name: '通知', path: '/admin/notices' },
] as const

for (const view of VIEWS) {
  test.describe(`${view.width}x${view.height} ${view.theme}`, () => {
    test.use({ viewport: { width: view.width, height: view.height } })

    for (const p of STATIC_PAGES) {
      test(`${p.name} meets the baseline`, async ({ page }) => {
        await guardReadOnly(page)
        await applyTheme(page, view.theme)
        await signInAs(page, 'admin')
        await page.goto(p.path)
        await settle(page)
        await expectBaselineLayout(page, { checkTitleX: view.checkTitleX })
      })
    }

    test('班级视图 meets the baseline', async ({ page }) => {
      await guardReadOnly(page)
      await applyTheme(page, view.theme)
      await signInAs(page, 'admin')
      await page.goto('/admin/board')
      await settle(page)
      const href = await page.locator('[data-class-card] a').first().getAttribute('href')
      expect(href).toMatch(/^\/admin\/classes\//)
      await page.goto(href!)
      await settle(page)
      await expectBaselineLayout(page, { checkTitleX: view.checkTitleX })
    })

    test('往年单班 meets the baseline', async ({ page }) => {
      await guardReadOnly(page)
      await applyTheme(page, view.theme)
      await signInAs(page, 'admin')
      await page.goto('/admin/history')
      await settle(page)
      const link = page.locator('a[href^="/admin/history/classes/"]').first()
      // 种子里没有往年数据时没有入口,这一页无从量起
      test.skip((await link.count()) === 0, '没有往年班级入口')
      const href = await link.getAttribute('href')
      await page.goto(href!)
      await settle(page)
      await expectBaselineLayout(page, { checkTitleX: view.checkTitleX })
    })
  })
}

test('board class cards keep teacher names at 1280', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await guardReadOnly(page)
  // 班主任名改成 6 个字;班级不足 6 个就复制补齐,保证排满两行
  await patchJson(page, /\/api\/v1\/admin\/board(\?|$)/, (json) => {
    const classes = json.classes as { id: string; name: string; homeroom_name: string | null }[]
    const base = classes[0]
    for (let i = classes.length; i < 6; i++) {
      classes.push({ ...base, id: `${base.id}-copy${i}`, name: `${base.name}${i}` })
    }
    for (const c of classes) c.homeroom_name = '欧阳慕容老'
  })
  await signInAs(page, 'admin')
  await page.goto('/admin/board')
  await settle(page)

  const cards = page.locator('[data-class-card]')
  await expect(cards.first()).toBeVisible()
  const xs = await cards.evaluateAll((els) =>
    Array.from(new Set(els.map((el) => Math.round(el.getBoundingClientRect().x)))),
  )
  expect(xs, '1280 宽带监控侧栏时班级卡排 3 列').toHaveLength(3)

  const names = page.locator('[data-class-card] [data-homeroom]')
  expect(await names.count()).toBeGreaterThan(0)
  const clipped = await names.evaluateAll((els) =>
    els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent),
  )
  expect(clipped, '班主任名不被截断').toEqual([])
})
