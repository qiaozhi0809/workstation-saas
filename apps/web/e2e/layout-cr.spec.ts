/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from '@playwright/test'
import { signInAs } from './helpers/layout'

/**
 * M6 CR:教室操作台按容器宽度保持一行。只读:/api/v1 下除 auth/ 外的非 GET 请求一律中止。
 * 1280×800 下侧栏展开(内容区约 1016 宽)是最窄的常用情形,五个模式都要一行;排座模式的
 * 「桌椅排列」此时收进「更多操作」菜单,键盘可达。
 */

const guardReadOnly = (page: Page) =>
  page.route(/\/api\/v1\/(?!auth\/)/, (route) =>
    route.request().method() === 'GET' ? route.continue() : route.abort(),
  )

const MODES: { slug: string; path: string; tab: string; ready: (page: Page) => Locator }[] = [
  {
    slug: 'daily',
    path: '/teacher/classroom',
    tab: '日常',
    ready: (p) => p.getByRole('button', { name: '随机点名' }),
  },
  {
    slug: 'attendance',
    path: '/teacher/classroom?mode=attendance',
    tab: '考勤',
    ready: (p) => p.getByRole('button', { name: '确认考勤' }),
  },
  {
    slug: 'review',
    path: '/teacher/classroom?mode=review',
    tab: '点评',
    ready: (p) => p.getByRole('button', { name: '待办与点评' }),
  },
  {
    slug: 'grades',
    path: '/teacher/classroom?mode=grades',
    tab: '成绩',
    ready: (p) => p.getByRole('button', { name: '待办与点评' }),
  },
  {
    slug: 'seating',
    path: '/teacher/classroom?mode=seating',
    tab: '排座',
    ready: (p) => p.getByRole('button', { name: '保存座位' }),
  },
]

async function openMode(page: Page, spec: (typeof MODES)[number]) {
  await guardReadOnly(page)
  await signInAs(page, 'teacher')
  await page.goto(spec.path)
  await expect(page.getByRole('tab', { name: spec.tab, selected: true })).toBeVisible()
  // 等真实内容渲染出来:座位、本模式的操作按钮,再要求没有骨架屏
  await expect(page.locator('[data-seat]').first()).toBeVisible()
  await expect(spec.ready(page)).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
}

async function expandSidebar(page: Page) {
  const side = page.getByRole('complementary', { name: '侧栏' })
  if (Math.round((await side.boundingBox())!.width) !== 264) await page.keyboard.press('[')
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(264)
}

async function expectOneRow(page: Page) {
  const bar = page.getByRole('toolbar', { name: '教室工具' })
  // 一行 = 按钮高 40 + 上下内边距 12;两行至少 90。拿框要等布局稳定,所以整段重试
  await expect(async () => {
    const box = (await bar.boundingBox())!
    expect(box.height).toBeLessThanOrEqual(64)
    const overflow = await bar.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  }).toPass({ timeout: 5000 })
}

test.describe('classroom dock stays on one row at 1280x800 with the sidebar expanded', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  for (const spec of MODES) {
    test(`${spec.slug} mode`, async ({ page }) => {
      await openMode(page, spec)
      await expandSidebar(page)
      await expectOneRow(page)
    })
  }

  test('seating keeps 桌椅排列 reachable from the keyboard through 更多操作', async ({ page }) => {
    await openMode(page, MODES[4])
    await expandSidebar(page)
    await expectOneRow(page)
    const more = page.getByRole('button', { name: '更多操作' })
    await more.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: '桌椅排列' })).toBeVisible()
  })
})

test.describe('classroom dock with the rail sidebar', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('seating stays on one row and keeps 桌椅排列 as a button', async ({ page }) => {
    await openMode(page, MODES[4])
    await expectOneRow(page)
    await expect(page.getByRole('button', { name: '桌椅排列' })).toBeVisible()
  })
})
