import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { adminGet, currentUserId, endRolesOfUser, endStaffOfUser, getSwitches, login, putSwitches } from './helpers/api'

const API = '/api/v1'
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
// 黑板上的"本周之星"标题永远在,开关只清空榜单:有人上榜时榜单行是 ★分数
const STAR_ROW = /^★\d+$/
const GRADE3 = '33333333-3333-3333-3333-333333333333'
const GRADE4 = '33333333-3333-3333-3333-333333333334'
const CLASS_3_1 = '44444444-4444-4444-4444-444444444441'
const CLASS_3_2 = '44444444-4444-4444-4444-444444444444'

async function signIn(page: Page, name: string, password = 'dev123') {
  await page.goto('/login')
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: /登录/ }).click()
}

// 本文件的用例会建账号、改任职 / 管理岗、改学校开关:每个用例前后兜底还原(账号只冻结不删除,登录名带随机后缀避免重跑撞名)。
// 与其他 spec 的隔离由 playwright.config.ts 的 project 依赖链保证。
async function saveSwitches(page: Page) {
  const saved = page.waitForResponse((r) => r.url().includes('/admin/settings/switches') && r.request().method() === 'PUT')
  await page.getByRole('button', { name: '保存' }).last().click()
  expect((await saved).ok()).toBeTruthy()
}

const created: string[] = []
async function cleanup(request: APIRequestContext) {
  const it = await login(request, 'itadmin01')
  const teacher = await login(request, 'teacher01')
  await endRolesOfUser(request, it, await currentUserId(request, teacher))
  await putSwitches(request, it, { ...(await getSwitches(request, it)), star_of_week: true })
  for (const id of created.splice(0)) {
    await endStaffOfUser(request, it, CLASS_3_1, id)
    const res = await request.post(`${API}/admin/accounts/${id}/freeze`, { headers: { Authorization: `Bearer ${it}` } })
    expect([200, 409]).toContain(res.status())
  }
}
test.beforeEach(({ request }) => cleanup(request))
test.afterEach(({ request }) => cleanup(request))

test('principal lands on today, browses the board and opens a read-only class view', async ({ page }) => {
  await signIn(page, 'principal01')
  await expect(page).toHaveURL(/\/admin\/today/)
  await expect(page.getByRole('heading', { name: '今日关注 · 全校' })).toBeVisible()

  await page.getByRole('link', { name: '全校看板' }).first().click()
  await expect(page.getByRole('heading', { name: '全校看板' })).toBeVisible()
  await page.getByRole('tab', { name: '三年级' }).click()
  await expect(page.locator('[data-class-card]')).toHaveCount(2)

  await page.locator('[data-class-card]').filter({ hasText: '三年二班' }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/classes/${CLASS_3_2}`))
  await expect(page.getByRole('heading', { name: /三年二班/ })).toBeVisible()

  await page.locator('[data-seat]').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  for (const name of ['考勤', '点评', '排座']) {
    await expect(page.getByRole('button', { name: new RegExp(name) })).toHaveCount(0)
  }
})

test('it admin creates a teacher account, who changes the temp password and is logged out when frozen', async ({ page, browser, request }) => {
  const loginName = `e2e_teacher_${Date.now().toString(36)}`
  const it = await login(request, 'itadmin01')

  await signIn(page, 'itadmin01')
  await expect(page).toHaveURL(/\/admin/)
  await page.goto('/admin/accounts')
  await page.getByRole('button', { name: '新建账号' }).click()
  const form = page.getByRole('dialog', { name: '新建账号' })
  await form.getByLabel('登录名').fill(loginName)
  await form.getByLabel('姓名').fill('测试老师')
  await form.getByLabel('科目').fill('语文')
  await form.getByRole('button', { name: '保存' }).click()
  const tempDialog = page.getByRole('dialog', { name: '临时密码' })
  await expect(tempDialog).toBeVisible()
  const tempPassword = (await tempDialog.locator('p.font-mono').innerText()).trim()
  expect(tempPassword).toHaveLength(10)
  await page.keyboard.press('Escape')
  await expect(tempDialog).toBeHidden()

  const accounts = await adminGet<{ items: { id: string; login_name: string }[] }>(request, it, `/admin/accounts?q=${loginName}`)
  const accountId = accounts.items.find((a) => a.login_name === loginName)!.id
  created.push(accountId)
  const assign = await request.post(`${API}/admin/classes/${CLASS_3_1}/staff`, {
    headers: { Authorization: `Bearer ${it}` },
    data: { user_id: accountId, identity: 'subject', subject: '语文' },
  })
  expect(assign.ok(), await assign.text()).toBeTruthy()

  // 新老师用临时密码登录 → 被带到改密码页 → 改密码 → 进教师端
  const ctx = await browser.newContext({ baseURL: BASE_URL })
  const teacherPage = await ctx.newPage()
  await signIn(teacherPage, loginName, tempPassword)
  await expect(teacherPage.getByRole('heading', { name: '首次登录请先修改密码' })).toBeVisible()
  await teacherPage.getByLabel('旧密码').fill(tempPassword)
  await teacherPage.getByLabel('新密码', { exact: true }).fill('E2e-pass-2026')
  await teacherPage.getByLabel('确认新密码').fill('E2e-pass-2026')
  await teacherPage.getByRole('button', { name: '保存' }).click()
  await expect(teacherPage).toHaveURL(/\/teacher/)
  await expect(teacherPage.getByRole('heading', { name: '三年一班' })).toBeVisible()

  // 信息中心冻结 → 老师的页面下一次请求回到登录页
  await page.reload()
  await page.getByLabel('搜索姓名或登录名').fill(loginName)
  const row = page.getByRole('row').filter({ hasText: loginName })
  await row.getByRole('button', { name: '冻结' }).click()
  await page.getByRole('button', { name: '确认冻结' }).click()
  await expect(row.getByText('已冻结')).toBeVisible()

  await teacherPage.reload()
  await expect(teacherPage).toHaveURL(/\/login/)
  await ctx.close()
})

test('turning off star of the week in settings hides it on the teacher blackboard', async ({ page, browser, request }) => {
  const teacher = await login(request, 'teacher01')
  const roster = await adminGet<{ items: { enrollment_id: string }[] }>(request, teacher, `/classes/${CLASS_3_2}/students`)
  const opId = randomUUID()
  const review = await request.post(`${API}/classes/${CLASS_3_2}/reviews`, {
    headers: { Authorization: `Bearer ${teacher}` },
    data: { op_id: opId, category: 'individual', enrollment_ids: [roster.items[0].enrollment_id], reason_text: 'E2E 本周之星', score_delta: 1 },
  })
  expect(review.ok(), await review.text()).toBeTruthy()

  try {
    const ctx = await browser.newContext({ baseURL: BASE_URL })
    const teacherPage = await ctx.newPage()
    await signIn(teacherPage, 'teacher01')
    await expect(teacherPage.getByRole('heading', { name: '三年二班' })).toBeVisible()
    await expect(teacherPage.getByText(STAR_ROW).first()).toBeVisible()

    await signIn(page, 'itadmin01')
    await expect(page).toHaveURL(/\/admin/)
    await page.goto('/admin/settings')
    await page.getByRole('switch', { name: '本周之星' }).uncheck()
    await saveSwitches(page)

    // 等点评汇总取回再断言"榜单为空",否则榜单还没加载时也是空的
    const summary = teacherPage.waitForResponse((r) => r.url().includes('/reviews/summary'))
    await teacherPage.reload()
    await summary
    await expect(teacherPage.getByRole('heading', { name: '三年二班' })).toBeVisible()
    await expect(teacherPage.getByText(STAR_ROW)).toHaveCount(0)

    await page.getByRole('switch', { name: '本周之星' }).check()
    await saveSwitches(page)
    await teacherPage.reload()
    await expect(teacherPage.getByText(STAR_ROW).first()).toBeVisible()
    await ctx.close()
  } finally {
    const revoked = await request.post(`${API}/classes/${CLASS_3_2}/reviews/${opId}/revoke`, { headers: { Authorization: `Bearer ${teacher}` } })
    expect(revoked.ok(), await revoked.text()).toBeTruthy()
  }
})

test('grade head only sees her own grade and gets 403 on another grade board', async ({ page, request }) => {
  await signIn(page, 'gradehead03')
  await expect(page.getByRole('heading', { name: '今日关注 · 三年级' })).toBeVisible()
  await page.getByRole('link', { name: '全校看板' }).first().click()
  await expect(page.getByRole('tab', { name: '三年级' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '四年级' })).toHaveCount(0)

  const token = await login(request, 'gradehead03')
  const own = await request.get(`${API}/admin/board?grade_id=${GRADE3}`, { headers: { Authorization: `Bearer ${token}` } })
  expect(own.status()).toBe(200)
  const other = await request.get(`${API}/admin/board?grade_id=${GRADE4}`, { headers: { Authorization: `Bearer ${token}` } })
  expect(other.status()).toBe(403)
})

test('teacher01 gets a grade head role and can switch between teacher and admin sides', async ({ page, request }) => {
  const it = await login(request, 'itadmin01')
  const teacher = await login(request, 'teacher01')
  const res = await request.post(`${API}/admin/roles`, {
    headers: { Authorization: `Bearer ${it}` },
    data: { user_id: await currentUserId(request, teacher), role: 'grade_head', grade_id: GRADE3 },
  })
  expect(res.status(), await res.text()).toBe(201)

  await signIn(page, 'teacher01')
  await expect(page.getByRole('heading', { name: '三年二班' })).toBeVisible()
  await page.getByRole('button', { name: '账号菜单' }).click()
  await page.getByRole('menuitem', { name: '切换到管理端' }).click()
  await expect(page).toHaveURL(/\/admin\/today/)
  await expect(page.getByRole('heading', { name: '今日关注 · 三年级' })).toBeVisible()

  await page.getByRole('button', { name: '账号菜单' }).click()
  await page.getByRole('menuitem', { name: /切换到教师端/ }).click()
  await expect(page).toHaveURL(/\/teacher/)
  await expect(page.getByRole('heading', { name: '三年二班' })).toBeVisible()
})
