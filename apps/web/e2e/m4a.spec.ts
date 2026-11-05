import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import {
  adminGet, createExam, deleteE2eExams, getSwitches, login, putScores, putSwitches, rosterEnrollmentIds, studentRecord,
} from './helpers/api'

const API = '/api/v1'
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
const CLASS_3_2 = '44444444-4444-4444-4444-444444444444' // 三年二班:teacher01,王小一 / 李小二 / 张小三 …
const CLASS_4_1 = '44444444-4444-4444-4444-444444444442' // 四年一班:teacher05,魏小七(S0017)
const EXAM = 'E2E家长成绩'
const LI_PARENT = '13800000061' // 李家长:王小一(三年二班)与魏小七(四年一班)的主家长

// 本文件的用例各自准备并还原自己的数据;学年升级(用例 4)放最后,结束时回滚。
// 家长账号不能删:用例 1 解绑后账号被归档,留在库里;每次跑用不同的虚构手机号,重复跑不会撞号。
test.describe.configure({ mode: 'serial' })

async function signIn(page: Page, name: string, password = 'dev123') {
  await page.goto('/login')
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: /登录/ }).click()
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

/** 手机视口(375 × 812)里的新上下文;调用方负责关闭。 */
async function phoneContext(browser: Browser) {
  const ctx = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 375, height: 812 } })
  return { ctx, page: await ctx.newPage() }
}

/** 当前这一页没有横向滚动条。 */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

async function rollbackIfNeeded(request: APIRequestContext) {
  const principal = await login(request, 'principal01')
  const latest = await adminGet<{ id: string; rolled_back: boolean } | null>(request, principal, '/admin/years/upgrade/latest')
  if (latest && !latest.rolled_back) {
    const res = await request.post(`${API}/admin/years/upgrade/rollback`, { headers: auth(principal), data: { upgrade_id: latest.id } })
    expect(res.ok(), await res.text()).toBeTruthy()
  }
}

/** 解绑某学生名下指定手机号的家长(用例自建绑定的兜底清理;没有就什么也不做)。 */
async function unlinkParent(request: APIRequestContext, token: string, studentId: string, phone: string) {
  const list = await request.get(`${API}/students/${studentId}/parents`, { headers: auth(token) })
  expect(list.ok(), await list.text()).toBeTruthy()
  const links = (await list.json()) as { link_id: string; phone: string }[]
  for (const l of links.filter((x) => x.phone === phone)) {
    const del = await request.delete(`${API}/parent-links/${l.link_id}`, { headers: auth(token) })
    expect(del.ok(), await del.text()).toBeTruthy()
  }
}

/** 三年二班建一场考试并给全班录语文分(王小一在内)。 */
async function createClassExam(request: APIRequestContext, teacherToken: string): Promise<void> {
  const id = await createExam(request, teacherToken, CLASS_3_2, { name: EXAM, date: '2026-10-20', subjects: [{ name: '语文', full: 100 }] })
  const ids = await rosterEnrollmentIds(request, teacherToken, CLASS_3_2)
  await putScores(request, teacherToken, CLASS_3_2, id, '语文', ids, ids.map((_, i) => 95 - i * 3))
}

test('homeroom teacher creates a parent account who signs in on a phone and sees only the own child', async ({ page, browser, request }) => {
  // 139 号段:种子与其他用例只用 138 / 199,随机号不会撞上已有账号(撞上会绑到原账号、不出临时密码)
  const phone = `13900${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`
  const teacher = await login(request, 'teacher01')
  const zhang = await studentRecord(request, teacher, CLASS_3_2, '张小三')
  let ctx: Awaited<ReturnType<typeof phoneContext>>['ctx'] | undefined
  try {
    await signIn(page, 'teacher01')
    await expect(page.getByRole('heading', { name: '三年二班' })).toBeVisible()
    await page.goto('/teacher/students')
    await page.getByRole('button', { name: '张小三', exact: true }).click()
    await page.getByRole('tab', { name: '家长' }).click()
    await page.getByLabel('手机号').fill(phone)
    await page.getByLabel('称呼').fill('E2E家长')
    await page.getByRole('button', { name: '添加家长' }).click()
    const dialog = page.getByRole('dialog', { name: '家长账号' })
    await expect(dialog).toBeVisible()
    const tempPassword = /临时密码 (\S+?)。/.exec((await dialog.textContent()) ?? '')?.[1]
    expect(tempPassword, '对话框里应当有一次性临时密码').toBeTruthy()
    await dialog.getByRole('button', { name: '我已记下' }).click()
    await expect(page.getByRole('listitem').filter({ hasText: phone })).toBeVisible()

    // 家长在手机视口登录 → 被要求改密码 → 进家长端今日页
    const phoneCtx = await phoneContext(browser)
    ctx = phoneCtx.ctx
    const mobile = phoneCtx.page
    await signIn(mobile, phone, tempPassword!)
    await expect(mobile.getByRole('heading', { name: '首次登录请先修改密码' })).toBeVisible()
    await mobile.getByLabel('旧密码').fill(tempPassword!)
    await mobile.getByLabel('新密码', { exact: true }).fill('E2e-pass-2026')
    await mobile.getByLabel('确认新密码').fill('E2e-pass-2026')
    await mobile.getByRole('button', { name: '保存' }).click()
    await expect(mobile).toHaveURL(/\/parent\/today/)

    await expect(mobile.getByRole('region', { name: '今日出勤' })).toBeVisible()
    await expect(mobile.getByRole('region', { name: '班级座位' })).toBeVisible()
    await expect(mobile.getByText('张小三').first()).toBeVisible()
    // 别人的孩子:既不出现在页面文字里,也不出现在座位图的无障碍名称里
    await expect(mobile.getByText('王小一')).toHaveCount(0)
    await expect(mobile.getByText('李小二')).toHaveCount(0)
    expect(await mobile.locator('[aria-label*="王小一"], [aria-label*="李小二"]').count()).toBe(0)
    await expect(mobile.getByRole('navigation', { name: '主导航' })).toBeVisible() // 窄屏是底部页签
    await expectNoHorizontalScroll(mobile)
  } finally {
    await ctx?.close()
    await unlinkParent(request, teacher, zhang.student_id, phone)
  }
})

test('a parent with two children switches between them and the school rank switch changes the grade page', async ({ page, request }) => {
  const teacher = await login(request, 'teacher01')
  const principal = await login(request, 'principal01')
  const switches = await getSwitches(request, principal)
  try {
    await deleteE2eExams(request, teacher, CLASS_3_2)
    await createClassExam(request, teacher)
    await putSwitches(request, principal, { ...switches, parent_rank: false })

    await signIn(page, LI_PARENT)
    await expect(page).toHaveURL(/\/parent\/today/)
    const switcher = page.getByLabel('切换孩子')
    await expect(switcher.locator('option')).toHaveCount(2)
    await expect(switcher.locator('option:checked')).toHaveText('王小一')

    // 切到魏小七:选中项变了,出勤卡仍在
    await switcher.selectOption({ label: '魏小七' })
    await expect(switcher.locator('option:checked')).toHaveText('魏小七')
    await expect(page.getByRole('region', { name: '今日出勤' })).toBeVisible()
    await switcher.selectOption({ label: '王小一' })
    await expect(switcher.locator('option:checked')).toHaveText('王小一')

    // 开关关:成绩详情是段位;开关开:变成名次
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '成绩' }).click()
    await page.getByRole('button', { name: new RegExp(EXAM) }).click()
    await expect(page.getByTestId('rank-line')).toHaveText(/班级前 \d+%/)

    await putSwitches(request, principal, { ...switches, parent_rank: true })
    await page.reload()
    await page.getByRole('button', { name: new RegExp(EXAM) }).click()
    await expect(page.getByTestId('rank-line')).toHaveText(/班级第 \d+ 名 \/ 共 \d+ 人/)
  } finally {
    await putSwitches(request, principal, switches)
    await deleteE2eExams(request, teacher, CLASS_3_2)
  }
})

test('a teacher who is also a parent switches to the parent view and sees the own child', async ({ page }) => {
  await signIn(page, 'teacher04')
  await expect(page).toHaveURL(/\/teacher/)
  await page.getByRole('button', { name: '账号菜单' }).click()
  await page.getByRole('menuitem', { name: '切换到家长端' }).click()
  await expect(page).toHaveURL(/\/parent\/today/)
  await expect(page.getByText('李小二').first()).toBeVisible()
  await expect(page.getByRole('region', { name: '今日出勤' })).toBeVisible()
  // 家长端的账号菜单里能切回教师端
  await page.getByRole('button', { name: '账号菜单' }).click()
  await expect(page.getByRole('menuitem', { name: '切换到教师端' })).toBeVisible()
})

// 学年升级放最后:四年一班毕业 → 李家长名下的魏小七变只读;回滚后恢复在读。
test.describe('graduation', () => {
  test.beforeEach(async ({ request }) => { await rollbackIfNeeded(request) })
  test.afterEach(async ({ request }) => {
    await rollbackIfNeeded(request)
    await deleteE2eExams(request, await login(request, 'teacher05'), CLASS_4_1)
  })

  test('graduated child turns read-only for the parent and rolling back restores it', async ({ page, request }) => {
    // 毕业前给四年一班建一场考试并录魏小七的分
    const t5 = await login(request, 'teacher05')
    const wei = await studentRecord(request, t5, CLASS_4_1, '魏小七')
    const examId = await createExam(request, t5, CLASS_4_1, { name: EXAM, date: '2026-10-21', subjects: [{ name: '数学', full: 100 }] })
    await putScores(request, t5, CLASS_4_1, examId, '数学', [wei.enrollment_id], [91])

    // 校长经 API 升级:四年一班毕业,其余照建议方案
    const principal = await login(request, 'principal01')
    const suggested = await request.post(`${API}/admin/years/upgrade/suggest`, {
      headers: auth(principal), data: { name: '2027-2028', start_date: '2027-09-01', end_date: '2028-07-15' },
    })
    expect(suggested.ok(), await suggested.text()).toBeTruthy()
    const plan = (await suggested.json()) as { classes: { from_class_id: string; action: string; to_grade_name: string | null; to_name: string | null }[]; grade_heads: unknown[] }
    for (const c of plan.classes.filter((x) => x.from_class_id === CLASS_4_1)) { c.action = 'graduate'; c.to_grade_name = null; c.to_name = null }
    const done = await request.post(`${API}/admin/years/upgrade`, { headers: auth(principal), data: plan })
    expect(done.ok(), await done.text()).toBeTruthy()
    const { upgrade_id } = (await done.json()) as { upgrade_id: string }

    await signIn(page, LI_PARENT)
    await expect(page).toHaveURL(/\/parent\/today/)
    const switcher = page.getByLabel('切换孩子')
    await expect(switcher.locator('option', { hasText: '魏小七(已毕业/离校)' })).toHaveCount(1)
    await switcher.selectOption({ label: '魏小七(已毕业/离校)' })
    await expect(page.getByText(/毕业 \/ 离校,可以继续查看在校期间的成长与成绩/)).toBeVisible()
    await expect(page.getByRole('region', { name: '今日出勤' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: '班级座位' })).toHaveCount(0)
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '成绩' }).click()
    await page.getByRole('button', { name: new RegExp(EXAM) }).click()
    await expect(page.getByRole('cell', { name: '91 / 100' })).toBeVisible()

    // 回滚(带 upgrade_id)→ 恢复在读
    const back = await request.post(`${API}/admin/years/upgrade/rollback`, { headers: auth(principal), data: { upgrade_id } })
    expect(back.ok(), await back.text()).toBeTruthy()
    await page.reload()
    await expect(page.getByLabel('切换孩子').locator('option')).toHaveCount(2)
    await expect(page.getByLabel('切换孩子').locator('option', { hasText: '已毕业/离校' })).toHaveCount(0)
    await expect(page.getByLabel('切换孩子').locator('option:checked')).toHaveText('魏小七')
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '今日' }).click()
    await expect(page).toHaveURL(/\/parent\/today/)
    await expect(page.getByRole('region', { name: '今日出勤' })).toBeVisible()
  })
})
