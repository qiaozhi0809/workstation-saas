import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { clearMyNote, deleteTestStudents, login, restoreSeedSeating, schoolToday, studentRecord } from './helpers/api'

const CLASS_ID = '44444444-4444-4444-4444-444444444444'

async function signIn(page: Page, name = 'teacher01') {
  await page.goto('/login')
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill('dev123')
  await page.getByRole('button', { name: /登录/ }).click()
  await expect(page.getByRole('heading', { name: '三年二班' })).toBeVisible()
}

// 本文件的用例会增删学生(姓名都以 测试 开头)、写个人笔记:每个用例前后兜底删掉 测试* 学生、还原座位、清空王小一的笔记,
// 失败中途退出也不留脏数据。与其他 spec 的隔离由 playwright.config.ts 的 project 依赖链保证。
async function cleanup(request: Parameters<typeof login>[0]) {
  const token = await login(request, 'teacher01')
  await deleteTestStudents(request, token, CLASS_ID)
  await restoreSeedSeating(request, token, CLASS_ID)
  await clearMyNote(request, token, (await studentRecord(request, token, CLASS_ID, '王小一')).student_id)
}
test.beforeEach(({ request }) => cleanup(request))
test.afterEach(({ request }) => cleanup(request))

const rowOf = (page: Page, name: string) => page.locator('tr', { has: page.getByRole('button', { name, exact: true }) })

test('adds, edits and removes a student', async ({ page }) => {
  await signIn(page)
  await page.goto('/teacher/students')
  await page.getByRole('button', { name: '添加学生' }).click()
  const dialog = page.getByRole('dialog', { name: '添加学生' })
  await dialog.getByLabel('姓名', { exact: true }).fill('测试新生')
  await dialog.getByLabel('性别', { exact: true }).selectOption('女')
  await dialog.getByLabel('学号', { exact: true }).fill('2026099')
  await expect(dialog.getByLabel('座位')).toHaveValue('')
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog).toBeHidden()
  const row = rowOf(page, '测试新生')
  await expect(row).toBeVisible()
  await expect(row.getByRole('cell', { name: '2026099', exact: true })).toBeVisible()
  await expect(row.getByRole('cell', { name: '女', exact: true })).toBeVisible()

  // 编辑:改职务
  await row.getByRole('button', { name: '编辑' }).click()
  const edit = page.getByRole('dialog', { name: '编辑学生' })
  await edit.getByLabel('职务').fill('学习委员')
  await edit.getByRole('button', { name: '保存' }).click()
  await expect(edit).toBeHidden()
  await expect(rowOf(page, '测试新生').getByRole('cell', { name: '学习委员', exact: true })).toBeVisible()
  await page.reload()
  await expect(rowOf(page, '测试新生').getByRole('cell', { name: '学习委员', exact: true })).toBeVisible()

  // 删除(确认框)
  await rowOf(page, '测试新生').getByRole('button', { name: '编辑' }).click()
  const edit2 = page.getByRole('dialog', { name: '编辑学生' })
  await edit2.getByRole('button', { name: '删除学生' }).click()
  await page.getByRole('dialog', { name: '删除学生' }).getByRole('button', { name: '确认删除' }).click()
  await expect(page.getByRole('button', { name: '测试新生', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: '王小一', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '测试新生', exact: true })).toHaveCount(0)
})

test('imports two students and exports the roster', async ({ page }) => {
  await signIn(page)
  await page.goto('/teacher/students')
  await page.getByRole('button', { name: '批量导入' }).click()
  const dialog = page.getByRole('dialog', { name: '批量导入学生' })
  await dialog.getByLabel('粘贴名单').fill('姓名\t学号\n测试导入甲\t9\n测试导入乙\t10')
  await expect(dialog.getByText('识别到 2 人')).toBeVisible()
  await dialog.getByRole('checkbox', { name: '自动安排到空座位' }).uncheck()
  // toast 只停留 3 秒(Toast 默认 ms=3000):先建立断言再点导入,不等弹窗关闭之后才去找它
  const imported = expect(page.getByText('导入 2 人,跳过重复 0 人')).toBeVisible()
  await Promise.all([imported, dialog.getByRole('button', { name: '导入', exact: true }).click()])
  await expect(dialog).toBeHidden()
  await expect(rowOf(page, '测试导入甲')).toBeVisible()
  await expect(rowOf(page, '测试导入乙')).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出名单' }).click(),
  ])
  expect(download.suggestedFilename().endsWith('-学生名单.csv')).toBe(true)
  const text = (await readFile((await download.path())!, 'utf8')).replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/).filter(Boolean)
  const header = lines[0].split(',')
  const noCol = header.indexOf('学号')
  expect(noCol).toBeGreaterThanOrEqual(0)
  const nos = lines.slice(1).map((l) => l.split(',')[noCol])
  // 数字顺序:9、10 排在 2026001… 前面(而不是文本顺序 10、2026001…、9)
  expect(nos.slice(0, 2)).toEqual(['9', '10'])
  expect(nos.slice(2)).toEqual(Array.from({ length: 10 }, (_, i) => String(2026001 + i)))
  expect(nos).toHaveLength(12)
})

test('writes a personal note', async ({ page }) => {
  await signIn(page)
  await page.goto('/teacher/students')
  await page.getByRole('button', { name: '王小一', exact: true }).click()
  await page.getByRole('tab', { name: '档案' }).click()
  const note = page.getByRole('textbox', { name: '我的笔记' })
  await note.fill('E2E 笔记:课上很专注')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText(/^已保存 \d+月\d+日/)).toBeVisible()

  // 关闭重开(整页刷新也回到同一档案)仍在
  await page.reload()
  await page.getByRole('tab', { name: '档案' }).click()
  await expect(page.getByRole('textbox', { name: '我的笔记' })).toHaveValue('E2E 笔记:课上很专注')

  // 关闭抽屉 → 重新点开王小一,笔记仍在
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: '我的笔记' })).toBeHidden()
  await page.getByRole('button', { name: '王小一', exact: true }).click()
  await page.getByRole('tab', { name: '档案' }).click()
  await expect(page.getByRole('textbox', { name: '我的笔记' })).toHaveValue('E2E 笔记:课上很专注')
})

test('profile overview shows points, attendance and birthday KPIs', async ({ page, request }) => {
  const token = await login(request, 'teacher01')
  const today = await schoolToday(request, token, CLASS_ID)
  const { birthdate } = await studentRecord(request, token, CLASS_ID, '王小一')

  await signIn(page)
  await page.goto('/teacher/students')
  await page.getByRole('button', { name: '王小一', exact: true }).click()
  const kpis = page.getByRole('group', { name: '概况指标' })
  await expect(kpis.getByText('累计积分', { exact: true })).toBeVisible()
  await expect(kpis.getByText('本月考勤', { exact: true })).toBeVisible()
  await expect(kpis.getByText('生日', { exact: true })).toBeVisible()

  // 种子里王小一有生日;种子漂移(没填)时让测试失败,而不是悄悄早退
  expect(birthdate, '种子里王小一应有生日').toBeTruthy()
  const [, m, d] = birthdate!.split('-').map(Number)
  await expect(kpis.getByText(`${m}月${d}日`, { exact: true })).toBeVisible()
  // 按学校时区的 today 算距离下一个生日的天数
  const [ty, tm, td] = today.split('-').map(Number)
  const utc = (y: number, mo: number, dd: number) => Date.UTC(y, mo - 1, dd)
  let next = utc(ty, m, d)
  if (next < utc(ty, tm, td)) next = utc(ty + 1, m, d)
  const days = Math.round((next - utc(ty, tm, td)) / 86_400_000)
  await expect(kpis.getByText(days === 0 ? '就是今天' : `${days} 天后`, { exact: true })).toBeVisible()
})
