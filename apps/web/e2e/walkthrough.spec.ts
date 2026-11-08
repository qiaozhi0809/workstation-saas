import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * 走查截图(M5d R14):把每一端的主要页面在若干视口 × 浅 / 深两套主题下截成整页 PNG,
 * 写到 apps/web/walkthrough/<端>/<页面>-<宽x高>-<主题>.png;CI 把这个目录作为 artifact
 * `walkthrough-<sha>` 上传,协调者下载看图。
 *
 * 只读:只登录与打开页面,不点任何会写数据的控件;/api/v1 下除登录 / 刷新 / 退出之外的非 GET 请求一律拦下
 * (万一哪个页面一打开就写数据,截图里会出现失败提示,数据不会被改)。
 * 矩阵:浅色 5 个视口全截;深色只截手机(375×812)与桌面(1280×800)两档——深色的差异(对比度、配色)
 * 与视口基本无关,手机那档单独看窄屏下的深色导航与卡片,其余三档省掉。
 * 账号:teacher01(教师端)、principal01(校长,管理端全部 15 页)、itadmin01(信息中心,管理端 8 页)、
 * 13800000061(家长端)。CI 单独一步 `--project walkthrough --no-deps` 跑,失败不拦 job。
 * 本机不跑(机器弱、纪律):`npx playwright test --list --project walkthrough` 能列出用例即可,截图由 CI 产出。
 */

const OUT = fileURLToPath(new URL('../walkthrough/', import.meta.url))
const PASSWORD = 'dev123'

type Theme = 'light' | 'dark'
type Viewport = readonly [number, number]
const THEMES: readonly Theme[] = ['light', 'dark']
const THEME_LABEL: Record<Theme, string> = { light: '浅色', dark: '深色' }
const VIEWPORTS: readonly Viewport[] = [
  [375, 812],
  [768, 1024],
  [1024, 768],
  [1280, 800],
  [1920, 1080],
]
const DARK_VIEWPORTS: readonly Viewport[] = [
  [375, 812],
  [1280, 800],
]
const viewportsFor = (theme: Theme) => (theme === 'dark' ? DARK_VIEWPORTS : VIEWPORTS)

interface PageSpec {
  slug: string
  path: string
  /** 截图前必须出现的主要内容(标题、地图、卡片……),都可见才截 */
  ready(page: Page): Locator[]
}

const heading = (page: Page, name: string | RegExp, exact = true) =>
  page.getByRole('heading', { name, exact: typeof name === 'string' ? exact : undefined })
const seats = (page: Page) => page.locator('[data-seat]').first()
const modeTab = (page: Page, name: string) => page.getByRole('tab', { name, selected: true })

// 五个教室模式各一张:?mode= 与 ClassroomPage 读参数的写法一致,没有参数就是日常
const TEACHER_PAGES: PageSpec[] = [
  {
    slug: 'classroom-daily',
    path: '/teacher/classroom',
    ready: (p) => [heading(p, '三年二班'), modeTab(p, '日常'), seats(p)],
  },
  {
    slug: 'classroom-attendance',
    path: '/teacher/classroom?mode=attendance',
    ready: (p) => [modeTab(p, '考勤'), seats(p)],
  },
  {
    slug: 'classroom-review',
    path: '/teacher/classroom?mode=review',
    ready: (p) => [modeTab(p, '点评'), seats(p)],
  },
  {
    slug: 'classroom-grades',
    path: '/teacher/classroom?mode=grades',
    ready: (p) => [modeTab(p, '成绩'), seats(p)],
  },
  {
    slug: 'classroom-seating',
    path: '/teacher/classroom?mode=seating',
    ready: (p) => [modeTab(p, '排座'), seats(p)],
  },
  {
    slug: 'scores',
    path: '/teacher/scores',
    ready: (p) => [heading(p, '成绩录入'), p.getByRole('region', { name: '当前考试' })],
  },
  { slug: 'analysis', path: '/teacher/analysis', ready: (p) => [heading(p, '成绩分析')] },
  {
    slug: 'students',
    path: '/teacher/students',
    ready: (p) => [heading(p, '学生'), p.getByLabel('搜索学生')],
  },
  {
    slug: 'ai',
    path: '/teacher/ai',
    ready: (p) => [heading(p, 'AI 助手'), p.getByText('今天想做点什么')],
  },
  { slug: 'notices', path: '/teacher/notices', ready: (p) => [heading(p, '班级公告')] },
  { slug: 'preferences', path: '/teacher/preferences', ready: (p) => [heading(p, '我的偏好')] },
]

// 校长拥有管理端全部权限点,一个账号就能打开全部 15 个页面
const ADMIN_PAGES: PageSpec[] = [
  {
    slug: 'today',
    path: '/admin/today',
    ready: (p) => [heading(p, /今日关注/), p.getByRole('region', { name: '开学准备' })],
  },
  { slug: 'board', path: '/admin/board', ready: (p) => [heading(p, '全校看板')] },
  { slug: 'org', path: '/admin/org', ready: (p) => [heading(p, '组织架构')] },
  { slug: 'accounts', path: '/admin/accounts', ready: (p) => [heading(p, '账号')] },
  { slug: 'timetable', path: '/admin/timetable', ready: (p) => [heading(p, '作息与课表')] },
  { slug: 'cameras', path: '/admin/cameras', ready: (p) => [heading(p, '摄像头')] },
  { slug: 'grade-exams', path: '/admin/grade-exams', ready: (p) => [heading(p, '年级联考')] },
  { slug: 'reports-scores', path: '/admin/reports/scores', ready: (p) => [heading(p, '成绩汇总')] },
  {
    slug: 'reports-attendance',
    path: '/admin/reports/attendance',
    ready: (p) => [heading(p, '月度考勤报告')],
  },
  { slug: 'audit', path: '/admin/audit', ready: (p) => [heading(p, '审计日志')] },
  { slug: 'login-logs', path: '/admin/login-logs', ready: (p) => [heading(p, '登录日志')] },
  { slug: 'settings', path: '/admin/settings', ready: (p) => [heading(p, '学校设置')] },
  { slug: 'ai-config', path: '/admin/ai/config', ready: (p) => [heading(p, 'AI 配置')] },
  { slug: 'upgrade', path: '/admin/upgrade', ready: (p) => [heading(p, '学年升级')] },
  { slug: 'history', path: '/admin/history', ready: (p) => [heading(p, '往年班级')] },
]

// 信息中心(itadmin01):只有 org.manage / account.manage / settings.manage / audit.read / camera.manage,
// 没有 school.view,看不到今日关注、看板、联考与报表、通知、学年升级、往年班级;登录后落在它第一个有权限的页面「组织架构」。
// 页面与校长的同一批,但导航短、分组不同、页内按权限显示的控件不同,所以单独走一遍
const IT_ADMIN_SLUGS = [
  'org',
  'timetable',
  'accounts',
  'settings',
  'audit',
  'ai-config',
  'login-logs',
  'cameras',
]
const IT_ADMIN_PAGES: PageSpec[] = ADMIN_PAGES.filter((p) => IT_ADMIN_SLUGS.includes(p.slug))
// slug 写错会被 filter 静默丢掉、少截几十张图,收集阶段就报出来
if (IT_ADMIN_PAGES.length !== IT_ADMIN_SLUGS.length) {
  const found = new Set(IT_ADMIN_PAGES.map((p) => p.slug))
  const missing = IT_ADMIN_SLUGS.filter((s) => !found.has(s))
  throw new Error(`IT_ADMIN_SLUGS 里这些 slug 在 ADMIN_PAGES 找不到:${missing.join(', ')}`)
}

// 李家长(13800000061):王小一(三年二班)与魏小七(四年一班)的主家长,登录后落在今日页
const PARENT_PAGES: PageSpec[] = [
  {
    slug: 'today',
    path: '/parent/today',
    ready: (p) => [p.getByRole('region', { name: '今日出勤' })],
  },
  { slug: 'growth', path: '/parent/growth', ready: (p) => [heading(p, '成长')] },
  { slug: 'grades', path: '/parent/grades', ready: (p) => [heading(p, '成绩')] },
  { slug: 'profile', path: '/parent/profile', ready: (p) => [heading(p, /的档案$/)] },
  { slug: 'notices', path: '/parent/notices', ready: (p) => [heading(p, '通知')] },
]

/** 主题写进 ThemeToggle 用的 localStorage 键,之后每次加载页面都按它上色(不跟随 runner 的系统主题) */
const useTheme = (page: Page, theme: Theme) =>
  page.addInitScript((mode) => localStorage.setItem('ws-theme', mode), theme)

/** 只读护栏:登录 / 刷新 / 退出之外的写请求一律中止 */
const guardReadOnly = (page: Page) =>
  page.route(/\/api\/v1\/(?!auth\/)/, (route) =>
    route.request().method() === 'GET' ? route.continue() : route.abort(),
  )

async function signIn(page: Page, name: string, landing: RegExp) {
  await page.goto('/login')
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill(PASSWORD)
  await page.getByRole('button', { name: /登录/ }).click()
  await expect(page).toHaveURL(landing)
}

/** 等主要内容出现、没有 LoadingState、网络空闲(空闲最多等 10 秒,超时就按当前状态截) */
async function settle(page: Page, ready: Locator[]) {
  for (const l of ready) await expect(l).toBeVisible()
  // 只认 LoadingState(role="status" + "加载中"),不按正文子串匹配,免得将来帮助文案里出现"加载中"卡住每一页;
  // Toast 区、教室 dock 等别的 role="status" 元素不含这几个字,不会误等
  await expect(page.getByRole('status').filter({ hasText: /加载中/ })).toHaveCount(0)
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
}

// AppShell 的 <main> 自己滚动,整页截图默认只会截到一屏;内容超出时临时放开高度与溢出,截完再恢复。
// 教室页等本来就不滚动的页面不受影响
const UNCLIP =
  'html, body, #root, #root > div, #main { height: auto !important; min-height: 0 !important; overflow: visible !important; }'
const mainOverflows = (page: Page) =>
  page.evaluate(() => {
    const main = document.getElementById('main')
    return main !== null && main.scrollHeight > main.clientHeight + 1
  })

async function shoot(page: Page, role: string, slug: string, theme: Theme) {
  for (const [width, height] of viewportsFor(theme)) {
    await page.setViewportSize({ width, height })
    // 换视口后等重新排版(导航换宽窄形态、教室地图按容器重新适应)
    await page.waitForTimeout(300)
    const unclip = (await mainOverflows(page)) ? await page.addStyleTag({ content: UNCLIP }) : null
    await page.screenshot({
      path: path.join(OUT, role, `${slug}-${width}x${height}-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    })
    if (unclip) await unclip.evaluate((el) => (el as Element).remove())
  }
}

async function walk(page: Page, role: string, pages: PageSpec[], theme: Theme) {
  for (const p of pages) {
    await page.goto(p.path)
    await settle(page, p.ready(page))
    await shoot(page, role, p.slug, theme)
  }
}

/**
 * 欢迎页只对没看过的老师弹;种子老师都已看过,又不能改种子账号状态,
 * 所以只在浏览器里把 GET /me/preferences 回来的 onboarded.teacher 去掉——服务端数据原样,对话框照常弹出。
 * 不点「开始」也不关它,就不会写回去。
 */
async function stripTeacherOnboarded(page: Page) {
  await page.route('**/api/v1/me/preferences', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const response = await route.fetch()
    const body = (await response.json()) as { onboarded?: Record<string, unknown> }
    delete body.onboarded?.teacher
    // 正文变短了,原来的 content-length 不能再用;去掉后 Playwright 会按新正文重新算
    const headers = Object.fromEntries(
      Object.entries(response.headers()).filter(([k]) => k.toLowerCase() !== 'content-length'),
    )
    await route.fulfill({ response, headers, json: body })
  })
}

// 十个用例互不相干(各自开新上下文、登录、只读),并行跑;先后顺序不影响截图结果
test.describe.configure({ mode: 'parallel' })

for (const theme of THEMES) {
  test(`登录页 · ${THEME_LABEL[theme]}`, async ({ page }) => {
    await guardReadOnly(page)
    await useTheme(page, theme)
    await page.goto('/login')
    await settle(page, [heading(page, '班级工作台')])
    await shoot(page, 'auth', 'login', theme)
  })

  test(`教师端 · ${THEME_LABEL[theme]}`, async ({ page }) => {
    await guardReadOnly(page)
    await useTheme(page, theme)
    await signIn(page, 'teacher01', /\/teacher\/classroom/)
    // 走查必须用中文浏览器语言,日期 / 时间控件才显示成 2026/09/01 这类格式(由 playwright.config 的启动参数保证)
    expect(await page.evaluate(() => navigator.language)).toMatch(/^zh/)
    await walk(page, 'teacher', TEACHER_PAGES, theme)
    await stripTeacherOnboarded(page)
    await page.goto('/teacher/classroom')
    await settle(page, [page.getByRole('dialog', { name: /你好/ })])
    await shoot(page, 'teacher', 'welcome', theme)
  })

  test(`管理端 · ${THEME_LABEL[theme]}`, async ({ page }) => {
    await guardReadOnly(page)
    await useTheme(page, theme)
    await signIn(page, 'principal01', /\/admin\/today/)
    await walk(page, 'admin', ADMIN_PAGES, theme)
  })

  test(`信息中心 · ${THEME_LABEL[theme]}`, async ({ page }) => {
    await guardReadOnly(page)
    await useTheme(page, theme)
    await signIn(page, 'itadmin01', /\/admin\/org/)
    await walk(page, 'itadmin', IT_ADMIN_PAGES, theme)
  })

  test(`家长端 · ${THEME_LABEL[theme]}`, async ({ page }) => {
    await guardReadOnly(page)
    await useTheme(page, theme)
    await signIn(page, '13800000061', /\/parent\/today/)
    await walk(page, 'parent', PARENT_PAGES, theme)
  })
}
