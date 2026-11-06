import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { adminGet, endStaffOfUser, login } from './helpers/api'
import { totpCode } from './helpers/totp'

const API = '/api/v1'
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
const CLASS_3_1 = '44444444-4444-4444-4444-444444444441' // 三年一班:测试老师以语文科任身份进入
const PASSWORD = 'E2e-pass-2026' // 虚构测试密码
const DEFAULT_SECURITY = { totp_allowed: false, password_min_length: 8, password_max_age_days: 0 }

// 本文件五个用例各建一个虚构老师账号(登录名带随机后缀;账号用完冻结、留库),不改种子账号。
// 学校安全设置在每个用例前后还原为默认(False / 8 / 0)。没有固定时钟,不测凌晨 / 新网络提醒(后端测试覆盖)。
test.describe.configure({ mode: 'serial' })

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)

interface TestTeacher {
  id: string
  loginName: string
}
const created: TestTeacher[] = []

/** 登录第一步(不处理两步验证):返回原始响应体。 */
async function rawLogin(request: APIRequestContext, loginName: string, password: string) {
  const res = await request.post(`${API}/auth/login`, {
    data: { login_name: loginName, password },
  })
  return { status: res.status(), body: (await res.json()) as Record<string, unknown> }
}

/** 信息中心建一个虚构老师:临时密码登录 → 改密码 → 分到三年一班(语文)。返回账号。 */
async function createTeacher(request: APIRequestContext): Promise<TestTeacher> {
  const it = await login(request, 'itadmin01')
  const loginName = `e2e_sec_${uniq()}`
  const res = await request.post(`${API}/admin/accounts`, {
    headers: auth(it),
    data: {
      login_name: loginName,
      display_name: '安全测试老师',
      phone: null,
      employee_no: null,
      subjects: ['语文'],
    },
  })
  expect(res.status(), await res.text()).toBe(201)
  const { account, temp_password } = (await res.json()) as {
    account: { id: string }
    temp_password: string
  }
  const teacher = { id: account.id, loginName }
  created.push(teacher)
  const first = await rawLogin(request, loginName, temp_password)
  expect(first.status).toBe(200)
  const changed = await request.post(`${API}/auth/password`, {
    headers: auth(first.body.access_token as string),
    data: {
      old_password: temp_password,
      new_password: PASSWORD,
      refresh_token: first.body.refresh_token,
    },
  })
  expect(changed.ok(), await changed.text()).toBeTruthy()
  const assign = await request.post(`${API}/admin/classes/${CLASS_3_1}/staff`, {
    headers: auth(it),
    data: { user_id: account.id, identity: 'subject', subject: '语文' },
  })
  expect(assign.ok(), await assign.text()).toBeTruthy()
  return teacher
}

async function putSecurity(request: APIRequestContext, body: typeof DEFAULT_SECURITY) {
  const principal = await login(request, 'principal01')
  const res = await request.put(`${API}/admin/settings/security`, {
    headers: auth(principal),
    data: body,
  })
  expect(res.ok(), await res.text()).toBeTruthy()
}

async function cleanup(request: APIRequestContext) {
  await putSecurity(request, DEFAULT_SECURITY)
  const it = await login(request, 'itadmin01')
  for (const t of created.splice(0)) {
    await endStaffOfUser(request, it, CLASS_3_1, t.id)
    const res = await request.post(`${API}/admin/accounts/${t.id}/freeze`, { headers: auth(it) })
    expect([200, 409]).toContain(res.status())
  }
}
test.beforeEach(({ request }) => cleanup(request))
test.afterEach(({ request }) => cleanup(request))

/** 第一步:填登录名与密码并提交,不等待跳转(两步验证账号会停在登录页的第二步)。 */
async function submitCredentials(page: Page, name: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: /登录/ }).click()
}

async function signIn(page: Page, name: string, password = PASSWORD) {
  await submitCredentials(page, name, password)
  await page.waitForURL((u) => !u.pathname.startsWith('/login'))
}

async function newSession(browser: Browser) {
  const ctx = await browser.newContext({ baseURL: BASE_URL })
  return { ctx, page: await ctx.newPage() }
}

async function openAccountMenu(page: Page, item: '账号安全' | '修改密码' | '退出登录') {
  await page.getByRole('button', { name: '账号菜单' }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

/** 手机里的验证器:取页面上显示的密钥(去掉分组空格)。 */
async function readSecret(page: Page): Promise<string> {
  const text = await page
    .getByRole('dialog', { name: '账号安全' })
    .locator('code')
    .first()
    .innerText()
  return text.replace(/\s+/g, '')
}

/** 浏览器里按真实协议握手,返回服务端关闭码(4401 = 未通过鉴权)。 */
async function wsCloseCode(page: Page, token: string): Promise<number> {
  await page.goto('/login')
  return page.evaluate(
    (t) =>
      new Promise<number>((resolve, reject) => {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws'
        const ws = new WebSocket(`${proto}://${location.host}/api/v1/ws`)
        const timer = setTimeout(() => reject(new Error('ws 超时')), 8000)
        ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: t }))
        ws.onmessage = (m) => {
          clearTimeout(timer)
          reject(new Error(`未通过鉴权却收到消息:${String(m.data)}`))
        }
        ws.onclose = (e) => {
          clearTimeout(timer)
          resolve(e.code)
        }
      }),
    token,
  )
}

test('two-step verification: enable needs the password, login needs the code, it admin can reset', async ({
  page,
  browser,
  request,
}) => {
  const teacher = await createTeacher(request)

  // 校长在学校设置里允许两步验证
  await signIn(page, 'principal01', 'dev123')
  await page.goto('/admin/settings')
  const card = page.getByRole('group', { name: '账号安全' })
  await card.getByRole('switch', { name: '允许账号开启两步验证' }).check()
  const saved = page.waitForResponse(
    (r) => r.url().includes('/admin/settings/security') && r.request().method() === 'PUT',
  )
  await card.getByRole('button', { name: '保存安全设置', exact: true }).click()
  expect((await saved).ok()).toBeTruthy()

  // 老师开启:密码错 → "密码不正确"(K1/K2 与真实后端联调),随后密码对 → 开启
  const t1 = await newSession(browser)
  await signIn(t1.page, teacher.loginName)
  await openAccountMenu(t1.page, '账号安全')
  const dialog = t1.page.getByRole('dialog', { name: '账号安全' })
  await dialog.getByRole('button', { name: '开启', exact: true }).click()
  await expect(dialog.getByRole('img', { name: '两步验证二维码' })).toBeVisible()
  const secret = await readSecret(t1.page)
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/)

  await dialog.getByLabel('验证码', { exact: true }).fill(totpCode(secret, Date.now(), -1))
  await dialog.getByLabel('当前密码').fill('Wrong-pass-0')
  await dialog.getByRole('button', { name: '确认开启', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('密码不正确')
  await expect(dialog.getByRole('button', { name: '确认开启', exact: true })).toBeDisabled() // 密码已清空
  await dialog.getByLabel('当前密码').fill(PASSWORD)
  await dialog.getByRole('button', { name: '确认开启', exact: true }).click()
  await expect(dialog.getByText('已开启', { exact: true })).toBeVisible()
  await t1.page.keyboard.press('Escape')

  // 登出后再登录:第一步通过只出现第二步,没有任何令牌
  await openAccountMenu(t1.page, '退出登录')
  await expect(t1.page).toHaveURL(/\/login/)
  await submitCredentials(t1.page, teacher.loginName, PASSWORD)
  await expect(t1.page.getByRole('heading', { name: '两步验证' })).toBeVisible()
  const stored = await t1.page.evaluate(() => localStorage.getItem('ws-auth'))
  expect(stored === null || !/"accessToken":"[^"]+"/.test(stored)).toBeTruthy()
  // 输错一次码:提示、不进入
  await t1.page.getByLabel('验证码', { exact: true }).fill(totpCode(secret, Date.now(), 10))
  await expect(t1.page.getByRole('alert')).toContainText('验证码不正确')
  await expect(t1.page).toHaveURL(/\/login/)

  // "密码对但没过第二步"的每一条路:HTTP、刷新、WebSocket 都拿不到会话
  const step1 = await rawLogin(request, teacher.loginName, PASSWORD)
  expect(step1.status).toBe(200)
  expect(step1.body.mfa_required).toBe(true)
  expect(step1.body).not.toHaveProperty('access_token')
  expect(step1.body).not.toHaveProperty('refresh_token')
  const mfaToken = step1.body.mfa_token as string
  const asBearer = await request.get(`${API}/auth/me`, { headers: auth(mfaToken) })
  expect(asBearer.status()).toBe(401)
  const asRefresh = await request.post(`${API}/auth/refresh`, { data: { refresh_token: mfaToken } })
  expect(asRefresh.status()).toBe(401)
  expect(await wsCloseCode(t1.page, mfaToken)).toBe(4401)

  // 输对码进入教师端
  await submitCredentials(t1.page, teacher.loginName, PASSWORD)
  await t1.page.getByLabel('验证码', { exact: true }).fill(totpCode(secret, Date.now(), 1))
  await t1.page.waitForURL(/\/teacher/)
  await expect(t1.page.getByRole('heading', { name: '三年一班' })).toBeVisible()

  // 信息中心在账号列表重置两步验证 → 再登录只要密码
  const it = await newSession(browser)
  await signIn(it.page, 'itadmin01', 'dev123')
  await it.page.goto('/admin/accounts')
  await it.page.getByLabel('搜索姓名或登录名').fill(teacher.loginName)
  const row = it.page.getByRole('row').filter({ hasText: teacher.loginName })
  await row.getByRole('button', { name: '重置两步验证', exact: true }).click()
  const resetDone = it.page.waitForResponse(
    (r) => r.url().includes('/totp-reset') && r.request().method() === 'POST',
  )
  await it.page.getByRole('button', { name: '确认重置', exact: true }).click()
  expect((await resetDone).ok()).toBeTruthy()
  await expect(row.getByRole('button', { name: '重置两步验证', exact: true })).toHaveCount(0)
  const again = await rawLogin(request, teacher.loginName, PASSWORD)
  expect(again.body).toHaveProperty('access_token')
  expect(again.body).not.toHaveProperty('mfa_required')

  await t1.ctx.close()
  await it.ctx.close()
})

test('login logs list wrong-password and successful logins, filtered by result', async ({
  page,
  request,
}) => {
  const teacher = await createTeacher(request)
  const bad = await rawLogin(request, teacher.loginName, 'Wrong-pass-0')
  expect(bad.status).toBe(401)
  const ok = await rawLogin(request, teacher.loginName, PASSWORD)
  expect(ok.status).toBe(200)

  await signIn(page, 'itadmin01', 'dev123')
  await page.goto('/admin/login-logs')
  await expect(page.getByRole('heading', { name: '登录日志' })).toBeVisible()
  // 默认区间按浏览器时区算"今天"(D-7),与学校时区不同(CI 在 UTC、本机在别的时区)时会漏掉今天的行:显式放宽到前后各两天
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
  await page.getByLabel('开始日期').fill(day(-2))
  await page.getByLabel('结束日期').fill(day(2))
  await page.getByLabel('搜索登录名或姓名').fill(teacher.loginName)
  const rows = page.getByRole('row').filter({ hasText: teacher.loginName })
  await expect(rows.filter({ hasText: '密码错误' })).toHaveCount(1)
  await expect(rows.filter({ hasText: '成功' }).first()).toBeVisible()

  const fieldset = page.getByRole('group', { name: '结果' })
  await fieldset.getByLabel('密码错误', { exact: true }).check()
  await expect(rows.filter({ hasText: '密码错误' })).toHaveCount(1)
  await expect(rows.filter({ hasText: '成功' })).toHaveCount(0)
  await fieldset.getByLabel('密码错误', { exact: true }).uncheck()
  await fieldset.getByLabel('成功', { exact: true }).check()
  await expect(rows.filter({ hasText: '密码错误' })).toHaveCount(0)
  await expect(rows.filter({ hasText: '成功' }).first()).toBeVisible()
})

test('changing the password keeps this session and signs other sessions out', async ({
  browser,
  request,
}) => {
  const teacher = await createTeacher(request)
  const a = await newSession(browser)
  const b = await newSession(browser)
  await signIn(a.page, teacher.loginName)
  await signIn(b.page, teacher.loginName)
  await expect(a.page.getByRole('heading', { name: '三年一班' })).toBeVisible()
  await expect(b.page.getByRole('heading', { name: '三年一班' })).toBeVisible()

  await openAccountMenu(a.page, '修改密码')
  const dialog = a.page.getByRole('dialog', { name: '修改密码' })
  await dialog.getByLabel('旧密码').fill(PASSWORD)
  await dialog.getByLabel('新密码', { exact: true }).fill('E2e-pass-2027')
  await dialog.getByLabel('确认新密码').fill('E2e-pass-2027')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toBeHidden()

  // 改密码的会话不掉线:仍在教室页、能继续操作
  await expect(a.page).toHaveURL(/\/teacher/)
  await a.page.locator('[data-seat]').first().click()
  await expect(a.page.getByRole('dialog')).toBeVisible()

  // 另一个会话不刷新就回到登录页
  await expect(b.page).toHaveURL(/\/login/, { timeout: 20_000 })

  await a.ctx.close()
  await b.ctx.close()
})

test('admin reset password signs the teacher out and voids the old access token', async ({
  browser,
  request,
}) => {
  const teacher = await createTeacher(request)
  const it = await login(request, 'itadmin01')
  const t = await newSession(browser)
  await signIn(t.page, teacher.loginName)
  await expect(t.page.getByRole('heading', { name: '三年一班' })).toBeVisible()
  const old = await rawLogin(request, teacher.loginName, PASSWORD)
  const oldToken = old.body.access_token as string
  expect((await request.get(`${API}/auth/me`, { headers: auth(oldToken) })).status()).toBe(200)

  // 令牌 iat 与改密时间都取整到秒,同一秒内签发的放行(R6):隔开一整秒再重置,否则断言会随时钟抖动
  await new Promise((r) => setTimeout(r, 1100))
  const reset = await request.post(`${API}/admin/accounts/${teacher.id}/reset-password`, {
    headers: auth(it),
  })
  expect(reset.ok(), await reset.text()).toBeTruthy()

  await expect(t.page).toHaveURL(/\/login/, { timeout: 20_000 })
  // 重置之前签发的 access 令牌不再可用(不是 200)
  const after = await request.get(`${API}/auth/me`, { headers: auth(oldToken) })
  expect([401, 403]).toContain(after.status())
  const rows = await adminGet<{ items: { id: string }[] }>(
    request,
    it,
    `/admin/accounts?q=${teacher.loginName}`,
  )
  expect(rows.items.map((i) => i.id)).toContain(teacher.id)
  await t.ctx.close()
})

test('school password length: 11 characters rejected at 12, 12 accepted, then restored to 8', async ({
  browser,
  request,
}) => {
  const teacher = await createTeacher(request)
  const principal = await newSession(browser)
  await signIn(principal.page, 'principal01', 'dev123')
  await principal.page.goto('/admin/settings')
  const card = principal.page.getByRole('group', { name: '账号安全' })
  await card.getByLabel('密码最短长度').fill('12')
  const saved = principal.page.waitForResponse(
    (r) => r.url().includes('/admin/settings/security') && r.request().method() === 'PUT',
  )
  await card.getByRole('button', { name: '保存安全设置', exact: true }).click()
  expect((await saved).ok()).toBeTruthy()

  const t = await newSession(browser)
  await signIn(t.page, teacher.loginName)
  await openAccountMenu(t.page, '修改密码')
  const dialog = t.page.getByRole('dialog', { name: '修改密码' })
  await expect(dialog.getByText(/至少 12 位/)).toBeVisible()
  const fill = async (next: string) => {
    await dialog.getByLabel('旧密码').fill(PASSWORD)
    await dialog.getByLabel('新密码', { exact: true }).fill(next)
    await dialog.getByLabel('确认新密码').fill(next)
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
  }
  await fill('E2e-pass-1') // 11 位
  await expect(dialog.getByRole('alert')).toContainText('12')
  await expect(dialog).toBeVisible()
  await fill('E2e-pass-12a') // 12 位
  await expect(dialog).toBeHidden()

  // 还原为默认 8(afterEach 兜底),并确认新值已生效
  await putSecurity(request, DEFAULT_SECURITY)
  const policy = await adminGet<{ min_length: number }>(
    request,
    await login(request, 'principal01'),
    '/auth/password-policy',
  )
  expect(policy.min_length).toBe(8)
  await principal.ctx.close()
  await t.ctx.close()
})
