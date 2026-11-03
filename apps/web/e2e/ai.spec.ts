import { expect, test, type Page } from '@playwright/test'
import { login, restoreAiData, snapshotAiData, type AiDataSnapshot } from './helpers/api'

const CLASS_ID = '44444444-4444-4444-4444-444444444444'
const FAKE_LLM = 'http://127.0.0.1:18089'

async function signIn(page: Page, name = 'teacher01') {
  await page.goto('/login')
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill('dev123')
  await page.getByRole('button', { name: /登录/ }).click()
  await expect(page.getByRole('heading', { name: '三年二班' })).toBeVisible()
}

// 本文件的用例会产生 AI 对话、评语、成长记录:用例前取快照、用例后(含失败)删掉新增的,可重复跑。
// 假服务商 fakeLlm.mjs 由外部起在 18089(CI 与本地都要先起),这里只清空它记下的最近请求。
let before: AiDataSnapshot
test.beforeEach(async ({ request }) => {
  const token = await login(request, 'teacher01')
  before = await snapshotAiData(request, token, CLASS_ID)
  await request.post(`${FAKE_LLM}/reset`)
})
test.afterEach(async ({ request }) => {
  const token = await login(request, 'teacher01')
  await restoreAiData(request, [token], CLASS_ID, before)
})

const templateCard = (page: Page, title: string) => page.getByRole('button', { name: new RegExp(title) })

/** 首页发一句自由对话,等跳到对话页。 */
async function chatFreely(page: Page, text: string) {
  await page.goto('/teacher/ai')
  await page.getByRole('textbox', { name: '要做什么' }).fill(text)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page).toHaveURL(/\/teacher\/ai\/[0-9a-f-]{36}/)
}

test('parent template streams real names and never sends them', async ({ page, request }) => {
  await signIn(page)
  await page.goto('/teacher/ai')
  await templateCard(page, '家长沟通话术').click()
  const form = page.getByRole('dialog', { name: '家长沟通话术' })
  await form.getByLabel('学生', { exact: true }).selectOption({ label: '王小一' })
  await form.getByRole('button', { name: '开始生成' }).click()

  await expect(page.getByText('王小一这学期进步很大')).toBeVisible()
  const sent = JSON.stringify(await (await request.get(`${FAKE_LLM}/last`)).json())
  expect(sent).not.toContain('王小一')
  expect(sent).toMatch(/【学生\d{2}】/)
})

test('copy prompt shows the code table', async ({ page }) => {
  await signIn(page)
  await page.goto('/teacher/ai')
  await templateCard(page, '家长沟通话术').click()
  const form = page.getByRole('dialog', { name: '家长沟通话术' })
  await form.getByLabel('学生', { exact: true }).selectOption({ label: '王小一' })
  await form.getByRole('button', { name: '复制提示词', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: '复制提示词' })
  await expect(dialog.getByRole('textbox', { name: '提示词内容' })).toBeVisible()
  await dialog.getByText('编号对照表').click()
  await expect(dialog.getByText(/【学生\d{2}】 王小一/)).toBeVisible()
})

test('profile shortcut writes a comment and saves it to the profile', async ({ page }) => {
  await signIn(page)
  await page.goto('/teacher/students')
  await page.getByRole('button', { name: '王小一', exact: true }).click()
  await page.getByRole('tab', { name: '评语' }).click()
  await page.getByRole('button', { name: 'AI 生成' }).click()

  const form = page.getByRole('dialog', { name: '个人评语' })
  await expect(form.getByLabel('学生', { exact: true }).locator('option:checked')).toHaveText('王小一')
  await form.getByRole('button', { name: '开始生成' }).click()
  await expect(page.getByText('王小一这学期进步很大')).toBeVisible()
  await page.getByRole('button', { name: '保存为评语' }).click()
  await expect(page.getByRole('button', { name: '已保存' })).toBeVisible()

  await page.goto('/teacher/students')
  await page.getByRole('button', { name: '王小一', exact: true }).click()
  await page.getByRole('tab', { name: '评语' }).click()
  const card = page.getByRole('listitem').filter({ hasText: '王小一这学期进步很大' })
  await expect(card.getByText('AI 生成', { exact: true })).toBeVisible()
})

test('batch comments for two students and save all', async ({ page, request }) => {
  await signIn(page)
  await page.goto('/teacher/ai')
  await templateCard(page, '期末评语').click()
  const form = page.getByRole('dialog', { name: /期末评语/ })
  const group = form.getByRole('group', { name: '学生' })
  await group.getByRole('checkbox', { name: '王小一' }).check()
  await group.getByRole('checkbox', { name: '李小二' }).check()
  await expect(form.getByText('已选 2 人')).toBeVisible()
  await form.getByRole('button', { name: '开始生成' }).click()

  await expect(page.getByText('完成 2/2')).toBeVisible()
  await page.getByRole('button', { name: '全部保存到档案' }).click()
  await expect(page.getByText('已保存 2 条评语')).toBeVisible()

  const token = await login(request, 'teacher01')
  const roster = await request.get(`/api/v1/classes/${CLASS_ID}/students`, { headers: { Authorization: `Bearer ${token}` } })
  const { items } = (await roster.json()) as { items: { student_id: string; name: string }[] }
  for (const name of ['王小一', '李小二']) {
    const sid = items.find((s) => s.name === name)!.student_id
    const res = await request.get(`/api/v1/students/${sid}/comments`, { headers: { Authorization: `Bearer ${token}` } })
    const list = ((await res.json()) as { items: { id: string; content: string; generated_by_ai: boolean }[] }).items
    expect(list.some((c) => !before.comments.has(c.id) && c.generated_by_ai && c.content.includes(`${name}这学期进步很大`))).toBe(true)
  }
})

test('stop keeps the partial reply', async ({ page }) => {
  await signIn(page)
  await chatFreely(page, '请慢慢写')
  await expect(page.getByText('第 3 段')).toBeVisible()
  await page.getByRole('button', { name: '停止' }).click()
  await expect(page.getByText('(已停止)')).toBeVisible()
  await expect(page.getByText(/第 3 段/)).toBeVisible()
})

test('export to Word downloads a .doc', async ({ page }) => {
  await signIn(page)
  await chatFreely(page, '写一段话')
  await expect(page.getByText('好的,这是草稿。')).toBeVisible()
  await expect(page.getByRole('button', { name: '重新生成' })).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 Word', exact: true }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.doc$/)
})

test('subject teacher sees homeroom templates disabled', async ({ page }) => {
  await signIn(page, 'teacher03')
  await page.goto('/teacher/ai')
  for (const title of ['家长沟通话术', '期末评语']) {
    const card = templateCard(page, title)
    await expect(card).toBeDisabled()
    await expect(card).toContainText('仅班主任可用')
  }
})

test('provider failure shows an error box and survives a retry', async ({ page }) => {
  await signIn(page)
  await chatFreely(page, '这次会出错')
  const box = page.getByTestId('error-box')
  await expect(box).toBeVisible()
  await box.getByRole('button', { name: '重试' }).click()
  await expect(box).toBeVisible()
  await expect(page.getByRole('heading', { name: '三年二班' })).toHaveCount(0)
})
