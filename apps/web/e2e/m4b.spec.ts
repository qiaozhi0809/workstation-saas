import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { adminGet, login, studentRecord } from './helpers/api'

const API = '/api/v1'
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
const CLASS_3_2 = '44444444-4444-4444-4444-444444444444' // 三年二班:teacher01,王小一(S0001)/ 张小三(S0003)…
const LI_PARENT = '13800000061' // 李家长:王小一(三年二班)与魏小七(四年一班)的主家长
const ZHOU_PARENT = '13800000062' // 周家长:王小一的次要家长

// 本文件的用例各自准备并还原自己的数据。通知只能撤回不能删:留在库里的都是"已撤回"。
// 用例 5 建的家长账号解绑后被归档,留在库里;每次跑用不同的虚构手机号,重复跑不会撞号。
test.describe.configure({ mode: 'serial' })

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)

async function signIn(page: Page, name: string, password = 'dev123') {
  await page.goto('/login')
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: /登录/ }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login')) // 登录完成再跳转,不然 goto 会打断登录请求
}

/** 手机视口(375 × 812)里的新上下文;调用方负责关闭。 */
async function phoneContext(browser: Browser) {
  const ctx = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 375, height: 812 } })
  return { ctx, page: await ctx.newPage() }
}

interface InboxItemLite { id: string; title: string; recalled: boolean; can_ack: boolean }

async function inboxOf(request: APIRequestContext, token: string): Promise<InboxItemLite[]> {
  return (await adminGet<{ items: InboxItemLite[] }>(request, token, '/notices?page=1')).items
}

/** 经接口发班级公告(家长对象),返回通知 id。 */
async function sendClassNotice(
  request: APIRequestContext, token: string, data: Record<string, unknown>,
): Promise<string> {
  const res = await request.post(`${API}/classes/${CLASS_3_2}/notices`, { headers: auth(token), data })
  expect(res.ok(), await res.text()).toBeTruthy()
  return ((await res.json()) as { id: string }).id
}

/** 撤回某老师在三年二班发出的、标题带指定前缀且未撤回的班级公告(兜底清理;没有就什么也不做)。 */
async function recallClassNotices(request: APIRequestContext, token: string, titlePart: string) {
  const list = await adminGet<{ items: { id: string; title: string; recalled_at: string | null }[] }>(
    request, token, `/classes/${CLASS_3_2}/notices?page=1`,
  )
  for (const n of list.items.filter((x) => x.title.includes(titlePart) && !x.recalled_at)) {
    const res = await request.post(`${API}/classes/${CLASS_3_2}/notices/${n.id}/recall`, { headers: auth(token) })
    expect(res.ok(), await res.text()).toBeTruthy()
  }
}

/** 撤回校长 / 年级组长发出的、标题带指定前缀且未撤回的通知(兜底清理)。 */
async function recallAdminNotices(request: APIRequestContext, token: string, titlePart: string) {
  const list = await adminGet<{ items: { id: string; title: string; recalled_at: string | null }[] }>(
    request, token, '/admin/notices?page=1',
  )
  for (const n of list.items.filter((x) => x.title.includes(titlePart) && !x.recalled_at)) {
    const res = await request.post(`${API}/admin/notices/${n.id}/recall`, { headers: auth(token) })
    expect(res.ok(), await res.text()).toBeTruthy()
  }
}

/** 家长端底部"通知"页签上的未读数(页签没有数字徽标时为 0)。 */
async function parentUnread(page: Page): Promise<number> {
  const text = (await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: /通知/ }).textContent()) ?? ''
  return Number(/(\d+) 条未读/.exec(text)?.[1] ?? 0)
}

test('class notice reaches an open parent phone without refresh; the parent acks, the teacher sees and exports it', async ({ page, browser, request }) => {
  const title = `E2E周五家长会${uniq()}`
  const teacher = await login(request, 'teacher01')
  const { ctx, page: mobile } = await phoneContext(browser)
  try {
    await signIn(mobile, LI_PARENT)
    await expect(mobile).toHaveURL(/\/parent\/today/)
    await mobile.waitForLoadState('networkidle') // 收件箱取回之前徽标是 0,等它取回再读基数
    const before = await parentUnread(mobile)

    // 班主任写一条单选 + 允许留言的公告
    await signIn(page, 'teacher01')
    await page.goto('/teacher/notices')
    await expect(page.getByRole('heading', { name: '班级公告' })).toBeVisible()
    await page.getByLabel('标题', { exact: true }).fill(title)
    await page.getByLabel('正文').fill('本周五下午三点在教室开家长会,请回复是否参加。')
    await page.getByRole('radio', { name: '单选' }).check()
    await page.getByLabel('选项 1').fill('参加')
    await page.getByLabel('选项 2').fill('不参加')
    await page.getByLabel('允许留言').check()
    // toast 只停几秒:在点"发送"之前就开始等,不要等推送到了才开始看
    await Promise.all([
      expect(mobile.getByText(`新通知:${title}`)).toBeVisible(),
      page.getByRole('button', { name: '发送', exact: true }).click(),
    ])
    // 家长页面不刷新:"通知"页签的徽标 +1
    await expect.poll(() => parentUnread(mobile)).toBe(before + 1)

    // 家长打开通知页 → 展开 → 选"参加"并留言
    await mobile.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: /通知/ }).click()
    await expect(mobile).toHaveURL(/\/parent\/notices/)
    await mobile.getByRole('button', { name: new RegExp(title) }).click()
    await mobile.getByRole('radio', { name: '参加', exact: true }).check()
    await mobile.getByLabel('留言').fill('我会准时到')
    await mobile.getByRole('button', { name: '提交回执' }).click()
    await expect(mobile.getByText(/已回执:参加/)).toBeVisible()

    // 班主任的统计里王小一一行是"参加(我会准时到)",并能导出 CSV
    await page.getByRole('button', { name: `查看回执 ${title}` }).click()
    const dialog = page.getByRole('dialog', { name: '回执统计' })
    const row = dialog.getByRole('row').filter({ hasText: '王小一' })
    await expect(row).toContainText('参加(我会准时到)')
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '导出 CSV' }).click()])
    expect(download.suggestedFilename()).toMatch(/^回执名单-.+\.csv$/)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // 家长改成"不参加"(留言清空)→ 统计随之变化
    await mobile.getByRole('button', { name: '修改' }).click()
    await mobile.getByRole('radio', { name: '不参加' }).check()
    await mobile.getByLabel('留言').fill('')
    await mobile.getByRole('button', { name: '提交回执' }).click()
    await expect(mobile.getByText(/已回执:不参加/)).toBeVisible()
    // 统计弹窗的查询沿用全局 staleTime 30 秒,重开会先显示缓存(见 G-1):刷新页面再看新数据
    await page.reload()
    await page.getByRole('button', { name: `查看回执 ${title}` }).click()
    const again = page.getByRole('dialog', { name: '回执统计' })
    await expect(again.getByRole('row').filter({ hasText: '王小一' })).toContainText('不参加')
    await expect(again.getByRole('row').filter({ hasText: '王小一' })).not.toContainText('参加(')
  } finally {
    await ctx.close()
    await recallClassNotices(request, teacher, title)
  }
})

test('principal sends to grade-3 parents: only the primary parent of a grade-3 child gets it; a grade head has no school-wide option', async ({ page, browser, request }) => {
  const title = `E2E三年级家长${uniq()}`
  const principal = await login(request, 'principal01')
  try {
    await signIn(page, 'principal01')
    await expect(page).toHaveURL(/\/admin\/today/)
    await page.goto('/admin/notices')
    await page.getByLabel('标题').fill(title)
    await page.getByLabel('正文').fill('三年级家长请注意:下周一上午统一领取课本。')
    await page.getByRole('radio', { name: '发给家长' }).check()
    await page.getByLabel('发给', { exact: true }).selectOption({ label: '某个年级' })
    await page.getByLabel('年级', { exact: true }).selectOption({ label: '三年级' })
    await page.getByRole('radio', { name: '已知晓' }).check()
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByText('确认发给 三年级家长?')).toBeVisible()
    await page.getByRole('button', { name: '确认发送' }).click()
    await expect(page.getByRole('status').filter({ hasText: /已发给 \d+ 人/ })).toBeVisible()

    // 李家长(王小一的主家长,三年级)收到并且可以回执;周家长是次要家长,收不到
    const li = await login(request, LI_PARENT)
    const zhou = await login(request, ZHOU_PARENT)
    const got = (await inboxOf(request, li)).find((n) => n.title === title)
    expect(got, '主家长应当收到').toBeTruthy()
    expect(got!.can_ack).toBe(true)
    expect((await inboxOf(request, zhou)).some((n) => n.title === title), '次要家长不应收到').toBe(false)

    // 年级组长的对象里没有"全校家长"
    const ctx = await browser.newContext({ baseURL: BASE_URL })
    const head = await ctx.newPage()
    try {
      await signIn(head, 'gradehead03')
      await head.goto('/admin/notices')
      await head.getByRole('radio', { name: '发给家长' }).check()
      const kinds = await head.getByLabel('发给', { exact: true }).locator('option').allTextContents()
      expect(kinds).toContain('某个年级')
      expect(kinds).not.toContain('全校家长')
    } finally {
      await ctx.close()
    }
  } finally {
    await recallAdminNotices(request, principal, title)
  }
})

test('a notice past its deadline shows "已截止" and a recalled one shows "此通知已撤回" on the parent phone', async ({ browser, request }) => {
  // 契约要求截止时间晚于现在,且没有改截止的接口:发一条几秒后截止的,等它过期再刷新
  const deadlineTitle = `E2E截止${uniq()}`
  const recallTitle = `E2E撤回${uniq()}`
  const teacher = await login(request, 'teacher01')
  const { ctx, page: mobile } = await phoneContext(browser)
  try {
    const deadline = new Date(Date.now() + 7_000).toISOString()
    await sendClassNotice(request, teacher, {
      title: deadlineTitle, content: '请在截止前回执。', ack: { kind: 'confirm' }, ack_deadline: deadline,
    })
    const recallId = await sendClassNotice(request, teacher, { title: recallTitle, content: '这条马上撤回。' })

    await signIn(mobile, LI_PARENT)
    await mobile.goto('/parent/notices')
    await expect(mobile.getByRole('button', { name: new RegExp(deadlineTitle) })).toBeVisible()
    await expect(mobile.getByRole('button', { name: new RegExp(recallTitle) })).toBeVisible()

    // 撤回:家长页面不刷新,这条变成"此通知已撤回"
    const res = await request.post(`${API}/classes/${CLASS_3_2}/notices/${recallId}/recall`, { headers: auth(teacher) })
    expect(res.ok(), await res.text()).toBeTruthy()
    await expect(mobile.getByRole('button', { name: new RegExp(recallTitle) }).getByText('此通知已撤回')).toBeVisible()

    // 截止:等过了截止时间再刷新(can_ack 由后端按服务器时间给出),展开后显示"已截止"、没有"已知晓"按钮
    await expect.poll(() => Date.now(), { timeout: 15_000 }).toBeGreaterThan(Date.parse(deadline) + 2_000)
    await mobile.reload()
    await mobile.getByRole('button', { name: new RegExp(deadlineTitle) }).click()
    await expect(mobile.getByText('已截止', { exact: true })).toBeVisible()
    await expect(mobile.getByRole('button', { name: '已知晓' })).toHaveCount(0)
  } finally {
    await ctx.close()
    await recallClassNotices(request, teacher, 'E2E截止')
    await recallClassNotices(request, teacher, 'E2E撤回')
  }
})

test('a teacher acks a school-wide staff notice from the bell and the principal sees the count go up', async ({ page, browser, request }) => {
  const title = `E2E教师回执${uniq()}`
  const principal = await login(request, 'principal01')
  const teacherCtx = await browser.newContext({ baseURL: BASE_URL })
  const teacher = await teacherCtx.newPage()
  try {
    const res = await request.post(`${API}/admin/notices`, {
      headers: auth(principal),
      data: { title, content: '请各位老师确认已阅。', target: { kind: 'school' }, audience: 'teachers', ack: { kind: 'confirm' } },
    })
    expect(res.ok(), await res.text()).toBeTruthy()
    const { id } = (await res.json()) as { id: string }

    await signIn(teacher, 'teacher01')
    await expect(teacher.getByRole('heading', { name: '三年二班' })).toBeVisible()
    await teacher.getByRole('button', { name: /^通知,\d+ 条未读$/ }).click()
    await teacher.getByRole('button', { name: new RegExp(title) }).click()
    await teacher.getByRole('button', { name: '已知晓', exact: true }).click()
    await expect(teacher.getByText(/已回执:已知晓/)).toBeVisible()

    // 校长的"我发出的":回执 1 / N;统计接口里 acked = 1
    await signIn(page, 'principal01')
    await page.goto('/admin/notices')
    const sent = page.getByRole('region', { name: '我发出的' }).getByRole('listitem').filter({ hasText: title })
    await expect(sent.getByText(/^回执 1 \/ \d+$/)).toBeVisible()
    const stats = await adminGet<{ acked: number }>(request, principal, `/notices/${id}/acks`)
    expect(stats.acked).toBe(1)
  } finally {
    await teacherCtx.close()
    await recallAdminNotices(request, principal, title)
  }
})

test('unlinking a parent whose only child it was logs the open parent page out without a refresh', async ({ browser, request }) => {
  // 139 号段:种子与其他用例只用 138 / 199,随机号不会撞上已有账号;不用种子家长(归档后同号再加会 409,种子还原不了)
  const phone = `13900${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`
  const teacher = await login(request, 'teacher01')
  const zhang = await studentRecord(request, teacher, CLASS_3_2, '张小三')
  let linkId: string | null = null
  const { ctx, page: mobile } = await phoneContext(browser)
  try {
    const created = await request.post(`${API}/students/${zhang.student_id}/parents`, {
      headers: auth(teacher), data: { phone, name: 'E2E实时家长', relation: '其他' },
    })
    expect(created.ok(), await created.text()).toBeTruthy()
    const body = (await created.json()) as { parent: { link_id: string }; temp_password: string }
    linkId = body.parent.link_id
    const temp = body.temp_password
    expect(temp, '新账号应当带一次性临时密码').toBeTruthy()

    await signIn(mobile, phone, temp)
    await expect(mobile.getByRole('heading', { name: '首次登录请先修改密码' })).toBeVisible()
    await mobile.getByLabel('旧密码').fill(temp)
    await mobile.getByLabel('新密码', { exact: true }).fill('E2e-pass-2026')
    await mobile.getByLabel('确认新密码').fill('E2e-pass-2026')
    await mobile.getByRole('button', { name: '保存' }).click()
    await expect(mobile).toHaveURL(/\/parent\/today/)
    await mobile.waitForLoadState('networkidle') // 等实时连接建立

    // 解绑:这是他唯一的孩子,账号归档 → 页面不刷新就回到登录页
    const del = await request.delete(`${API}/parent-links/${linkId}`, { headers: auth(teacher) })
    expect(del.ok(), await del.text()).toBeTruthy()
    linkId = null
    await expect(mobile).toHaveURL(/\/login/)
  } finally {
    await ctx.close()
    if (linkId) await request.delete(`${API}/parent-links/${linkId}`, { headers: auth(teacher) })
  }
})
