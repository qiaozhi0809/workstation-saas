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

/**
 * 联考页和往年页在种子库里可能没有数据,只剩空状态,量不到卡片、表格。
 * 这里只改 GET 的响应(非 GET 仍由 guardReadOnly 中止),数据都是虚构的。
 */
async function stubExamAndHistory(page: Page) {
  const json = (url: RegExp, body: unknown) =>
    page.route(url, (route) =>
      route.request().method() === 'GET' ? route.fulfill({ json: body }) : route.fallback(),
    )
  await json(/\/api\/v1\/admin\/grade-exams(\?|$)/, [
    {
      id: 'ge-a2',
      grade_id: 'g-a2',
      grade_name: '示例年级',
      name: '示例期中联考',
      exam_type: '期中',
      date: '2026-11-03',
      subjects: [
        { name: '语文', full: 100 },
        { name: '数学', full: 100 },
      ],
      classes: [
        {
          class_id: 'c-a2-1',
          class_name: '示例一班',
          exam_id: 'e-a2-1',
          entered: 20,
          expected: 40,
        },
        {
          class_id: 'c-a2-2',
          class_name: '示例二班',
          exam_id: 'e-a2-2',
          entered: 40,
          expected: 40,
        },
      ],
      missing_classes: [],
    },
  ])
  await json(/\/api\/v1\/admin\/history\/years(\?|$)/, [
    { id: 'y-a2', name: '2025-2026 学年', start_date: '2025-09-01', end_date: '2026-07-01' },
  ])
  await json(/\/api\/v1\/admin\/history\/classes\?/, [
    {
      class_id: 'hc-a2-1',
      class_name: '示例一班',
      grade_name: '示例年级',
      homeroom_name: '示例老师',
      students: 40,
    },
    {
      class_id: 'hc-a2-2',
      class_name: '示例二班',
      grade_name: '示例年级',
      homeroom_name: null,
      students: 38,
    },
  ])
  await json(/\/api\/v1\/admin\/history\/classes\/[^/?]+\/students/, {
    students: [
      { student_id: 'hs-1', name: '示例学生甲', student_no: '2501', status: 'promoted' },
      { student_id: 'hs-2', name: '示例学生乙', student_no: null, status: 'graduated' },
    ],
  })
}

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
        if (p.path === '/admin/grade-exams' || p.path === '/admin/history') {
          await stubExamAndHistory(page)
        }
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
      await stubExamAndHistory(page)
      await applyTheme(page, view.theme)
      await signInAs(page, 'admin')
      await page.goto('/admin/history')
      await settle(page)
      const href = await page
        .locator('a[href^="/admin/history/classes/"]')
        .first()
        .getAttribute('href')
      expect(href).toContain('/admin/history/classes/hc-a2-1')
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
    for (const c of classes) c.homeroom_name = '欧阳慕容老师'
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
