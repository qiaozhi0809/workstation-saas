/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'
import { applyTheme, expectBaselineLayout, signInAs } from './helpers/layout'

/**
 * M6 段 A1:管理端 组织架构 / 班级信息 / 账号 / 学校设置 / 作息课表 / 学年升级 的布局基线。
 * 只读:/api/v1 下除 auth/ 外的非 GET 请求一律中止,只登录与打开页面。
 */

type Theme = 'light' | 'dark'
type Viewport = readonly [number, number]

const RUNS: ReadonlyArray<{ label: string; theme: Theme; viewport: Viewport; titleX: boolean }> = [
  { label: '1280 light', theme: 'light', viewport: [1280, 800], titleX: true },
  { label: '1920 light', theme: 'light', viewport: [1920, 1080], titleX: true },
  { label: '1280 dark', theme: 'dark', viewport: [1280, 800], titleX: false },
  { label: '375 light', theme: 'light', viewport: [375, 812], titleX: false },
]

interface PageSpec {
  slug: string
  /** 打开页面并等到主要内容出现 */
  open(page: Page): Promise<void>
}

const PAGES: PageSpec[] = [
  {
    slug: 'org',
    open: async (page) => {
      await page.goto('/admin/org')
      await expect(page.getByRole('heading', { level: 1, name: '组织架构' })).toBeVisible()
      await expect(page.getByRole('heading', { name: '年级与班级' })).toBeVisible()
      await expect(page.locator('a[href^="/admin/org/classes/"]').first()).toBeVisible()
    },
  },
  {
    slug: 'org-class',
    open: async (page) => {
      await page.goto('/admin/org')
      const first = page.locator('a[href^="/admin/org/classes/"]').first()
      await expect(first).toBeVisible()
      await first.click()
      await expect(page).toHaveURL(/\/admin\/org\/classes\//)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    },
  },
  {
    slug: 'accounts',
    open: async (page) => {
      await page.goto('/admin/accounts')
      await expect(page.getByRole('heading', { level: 1, name: '账号' })).toBeVisible()
      await expect(page.getByRole('table')).toBeVisible()
    },
  },
  {
    slug: 'settings',
    open: async (page) => {
      await page.goto('/admin/settings')
      await expect(page.getByRole('heading', { level: 1, name: '学校设置' })).toBeVisible()
      await expect(page.getByRole('list', { name: '标签池' })).toBeVisible()
    },
  },
  {
    slug: 'timetable',
    open: async (page) => {
      await page.goto('/admin/timetable')
      await expect(page.getByRole('heading', { level: 1, name: '作息与课表' })).toBeVisible()
    },
  },
  {
    slug: 'upgrade',
    open: async (page) => {
      await page.goto('/admin/upgrade')
      await expect(page.getByRole('heading', { level: 1, name: '学年升级' })).toBeVisible()
    },
  },
]

test.beforeEach(async ({ page }) => {
  // 只读护栏:登录 / 刷新 / 退出之外的写请求一律拦下
  await page.route(/\/api\/v1\/(?!auth\/)/, (route) =>
    route.request().method() === 'GET' ? route.continue() : route.abort(),
  )
})

for (const run of RUNS) {
  test.describe(`layout a1 · ${run.label}`, () => {
    test.use({ viewport: { width: run.viewport[0], height: run.viewport[1] } })

    for (const spec of PAGES) {
      test(`${spec.slug} meets the baseline`, async ({ page }) => {
        await applyTheme(page, run.theme)
        await signInAs(page, 'admin')
        await spec.open(page)
        if (run.theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
        await expectBaselineLayout(page, { checkTitleX: run.titleX })
      })
    }
  })
}

test('settings tag pool controls are at least 32px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signInAs(page, 'admin')
  await page.goto('/admin/settings')
  const pool = page.getByRole('list', { name: '标签池' })
  await expect(pool).toBeVisible()
  const buttons = pool.getByRole('button', { name: /^(上移|下移|删除) / })
  await expect(buttons.first()).toBeVisible()
  const sizes = await buttons.evaluateAll((els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect()
      return { label: el.getAttribute('aria-label'), w: rect.width, h: rect.height }
    }),
  )
  expect(sizes.length).toBeGreaterThan(0)
  for (const size of sizes) {
    expect(size.h, `${size.label} 高`).toBeGreaterThanOrEqual(32)
    expect(size.w, `${size.label} 宽`).toBeGreaterThanOrEqual(32)
  }
})

test('org year card date inputs do not overlap at 1280 with the sidebar open', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signInAs(page, 'admin')
  await page.goto('/admin/org')
  const dates = page.locator('input[type="date"]')
  await expect(dates).toHaveCount(3)
  // 侧栏展开(1280 宽默认展开):内容区变窄后三个日期框也不能互相压住
  const boxes = await dates.evaluateAll((els) =>
    els.map((el) => {
      const { x, y, width, height } = el.getBoundingClientRect()
      return { x, y, width, height }
    }),
  )
  for (const box of boxes) expect(box.width).toBeGreaterThan(0)
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      const overlapX = a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5
      const overlapY = a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5
      expect(overlapX && overlapY, `日期框 ${i} 与 ${j} 重叠`).toBe(false)
    }
  }
})
