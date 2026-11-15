/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'
import { applyTheme, expectBaselineLayout, patchJson, signInAs } from './helpers/layout'

/**
 * M6 段 A3:管理端 摄像头 / 审计日志 / 登录日志 / AI 使用 / AI 配置 的布局基线。
 * 只读:/api/v1 下除 auth/ 外的非 GET 请求一律中止,只登录与打开页面。
 * 种子库里可能没有摄像头、审计、登录记录和 AI 用量:只在 GET 响应为空时补虚构数据,不写任何数据。
 */

type Theme = 'light' | 'dark'
type Viewport = readonly [number, number]

const RUNS: ReadonlyArray<{ label: string; theme: Theme; viewport: Viewport; titleX: boolean }> = [
  { label: '1280 light', theme: 'light', viewport: [1280, 800], titleX: true },
  { label: '1920 light', theme: 'light', viewport: [1920, 1080], titleX: true },
  { label: '1280 dark', theme: 'dark', viewport: [1280, 800], titleX: false },
  { label: '375 light', theme: 'light', viewport: [375, 812], titleX: false },
]

const NOW = new Date().toISOString()

async function fakeCameras(page: Page): Promise<void> {
  // 监控开关关着时页面只有提示:GET 响应里把它打开
  await patchJson(page, /\/api\/v1\/admin\/settings\/switches(\?|$)/, (json) => {
    json.monitor = true
  })
  await patchJson(page, /\/api\/v1\/admin\/cameras(\?|$)/, (json) => {
    if (Array.isArray(json) && json.length === 0) {
      json.push(
        {
          id: 'fake-cam-1',
          name: '示例摄像头一',
          class_id: null,
          class_name: null,
          location: '走廊',
          enabled: true,
          transcode: false,
          rtsp_url: 'rtsp://192.168.1.10:554/stream1',
          has_credentials: false,
          status: 'streaming',
          last_error: null,
        },
        {
          id: 'fake-cam-2',
          name: '示例摄像头二',
          class_id: null,
          class_name: null,
          location: '操场',
          enabled: false,
          transcode: true,
          rtsp_url: 'rtsp://192.168.1.11:554/stream1',
          has_credentials: true,
          status: 'error',
          last_error: '连接超时',
        },
      )
    }
  })
}

async function fakeAudit(page: Page): Promise<void> {
  await patchJson(page, /\/api\/v1\/admin\/audit(\?|$)/, (json) => {
    if (Array.isArray(json?.items) && json.items.length === 0) {
      json.items.push(
        {
          id: 'fake-audit-1',
          at: NOW,
          user_id: null,
          user_name: '示例用户',
          action: 'login',
          action_label: '登录',
          object_type: null,
          object_id: null,
          object_label: null,
          ip: '10.0.0.1',
          success: true,
          extra: { 说明: '示例' },
        },
        {
          id: 'fake-audit-2',
          at: NOW,
          user_id: null,
          user_name: '示例用户',
          action: 'denied',
          action_label: '被拒的访问',
          object_type: null,
          object_id: null,
          object_label: '示例对象',
          ip: '10.0.0.2',
          success: false,
          extra: null,
        },
      )
      json.total = json.items.length
    }
  })
}

async function fakeLoginLogs(page: Page): Promise<void> {
  await patchJson(page, /\/api\/v1\/admin\/login-logs(\?|$)/, (json) => {
    if (Array.isArray(json?.items) && json.items.length === 0) {
      json.items.push({
        id: 'fake-login-1',
        at: NOW,
        login_name: 'demo',
        user: { id: 'fake-user', display_name: '示例用户' },
        result: 'bad_password',
        ip: '10.0.0.3',
        user_agent: null,
        suspicious: ['night'],
      })
      json.total = json.items.length
    }
  })
}

async function fakeAiUsage(page: Page): Promise<void> {
  await patchJson(page, /\/api\/v1\/admin\/ai\/usage(\?|$)/, (json) => {
    if (Array.isArray(json?.rows) && json.rows.length === 0) {
      json.rows.push({
        user_id: 'fake-user',
        display_name: '示例老师',
        calls: 12,
        failed: 1,
        prompt_tokens: 3400,
        completion_tokens: 5600,
        top_templates: [{ template: 'fake', label: '示例场景', count: 7 }],
      })
      json.total = { calls: 12, failed: 1, prompt_tokens: 3400, completion_tokens: 5600 }
    }
  })
}

interface PageSpec {
  slug: string
  /** 打开页面并等到主要内容出现 */
  open(page: Page): Promise<void>
}

const PAGES: PageSpec[] = [
  {
    slug: 'cameras',
    open: async (page) => {
      await fakeCameras(page)
      await page.goto('/admin/cameras')
      await expect(page.getByRole('heading', { level: 1, name: '摄像头' })).toBeVisible()
      await expect(page.getByTestId('camera-list')).toBeVisible()
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
    },
  },
  {
    slug: 'audit',
    open: async (page) => {
      await fakeAudit(page)
      await page.goto('/admin/audit')
      await expect(page.getByRole('heading', { level: 1, name: '审计日志' })).toBeVisible()
      await expect(page.getByRole('table')).toBeVisible()
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
    },
  },
  {
    slug: 'login-logs',
    open: async (page) => {
      await fakeLoginLogs(page)
      await page.goto('/admin/login-logs')
      await expect(page.getByRole('heading', { level: 1, name: '登录日志' })).toBeVisible()
      await expect(page.getByRole('table')).toBeVisible()
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
    },
  },
  {
    slug: 'ai-usage',
    open: async (page) => {
      await fakeAiUsage(page)
      await page.goto('/admin/ai/usage')
      await expect(page.getByRole('heading', { level: 1, name: 'AI 使用' })).toBeVisible()
      await expect(page.getByRole('table')).toBeVisible()
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
    },
  },
  {
    slug: 'ai-config',
    open: async (page) => {
      await page.goto('/admin/ai/config')
      await expect(page.getByRole('heading', { level: 1, name: 'AI 配置' })).toBeVisible()
      // 配置表单加载完才有服务商下拉
      await expect(page.getByLabel('服务商')).toBeVisible()
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
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
  test.describe(`layout a3 · ${run.label}`, () => {
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

test('audit filter controls share one baseline', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await signInAs(page, 'admin')
  await fakeAudit(page)
  await page.goto('/admin/audit')
  await expect(page.getByRole('heading', { level: 1, name: '审计日志' })).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()
  const labels = ['开始日期', '结束日期', '搜索操作人', '分组', '操作', '对象类型']
  const boxes: { label: string; top: number; bottom: number }[] = []
  for (const label of labels) {
    const box = await page.getByLabel(label, { exact: true }).boundingBox()
    expect(box, `${label} 应可见`).not.toBeNull()
    boxes.push({ label, top: box?.y ?? 0, bottom: (box?.y ?? 0) + (box?.height ?? 0) })
  }
  // 同一行(纵向有重叠)的控件底边一致;筛选行换行时,不同行的控件不互相比
  let sameRowPairs = 0
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.top < b.bottom && b.top < a.bottom) {
        sameRowPairs++
        expect(Math.abs(a.bottom - b.bottom), `${a.label} 与 ${b.label} 底边`).toBeLessThanOrEqual(
          1,
        )
      }
    }
  }
  expect(sameRowPairs).toBeGreaterThan(0)
})
