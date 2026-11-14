/// <reference lib="dom" />
import { expect, type Page } from '@playwright/test'

export type Role = 'admin' | 'teacher' | 'parent'

// 种子账号;密码同 walkthrough.spec.ts 的 PASSWORD
const ACCOUNTS: Record<Role, { login: string; landing: RegExp }> = {
  admin: { login: 'principal01', landing: /\/admin\// },
  teacher: { login: 'teacher01', landing: /\/teacher\// },
  parent: { login: '13800000061', landing: /\/parent\// },
}
const PASSWORD = 'dev123'

export async function signInAs(page: Page, role: Role): Promise<void> {
  const { login, landing } = ACCOUNTS[role]
  await page.goto('/login')
  await page.getByLabel('登录名').fill(login)
  await page.getByLabel('密码').fill(PASSWORD)
  await page.getByRole('button', { name: /登录/ }).click()
  await expect(page).toHaveURL(landing)
}

/** 写 localStorage['ws-theme']:之后每次导航都先带上它;已经打开的页面立即重载生效。 */
export async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value) => {
    try {
      localStorage.setItem('ws-theme', value)
    } catch {
      // storage 不可用时忽略
    }
  }, theme)
  if (page.url() !== 'about:blank') {
    await page.evaluate((value) => localStorage.setItem('ws-theme', value), theme)
    await page.reload()
  }
}

const PARENT_MAX_WIDTH = 672
const PAGE_MAX_WIDTH = 1320

/**
 * 页面标题 h1 左缘应该在的 x:
 * main 的 left + max(0, (main.width − 最大宽) / 2) + (视口 ≥ 1024 ? 32 : 16);家长端最大宽 672。
 */
export async function expectedTitleX(page: Page): Promise<number> {
  const main = await page.locator('main').first().boundingBox()
  if (!main) throw new Error('main not found')
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('no viewport')
  const maxWidth = new URL(page.url()).pathname.startsWith('/parent')
    ? PARENT_MAX_WIDTH
    : PAGE_MAX_WIDTH
  const pad = viewport.width >= 1024 ? 32 : 16
  return main.x + Math.max(0, (main.width - maxWidth) / 2) + pad
}

const CONTROL_HEIGHTS = [32, 40, 44, 48]

/**
 * 量尺寸基线:
 * 1) 只有一个 h1;checkTitleX 时 h1.x 与 expectedTitleX 相差 ≤ 1;
 * 2) main 内可见的 button / input(非复选、单选)/ select 高度 ∈ {32, 40, 44, 48},跳过 [data-layout-exempt] 及后代;
 * 3) [data-slot=card] 无边框、圆角 ∈ {6, 12, 16};
 * 4) 没有横向溢出;
 * 5) 深色下 [data-slot=card] 背景与 body 背景的 WCAG 对比 ≥ 1.15。
 */
export async function expectBaselineLayout(
  page: Page,
  opts: { checkTitleX?: boolean } = {},
): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)

  if (opts.checkTitleX) {
    const h1 = await page.getByRole('heading', { level: 1 }).boundingBox()
    expect(h1).not.toBeNull()
    expect(Math.abs((h1?.x ?? 0) - (await expectedTitleX(page)))).toBeLessThanOrEqual(1)
  }

  const badHeights = await page.evaluate((allowed) => {
    const out: string[] = []
    const selector = 'button, input:not([type=checkbox]):not([type=radio]), select'
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`main ${selector}`))) {
      if (el.closest('[data-layout-exempt]')) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (getComputedStyle(el).visibility === 'hidden') continue
      if (!allowed.includes(Math.round(rect.height))) {
        out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 20)}" h=${rect.height}`)
      }
    }
    return out
  }, CONTROL_HEIGHTS)
  expect(badHeights, '控件高度应在 32 / 40 / 44 / 48').toEqual([])

  const badCards = await page.evaluate(() => {
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-slot=card]'))) {
      const style = getComputedStyle(el)
      const radius = parseFloat(style.borderTopLeftRadius)
      if (parseFloat(style.borderTopWidth) !== 0) out.push(`border ${style.borderTopWidth}`)
      if (![6, 12, 16].includes(radius)) out.push(`radius ${style.borderTopLeftRadius}`)
    }
    return out
  })
  expect(badCards, '卡片无边框、圆角 6 / 12 / 16').toEqual([])

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, '页面不应横向溢出').toBe(0)

  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  if (isDark) {
    const ratios = await page.evaluate(() => {
      // 计算出的背景色(可能是 oklch)经 1x1 canvas 转成 sRGB,再算相对亮度
      const luminance = (color: string) => {
        const ctx = document.createElement('canvas').getContext('2d')!
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .map((v) => {
            const c = v / 255
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
          })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const body = luminance(getComputedStyle(document.body).backgroundColor)
      return Array.from(document.querySelectorAll<HTMLElement>('[data-slot=card]')).map((el) => {
        const card = luminance(getComputedStyle(el).backgroundColor)
        const [hi, lo] = card > body ? [card, body] : [body, card]
        return (hi + 0.05) / (lo + 0.05)
      })
    })
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(1.15)
  }
}

/** 只改 GET 响应(压力态用),非 GET 直接 fallback。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function patchJson(page: Page, url: RegExp, edit: (json: any) => void): Promise<void> {
  await page.route(url, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const response = await route.fetch()
    const json = await response.json()
    edit(json)
    await route.fulfill({ response, json })
  })
}
