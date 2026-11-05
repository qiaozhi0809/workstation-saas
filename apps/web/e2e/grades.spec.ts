import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  createExam,
  deleteE2eExams,
  login,
  putScores,
  restoreSeedSeating,
  rosterEnrollmentIds,
} from './helpers/api'

const CLASS_ID = '44444444-4444-4444-4444-444444444444'

async function signIn(page: Page, name = 'teacher01') {
  await page.goto('/login')
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill('dev123')
  await page.getByRole('button', { name: /登录/ }).click()
  await expect(page.getByRole('heading', { name: '三年二班' })).toBeVisible()
}

async function switchMode(page: Page, name: string) {
  const tab = page.getByRole('tab', { name })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}

// 本文件的用例会建 / 删考试(名字都以 E2E 开头)并可能动座位:每个用例前后兜底删掉 E2E 考试、还原座位,
// 失败中途退出也不留脏数据。与其他 spec 的隔离由 playwright.config.ts 的 project 依赖链保证。
test.beforeEach(async ({ request }) => {
  const token = await login(request, 'teacher01')
  await deleteE2eExams(request, token, CLASS_ID)
  await restoreSeedSeating(request, token, CLASS_ID)
})
test.afterEach(async ({ request }) => {
  const token = await login(request, 'teacher01')
  await deleteE2eExams(request, token, CLASS_ID)
  await restoreSeedSeating(request, token, CLASS_ID)
})

const cell = (page: Page, name: string, subject: string) =>
  page.getByRole('textbox', { name: `${name} ${subject}`, exact: true })
const rowOf = (page: Page, name: string) =>
  page.locator('tr', { has: page.getByRole('cell', { name, exact: true }) })

// 在聚焦的格子上派发粘贴事件(格子的 onPaste 读 clipboardData),不依赖系统剪贴板权限
async function paste(target: Locator, text: string) {
  await target.focus()
  await target.evaluate((el, t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    )
  }, text)
}

test('homeroom teacher creates an exam, types and pastes scores, and sees totals', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/teacher/scores')
  await page.getByRole('button', { name: '新建考试' }).click()
  const dialog = page.getByRole('dialog', { name: '新建考试' })
  await dialog.getByLabel('考试名称').fill('E2E 单元测')
  const subjects = dialog.getByRole('group', { name: '科目' })
  for (const s of ['英语', '科学', '道法'])
    await subjects.getByRole('button', { name: s, exact: true }).click()
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { name: 'E2E 单元测' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /^语文/ })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /^数学/ })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /^英语/ })).toHaveCount(0)

  // 状态文字"已保存"在新改动排队时不会清掉,不能当作"所有改动都已落库";改为按 PUT 响应等待
  const scoresSaved = () =>
    page.waitForResponse(
      (r) => r.request().method() === 'PUT' && /\/scores$/.test(r.url()) && r.ok(),
    )

  // 输入 95 + Enter:焦点落到下一行同一科;等这次保存落库,粘贴才会是独立的一次保存
  const typedSaved = scoresSaved()
  await cell(page, '王小一', '语文').fill('95')
  await page.keyboard.press('Enter')
  await expect(cell(page, '李小二', '语文')).toBeFocused()
  await typedSaved

  // 粘贴:空行保留(张小三不变),缺考写进下一行
  const pastedSaved = scoresSaved()
  await paste(cell(page, '李小二', '语文'), '90\t80\n\n缺考\t70')
  await expect(cell(page, '李小二', '语文')).toHaveValue('90')
  await expect(cell(page, '李小二', '数学')).toHaveValue('80')
  await expect(cell(page, '张小三', '语文')).toHaveValue('')
  await expect(cell(page, '张小三', '数学')).toHaveValue('')
  await expect(cell(page, '赵小四', '语文')).toHaveValue('缺考')
  await expect(cell(page, '赵小四', '数学')).toHaveValue('70')
  await pastedSaved
  await expect(page.getByRole('status').getByText('已保存')).toBeVisible()

  // 刷新后仍在,总分 / 排名跟着更新(缺考不计分:赵小四总分 70)
  await page.reload()
  await expect(cell(page, '王小一', '语文')).toHaveValue('95')
  await expect(cell(page, '李小二', '语文')).toHaveValue('90')
  await expect(cell(page, '赵小四', '语文')).toHaveValue('缺考')
  await expect(rowOf(page, '王小一').getByTestId('total')).toHaveText('95')
  await expect(rowOf(page, '王小一').getByTestId('rank')).toHaveText('2')
  await expect(rowOf(page, '李小二').getByTestId('total')).toHaveText('170')
  await expect(rowOf(page, '李小二').getByTestId('rank')).toHaveText('1')
  await expect(rowOf(page, '张小三').getByTestId('total')).toHaveText('—')
  await expect(rowOf(page, '赵小四').getByTestId('total')).toHaveText('70')
  await expect(rowOf(page, '赵小四').getByTestId('rank')).toHaveText('3')
})

test('analysis shows KPIs and opens the scores tab from the ranking', async ({ page }) => {
  await signIn(page)
  await page.goto('/teacher/analysis')
  const examSelect = page.getByRole('combobox', { name: '考试' })
  await expect(examSelect.locator('option:checked')).toHaveText('期中考试')
  await expect(page.getByRole('combobox', { name: '对比' }).locator('option:checked')).toHaveText(
    '第一次月考',
  )
  await expect(page.locator('[data-kpi]', { hasText: '平均分' })).toContainText('较第一次月考')

  const ranking = page.getByRole('region', { name: '成绩排名' })
  const first = ranking.locator('tbody tr').first()
  await expect(first.getByRole('cell').first()).toHaveText('1')
  const name = (await first.getByRole('button').textContent())!.trim()
  await first.getByRole('button').click()

  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByRole('tab', { name: '成绩' })).toHaveAttribute('aria-selected', 'true')
  expect(new URL(page.url()).searchParams.get('tab')).toBe('成绩')
})

// 造两场只考语文的考试(日期都晚于期中):第一场 王小一 第 1、末位学号第 10(种子 10 人);第二场两人对调
async function seedMovers(request: Parameters<typeof login>[0]) {
  const token = await login(request, 'teacher01')
  const ids = await rosterEnrollmentIds(request, token, CLASS_ID)
  const subjects = [{ name: '语文', full: 100 }]
  const first = await createExam(request, token, CLASS_ID, {
    name: 'E2E 进退一',
    date: '2026-10-31',
    subjects,
  })
  const second = await createExam(request, token, CLASS_ID, {
    name: 'E2E 进退二',
    date: '2026-11-01',
    subjects,
  })
  const n = ids.length
  await putScores(
    request,
    token,
    CLASS_ID,
    first,
    '语文',
    ids,
    ids.map((_, i) => 100 - i),
  )
  await putScores(
    request,
    token,
    CLASS_ID,
    second,
    '语文',
    ids,
    ids.map((_, i) => (i === 0 ? 70 : i === n - 1 ? 100 : 99 - i)),
  )
  return second
}

test('classroom grades mode tints seats and links to analysis', async ({ page, request }) => {
  const latestId = await seedMovers(request)
  await signIn(page)
  await switchMode(page, '成绩')
  await page.getByRole('combobox', { name: '选择考试' }).selectOption({ label: 'E2E 进退二' })
  // 王小一 从第 1 掉到第 10(↓9),末位学号的同学从第 10 升到第 1(↑9)
  await expect(page.getByRole('button', { name: /^王小一，.*#10 ↓9/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /，#1 ↑9$/ })).toHaveCount(1)
  await expect(page.getByRole('group', { name: '名次色阶' })).toBeVisible()

  await page.getByRole('link', { name: '完整分析' }).click()
  await expect(page).toHaveURL(new RegExp(`/teacher/analysis\\?exam=${latestId}$`))
  await expect(page.getByRole('combobox', { name: '考试' }).locator('option:checked')).toHaveText(
    'E2E 进退二',
  )
})

test('projection hides grade tints, badges and legend', async ({ page, request }) => {
  await seedMovers(request)
  await signIn(page)
  // 桌面着色用 rect 的 fill 判断;"投屏"本身可能换底色,所以以"日常模式 + 投屏"的填充色集合为基线
  const rawFills = () =>
    page.evaluate(() =>
      [
        ...new Set(
          Array.from(document.querySelectorAll('.cr-canvas svg rect')).map((r) =>
            r.getAttribute('fill'),
          ),
        ),
      ].sort(),
    )
  // 先等 10 个座位渲染出来,并等填充色集合非空:基线取空会让后面的"有新颜色"恒真
  const fills = async () => {
    await expect(page.locator('[data-seat][data-enrollment]')).toHaveCount(10)
    await expect.poll(async () => (await rawFills()).length, '座位画布已渲染').toBeGreaterThan(0)
    return rawFills()
  }
  const present = async () => {
    await page.getByRole('button', { name: '全屏' }).click()
    await expect(page.getByRole('button', { name: '退出全屏' })).toBeVisible()
  }
  // 非全屏日常基线:与非全屏成绩模式同条件对比,正向对照才有区分力
  const dailyWindowed = await fills()
  await present()
  const baseline = await fills()
  await page.getByRole('button', { name: '退出全屏' }).click()
  await expect(page.getByRole('button', { name: '全屏' })).toBeVisible()

  await switchMode(page, '成绩')
  await expect(page.getByRole('button', { name: /^王小一，.*#10 ↓9/ })).toBeVisible()
  await expect(page.getByRole('group', { name: '名次色阶' })).toBeVisible()
  const seats = page.locator('[data-seat][data-enrollment]')
  await expect(seats).toHaveCount(10)
  // 非投屏基线:同一批座位里本来就有 ↑ / ↓ 角标,着色的填充色也不在日常基线里
  await expect(seats.filter({ hasText: /↑/ })).toHaveCount(1)
  await expect(seats.filter({ hasText: /↓/ })).toHaveCount(1)
  const tinted = await fills()
  expect(
    tinted.filter((f) => !dailyWindowed.includes(f)).length,
    '成绩模式有着色(对比非全屏日常)',
  ).toBeGreaterThan(0)

  await present()
  // 投屏时座位不可点,没有读屏名称:改看座位里的文字
  await expect(seats).toHaveCount(10)
  await expect(seats.filter({ hasText: /[↑↓]|#\d/ })).toHaveCount(0)
  await expect(seats.filter({ hasText: '王小一' })).toHaveCount(1)
  await expect(page.getByRole('group', { name: '名次色阶' })).toBeHidden()
  expect(await fills(), '投屏时不着色:填充色与日常投屏相同').toEqual(baseline)
})

test('subject teacher only sees math', async ({ page }) => {
  await signIn(page, 'teacher03')
  await page.goto('/teacher/scores')
  await expect(page.getByRole('columnheader', { name: /^数学/ })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /^语文/ })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: /^英语/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '导出' })).toHaveCount(0)

  await page.goto('/teacher/analysis')
  const detail = page.getByRole('region', { name: '各科明细' })
  await expect(detail.getByRole('cell', { name: '数学', exact: true })).toBeVisible()
  await expect(detail.locator('tbody tr')).toHaveCount(1)
  await expect(detail.getByRole('cell', { name: /^(语文|英语)$/ })).toHaveCount(0)
})

test('asks before logging out with unsaved scores', async ({ page, request }) => {
  const token = await login(request, 'teacher01')
  const examId = await createExam(request, token, CLASS_ID, {
    name: 'E2E 未保存',
    date: '2026-11-01',
    subjects: [{ name: '语文', full: 100 }],
  })
  await signIn(page)
  await page.goto(`/teacher/scores?exam=${examId}`)
  await expect(page.getByRole('heading', { name: 'E2E 未保存' })).toBeVisible()

  const failSave = (route: import('@playwright/test').Route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 500, body: '{}' })
      : route.fallback()
  await page.route('**/scores', failSave)
  await cell(page, '王小一', '语文').fill('88')
  const status = page.getByRole('status')
  await expect(status.getByText('保存失败')).toBeVisible()

  const logout = async () => {
    await page.getByRole('button', { name: '账号菜单' }).click()
    await page.getByRole('menuitem', { name: '退出登录' }).click()
  }
  const messages: string[] = []
  page.on('dialog', (d) => {
    messages.push(d.message())
    void d.dismiss()
  })
  await logout()
  await expect.poll(() => messages).toEqual(['还有成绩没保存,确定离开?'])
  await expect(page).toHaveURL(/\/teacher\/scores/)
  await expect(page.getByRole('heading', { name: 'E2E 未保存' })).toBeVisible()

  await page.unroute('**/scores', failSave)
  await status.getByRole('button', { name: '重试' }).click()
  await expect(status.getByText('已保存')).toBeVisible()

  await logout()
  await expect(page).toHaveURL(/\/login/)
  expect(messages, '保存成功后退出不再确认').toHaveLength(1)
})
