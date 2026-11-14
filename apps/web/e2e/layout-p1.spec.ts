/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'
import { applyTheme, expectBaselineLayout, patchJson, signInAs } from './helpers/layout'

// 只读:登录与打开页面,不点任何会写数据的控件;/api/v1 下除 auth/ 之外的非 GET 请求一律中止。
// 家长端是手机 / 平板用的,只量 375×812 与 768×1024 两档,浅色、深色各一遍。

const PAGES = [
  { slug: 'today', path: '/parent/today' },
  { slug: 'growth', path: '/parent/growth' },
  { slug: 'grades', path: '/parent/grades' },
  { slug: 'profile', path: '/parent/profile' },
  { slug: 'notices', path: '/parent/notices' },
] as const

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
] as const

const guardReadOnly = (page: Page) =>
  page.route(/\/api\/v1\/(?!auth\/)/, (route) =>
    route.request().method() === 'GET' ? route.continue() : route.abort(),
  )

/** 等 LoadingState 消失,再等网络空闲(最多 10 秒,超时按当前状态量) */
async function settled(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByRole('status').filter({ hasText: /加载中/ })).toHaveCount(0)
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
}

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of VIEWPORTS) {
    test(`parent pages meet the baseline at ${viewport.width}px ${theme}`, async ({ page }) => {
      await guardReadOnly(page)
      await page.setViewportSize(viewport)
      await signInAs(page, 'parent')
      await applyTheme(page, theme)
      if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
      for (const { path } of PAGES) {
        await page.goto(path)
        await settled(page)
        await expectBaselineLayout(page, { checkTitleX: true })
      }
    })
  }
}

// 每个导航链接的文字只占一行:量文字节点的行盒数,不是链接自己的盒子数
async function navLabelLineCounts(page: Page): Promise<number[]> {
  return page.getByRole('navigation', { name: '主导航' }).evaluate((nav) =>
    Array.from(nav.querySelectorAll('a')).map((link) => {
      const label = Array.from(link.querySelectorAll('span')).find(
        (s) => !s.classList.contains('sr-only') && (s.textContent ?? '').trim().length > 0,
      )
      if (!label) return 0
      const range = document.createRange()
      range.selectNodeContents(label)
      return range.getClientRects().length
    }),
  )
}

test('header survives long school name and two children', async ({ page }) => {
  await guardReadOnly(page)
  await patchJson(page, /\/api\/v1\/meta$/, (json) => {
    json.school_name = '示例实验学校附属第二外国语小学分校第三校'
  })
  await patchJson(page, /\/api\/v1\/parent\/children$/, (json) => {
    json.push({ ...json[0], student_id: 'stress-child-2', name: '欧阳慕容诸葛司马' })
  })
  await signInAs(page, 'parent')

  for (const width of [375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/parent/today')
    const switcher = page.getByRole('combobox', { name: '切换孩子' })
    await expect(switcher).toBeVisible()
    const box = await switcher.boundingBox()
    expect(box?.width ?? 0, `${width} 宽下切换孩子下拉宽度`).toBeGreaterThanOrEqual(96)

    const lines = await navLabelLineCounts(page)
    expect(lines.length).toBe(4)
    for (const n of lines) expect(n, `${width} 宽下导航文字行数`).toBe(1)
  }
})

test('first visit card button is a touch target', async ({ page }) => {
  await guardReadOnly(page)
  await patchJson(page, /\/me\/preferences$/, (json) => {
    if (json.onboarded) delete json.onboarded.parent
  })
  await page.setViewportSize({ width: 768, height: 1024 })
  await signInAs(page, 'parent')
  const button = page.getByRole('region', { name: '首次使用提示' }).getByRole('button', {
    name: '知道了',
  })
  await expect(button).toBeVisible()
  const box = await button.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})
