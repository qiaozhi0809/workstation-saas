/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'
import { applyTheme, expectBaselineLayout, patchJson, signInAs } from './helpers/layout'

/**
 * M6 T1:教师端非教室页的布局基线。只读:/api/v1 下除 auth/ 外的非 GET 请求一律中止。
 * 第一次推送时红的,作为基准;T1 做完变绿。
 */

const PAGES = [
  { slug: 'scores', path: '/teacher/scores', title: '成绩录入' },
  { slug: 'analysis', path: '/teacher/analysis', title: '成绩分析' },
  { slug: 'students', path: '/teacher/students', title: '学生' },
  { slug: 'ai', path: '/teacher/ai', title: 'AI 助手' },
  { slug: 'notices', path: '/teacher/notices', title: '班级公告' },
  { slug: 'preferences', path: '/teacher/preferences', title: '我的偏好' },
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
        await expect(page.getByText('加载中…')).toHaveCount(0)
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
