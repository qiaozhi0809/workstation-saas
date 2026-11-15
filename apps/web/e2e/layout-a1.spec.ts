/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'
import { applyTheme, expectBaselineLayout, patchJson, signInAs } from './helpers/layout'

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
      await expect(page.getByText('年级与班级', { exact: true })).toBeVisible()
      await expect(page.locator('a[href^="/admin/org/classes/"]').first()).toBeVisible()
      // 学年卡加载完才会有日期框;否则量到的是加载态
      await expect(page.locator('input[type="date"]')).toHaveCount(3)
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
      // 最后几张卡都加载完再量
      await expect(page.getByRole('button', { name: '保存安全设置' })).toBeVisible()
      await expect(page.getByRole('button', { name: '保存开关' })).toBeVisible()
    },
  },
  {
    slug: 'timetable',
    open: async (page) => {
      // 种子库没有作息节次时课表格不渲染(只有空状态):只在 GET 响应为空时补两节虚构的节次,不写任何数据
      await patchJson(page, /\/api\/v1\/periods(\?|$)/, (json) => {
        if (Array.isArray(json) && json.length === 0) {
          json.push(
            { no: 1, starts_at: '08:00', ends_at: '08:40' },
            { no: 2, starts_at: '08:50', ends_at: '09:30' },
          )
        }
      })
      await page.goto('/admin/timetable')
      await expect(page.getByRole('heading', { level: 1, name: '作息与课表' })).toBeVisible()
      await expect(page.getByTestId('timetable-grid')).toBeVisible()
    },
  },
  {
    slug: 'upgrade',
    open: async (page) => {
      await page.goto('/admin/upgrade')
      await expect(page.getByRole('heading', { level: 1, name: '学年升级' })).toBeVisible()
      await expect(page.getByRole('button', { name: '生成建议' })).toBeVisible()
      await expect(page.getByText('最近一次升级')).toBeVisible()
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
  // 1280 宽侧栏默认展开:先确认确实是展开态,再量
  await expect(page.locator('aside[data-collapsed="false"]')).toBeVisible()
  const dates = page.locator('input[type="date"]')
  await expect(dates).toHaveCount(3)
  const boxes = await dates.evaluateAll((els) =>
    els.map((el) => {
      const { x, y, width, height } = el.getBoundingClientRect()
      return { x, y, width, height, clipped: el.scrollWidth > el.clientWidth }
    }),
  )
  for (const [i, box] of boxes.entries()) {
    expect(box.width, `日期框 ${i} 宽度`).toBeGreaterThanOrEqual(160)
    expect(box.clipped, `日期框 ${i} 内容被截断`).toBe(false)
  }
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

// 窄页:标题仍对齐 default 的左缘,正文块最宽 768(max-w-3xl,见 ui/page.tsx)
for (const path of ['/admin/settings', '/admin/upgrade']) {
  test(`narrow page body is capped at 768 on ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await signInAs(page, 'admin')
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const widths = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-page-container][data-width="narrow"] > :not([data-page-header])',
        ),
      ).map((el) => el.getBoundingClientRect().width),
    )
    expect(widths.length).toBeGreaterThan(0)
    for (const w of widths) expect(w).toBeLessThanOrEqual(768.5)
  })
}
