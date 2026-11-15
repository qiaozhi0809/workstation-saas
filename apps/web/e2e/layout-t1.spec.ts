/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'
import { applyTheme, expectBaselineLayout, patchJson, signInAs } from './helpers/layout'

/**
 * M6 T1:教师端非教室页的布局基线。只读:/api/v1 下除 auth/ 外的非 GET 请求一律中止。
 * 第一次推送时红的,作为基准;T1 做完变绿。
 */

const PAGES = [
  {
    slug: 'scores',
    path: '/teacher/scores',
    title: '成绩录入',
    ready: (page: Page) => page.getByRole('region', { name: '当前考试' }),
  },
  {
    slug: 'analysis',
    path: '/teacher/analysis',
    title: '成绩分析',
    ready: (page: Page) => page.locator('[data-kpi]').first(),
  },
  {
    slug: 'students',
    path: '/teacher/students',
    title: '学生',
    ready: (page: Page) => page.getByLabel('搜索学生'),
  },
  {
    slug: 'ai',
    path: '/teacher/ai',
    title: 'AI 助手',
    ready: (page: Page) => page.getByLabel('要做什么'),
  },
  {
    slug: 'notices',
    path: '/teacher/notices',
    title: '班级公告',
    ready: (page: Page) => page.getByRole('region', { name: '写公告' }),
  },
  {
    slug: 'preferences',
    path: '/teacher/preferences',
    title: '我的偏好',
    ready: (page: Page) => page.getByRole('group', { name: '老师形象' }),
  },
] as const

const VARIANTS = [
  { name: '1280x800 light', width: 1280, height: 800, theme: 'light', checkTitleX: true },
  { name: '1920x1080 light', width: 1920, height: 1080, theme: 'light', checkTitleX: true },
  { name: '1280x800 dark', width: 1280, height: 800, theme: 'dark', checkTitleX: false },
  { name: '375x812 light', width: 375, height: 812, theme: 'light', checkTitleX: false },
] as const

const guardReadOnly = (page: Page) =>
  page.route(/\/api\/v1\/(?!auth\/)/, (route) =>
    route.request().method() === 'GET' ? route.continue() : route.abort(),
  )

async function openStudentDrawer(page: Page) {
  await page.goto('/teacher/students')
  await expect(page.getByRole('heading', { level: 1, name: '学生' })).toBeVisible()
  await page.getByRole('button', { name: '王小一', exact: true }).click()
  await expect(page.getByRole('tab', { name: '概览' })).toBeVisible()
  // 抽屉里的内容(概况指标)出现、骨架屏消失后再量
  await expect(page.getByRole('group', { name: '概况指标' })).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
}

for (const variant of VARIANTS) {
  test.describe(`teacher non-classroom pages ${variant.name}`, () => {
    test.use({ viewport: { width: variant.width, height: variant.height } })

    for (const spec of PAGES) {
      test(`${spec.slug} meets the baseline`, async ({ page }) => {
        await guardReadOnly(page)
        await applyTheme(page, variant.theme)
        await signInAs(page, 'teacher')
        await page.goto(spec.path)
        await expect(page.getByRole('heading', { level: 1, name: spec.title })).toBeVisible()
        await expect(spec.ready(page)).toBeVisible()
        // 骨架屏(LoadingState 的 table / cards / form 变体)都带 aria-busy,等它们都消失再量
        await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
        await expectBaselineLayout(page, { checkTitleX: variant.checkTitleX })
      })
    }

    test('student drawer meets the control and card baseline', async ({ page }) => {
      await guardReadOnly(page)
      await applyTheme(page, variant.theme)
      await signInAs(page, 'teacher')
      await openStudentDrawer(page)
      // 抽屉里只量按钮高度和卡片:标题 x 不属于抽屉
      await expectBaselineLayout(page)
    })
  })
}

test('profile charts with one exam show a summary', async ({ page }) => {
  await guardReadOnly(page)
  await patchJson(page, /\/api\/v1\/classes\/[^/]+\/gradebook$/, (json) => {
    const mine = json.exams.filter(
      (e: { scores: Record<string, unknown> }) => Object.keys(e.scores).length > 0,
    )
    json.exams = mine.slice(0, 1)
  })
  await signInAs(page, 'teacher')
  await openStudentDrawer(page)
  await expect(page.getByText(/只有 1 次考试/).first()).toBeVisible()
  // 学科画像雷达图不是趋势图,1 场考试照常画;趋势那一块不应出现图
  const trend = page.locator('section', {
    has: page.getByRole('heading', { name: '总分得分率' }),
  })
  await expect(trend.locator('.recharts-surface')).toHaveCount(0)
})

// 窄页:正文最宽 768(max-w-3xl),标题仍在 default 的左缘
for (const spec of PAGES.filter((p) => p.slug === 'ai' || p.slug === 'preferences')) {
  test(`${spec.slug} body is capped at 768 on a wide screen`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await guardReadOnly(page)
    await applyTheme(page, 'light')
    await signInAs(page, 'teacher')
    await page.goto(spec.path)
    await expect(spec.ready(page)).toBeVisible()
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
    const root = page.locator('[data-page-container][data-width="narrow"]')
    await expect(root).toHaveCount(1)
    const body = root.locator(':scope > :not([data-page-header])').first()
    const box = await body.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(0)
    expect(box!.width).toBeLessThanOrEqual(768)
  })
}
