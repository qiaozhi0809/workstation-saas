import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { openAdminPage } from './helpers/nav'
import {
  adminGet,
  clearScores,
  deleteE2eExams,
  deleteE2eGradeExams,
  login,
  putScores,
  rosterEnrollmentIds,
} from './helpers/api'

const API = '/api/v1'
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
const CLASS_3_1 = '44444444-4444-4444-4444-444444444441'
const CLASS_3_2 = '44444444-4444-4444-4444-444444444444'
const FAKE_LLM = 'http://127.0.0.1:18089/v1'

async function signIn(page: Page, name: string) {
  await page.goto('/login')
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill('dev123')
  await page.getByRole('button', { name: /登录/ }).click()
}

const bell = (page: Page) => page.getByRole('button', { name: /^通知,\d+ 条未读$/ })
const unreadOf = async (page: Page) =>
  Number(/通知,(\d+) 条未读/.exec((await bell(page).getAttribute('aria-label')) ?? '')?.[1])

// 本文件的用例各自准备自己的数据,改到的数据在用例里或 afterEach 里还原。通知只能撤回不能删,留在库里的都是"已撤回"。
// 学年升级用例放最后,结束时回滚;与其他 spec 的隔离由 playwright.config.ts 的 project 依赖链保证。
test.describe.configure({ mode: 'serial' })

/** 校长发一条全校通知(经 API),返回通知 id;recallNotice 撤回(重复撤回是幂等的)。 */
async function sendSchoolNotice(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${API}/admin/notices`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title, content: '审计用例的占位通知,发出后立刻撤回。', target: { kind: 'school' } },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  return ((await res.json()) as { id: string }).id
}
async function recallNotice(request: APIRequestContext, token: string, id: string): Promise<void> {
  const res = await request.post(`${API}/admin/notices/${id}/recall`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
}
// 保证前一次跑到一半被打断(升级后、回滚前)留下的新学年不会连锁拖垮后面的用例
test.beforeAll(async ({ request }) => {
  const principal = await login(request, 'principal01')
  const latest = await adminGet<{ id: string; rolled_back: boolean } | null>(
    request,
    principal,
    '/admin/years/upgrade/latest',
  )
  if (latest && !latest.rolled_back) {
    const res = await request.post(`${API}/admin/years/upgrade/rollback`, {
      headers: { Authorization: `Bearer ${principal}` },
      data: { upgrade_id: latest.id },
    })
    expect(res.ok(), await res.text()).toBeTruthy()
  }
})

test('notice reaches an open classroom without refresh, shows read count, and recall is reflected', async ({
  page,
  browser,
  request,
}) => {
  const title = `E2E通知${Date.now().toString(36)}`
  const teacherCtx = await browser.newContext({ baseURL: BASE_URL })
  const teacher = await teacherCtx.newPage()
  try {
    await signIn(teacher, 'teacher01')
    await expect(teacher.getByRole('heading', { name: '三年二班' })).toBeVisible()
    await teacher.waitForLoadState('networkidle') // 收件箱加载前铃铛显示 0 条未读,等它取回再读基数
    await expect(bell(teacher)).toBeVisible()
    const before = await unreadOf(teacher)

    await signIn(page, 'principal01')
    await expect(page).toHaveURL(/\/admin\/today/)
    await page.goto('/admin/notices')
    await expect(page.getByRole('heading', { name: '通知', exact: true })).toBeVisible()
    await page.getByLabel('标题').fill(title)
    await page.getByLabel('正文').fill('明天下午三点开全体教师会,请准时参加。')
    await expect(page.getByLabel('发给', { exact: true })).toHaveValue('school')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    // toast 只停几秒:在点"确认发送"之前就开始等,不要等推送到了才开始看
    await Promise.all([
      expect(teacher.getByText(`新通知:${title}`)).toBeVisible(),
      page.getByRole('button', { name: '确认发送' }).click(),
    ])
    await expect(page.getByRole('status').filter({ hasText: /已发给 \d+ 人/ })).toBeVisible()

    // 老师页面不刷新:铃铛未读 +1
    await expect(bell(teacher)).toHaveAttribute('aria-label', `通知,${before + 1} 条未读`)

    // 点开铃铛读这条通知 → 未读回落;校长"我发出的"已读数 +1
    await bell(teacher).click()
    await teacher.getByRole('button', { name: new RegExp(title) }).click()
    await expect(teacher.getByText('明天下午三点开全体教师会,请准时参加。')).toBeVisible()
    await expect(bell(teacher)).toHaveAttribute('aria-label', `通知,${before} 条未读`)
    await page.reload()
    const sent = page
      .getByRole('region', { name: '我发出的' })
      .getByRole('listitem')
      .filter({ hasText: title })
    await expect(sent.getByText(/^已读 1 \/ \d+$/)).toBeVisible()

    // 撤回:老师那边这条变成"此通知已撤回"
    await sent.getByRole('button', { name: `撤回 ${title}` }).click()
    await page.getByRole('button', { name: '确认撤回' }).click()
    await expect(sent.getByText('已撤回')).toBeVisible()
    await expect(
      teacher.getByRole('listitem').filter({ hasText: title }).getByText('此通知已撤回'),
    ).toBeVisible()
  } finally {
    await teacherCtx.close()
    // 中途失败时别留下一条未撤回的全校通知(收件人的未读数会被污染)
    const principal = await login(request, 'principal01')
    const sentList = await adminGet<{
      items: { id: string; title: string; recalled_at: string | null }[]
    }>(request, principal, '/admin/notices?page=1')
    for (const n of sentList.items.filter((x) => x.title === title && !x.recalled_at))
      await recallNotice(request, principal, n.id)
  }
})

test.describe('grade exam', () => {
  const NAME = 'E2E联考'

  async function cleanup(request: APIRequestContext) {
    const dean = await login(request, 'dean01')
    for (const [user, classId] of [
      ['teacher01', CLASS_3_2],
      ['teacher04', CLASS_3_1],
    ] as const) {
      const token = await login(request, user)
      await clearScores(request, token, classId, NAME, ['语文', '数学'])
    }
    await deleteE2eGradeExams(request, dean)
  }
  test.beforeEach(({ request }) => cleanup(request))
  test.afterEach(({ request }) => cleanup(request))

  test('dean creates a grade exam, teachers score it, report compares classes and exports', async ({
    page,
    browser,
    request,
  }) => {
    await signIn(page, 'dean01')
    await expect(page).toHaveURL(/\/admin\/today/)
    await openAdminPage(page, '年级联考', '联考与报表')
    await expect(page.getByRole('heading', { name: '年级联考' })).toBeVisible()
    await page.getByRole('button', { name: '新建联考' }).click()
    const form = page.getByRole('dialog', { name: '新建联考' })
    await form.getByLabel('考试名称').fill(NAME)
    await form.getByRole('button', { name: '删除科目 3' }).click() // 默认语数英,只留语文、数学
    await form.getByRole('button', { name: '保存' }).click()
    const row = page.getByRole('listitem', { name: NAME })
    await expect(row).toBeVisible()
    await expect(row.getByText('语文、数学')).toBeVisible()
    await expect(row.getByText(/三年一班 0\/12/)).toBeVisible()
    await expect(row.getByText(/三年二班 0\/20/)).toBeVisible()

    // 两位班主任各给两名学生录分(各班按学号排序的前两人)
    const t1 = await login(request, 'teacher01')
    const t4 = await login(request, 'teacher04')
    const exam32 = await classExamId(request, t1, CLASS_3_2, NAME)
    const exam31 = await classExamId(request, t4, CLASS_3_1, NAME)
    const ids32 = (await rosterEnrollmentIds(request, t1, CLASS_3_2)).slice(0, 2)
    const ids31 = (await rosterEnrollmentIds(request, t4, CLASS_3_1)).slice(0, 2)
    await putScores(request, t1, CLASS_3_2, exam32, '语文', ids32, [90, 80])
    await putScores(request, t1, CLASS_3_2, exam32, '数学', ids32, [70, 100])
    await putScores(request, t4, CLASS_3_1, exam31, '语文', ids31, [85, 75])
    await putScores(request, t4, CLASS_3_1, exam31, '数学', ids31, [96, 60])

    // 成绩汇总:两班对比 + 年级名次
    await row.getByRole('link', { name: '查看汇总' }).click()
    await expect(page.getByRole('heading', { name: '成绩汇总' })).toBeVisible()
    const table = page.getByRole('table', { name: '班级成绩汇总' })
    await expect(table.getByRole('row', { name: /三年一班/ })).toContainText('80.0') // 语文 (85+75)/2
    await expect(table.getByRole('row', { name: /三年二班/ })).toContainText('85.0') // 语文 (90+80)/2
    await expect(table.getByRole('row', { name: /全年级/ })).toBeVisible()
    await table.getByRole('button', { name: '三年二班' }).click()
    const students = page.getByRole('table', { name: '三年二班 学生成绩' })
    await expect(students.getByRole('columnheader', { name: /年级名次/ })).toBeVisible()
    // 年级总分:3-1 甲 181、3-2 乙 180、3-2 甲 160、3-1 乙 135 → 三年二班这两人是第 2、第 3
    const ranks = await students
      .locator('tbody tr')
      .evaluateAll((trs) =>
        trs.map((tr) =>
          Array.from(tr.querySelectorAll('td'), (td) => td.textContent?.trim() ?? ''),
        ),
      )
    const gradeRankCol = (await students.locator('thead th').allInnerTexts()).findIndex((t) =>
      t.includes('年级名次'),
    )
    expect(
      ranks
        .map((r) => r[gradeRankCol])
        .filter((v) => v && v !== '—')
        .sort(),
    ).toEqual(['2', '3'])

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出 CSV' }).click()
    expect((await download).suggestedFilename()).toBe(`${NAME}-成绩汇总.csv`)

    // 老师端:成绩页上有"年级联考"标签,没有编辑 / 删除入口,但能照常录分
    const ctx = await browser.newContext({ baseURL: BASE_URL })
    const teacherPage = await ctx.newPage()
    try {
      await signIn(teacherPage, 'teacher01')
      await expect(teacherPage.getByRole('heading', { name: '三年二班' })).toBeVisible()
      await teacherPage.goto(`/teacher/scores?exam=${exam32}`)
      await expect(
        teacherPage
          .getByRole('navigation', { name: '考试列表' })
          .getByText('年级联考', { exact: true }),
      ).toBeVisible()
      await expect(teacherPage.getByText('这是年级联考,由教导处修改')).toBeVisible()
      await expect(teacherPage.getByRole('button', { name: /编辑考试|删除/ })).toHaveCount(0)
      await expect(teacherPage.getByRole('button', { name: '新建考试' })).toBeVisible()
    } finally {
      await ctx.close()
    }
  })
})

async function classExamId(
  request: APIRequestContext,
  token: string,
  classId: string,
  name: string,
): Promise<string> {
  const { items } = await adminGet<{
    items: { id: string; name: string; grade_exam_id: string | null }[]
  }>(request, token, `/classes/${classId}/exams`)
  const found = items.find((x) => x.name === name)
  expect(found, `${classId} 缺少班级考试 ${name}`).toBeTruthy()
  expect(found!.grade_exam_id).not.toBeNull()
  return found!.id
}

test('principal reads the 2026-10 attendance report that matches the seed, with export and print', async ({
  page,
}) => {
  await signIn(page, 'principal01')
  await expect(page).toHaveURL(/\/admin\/today/)
  await openAdminPage(page, '考勤报告', '联考与报表')
  await expect(page.getByRole('heading', { name: '月度考勤报告' })).toBeVisible()
  for (
    let i = 0;
    i < 240 && !(await page.getByText('2026年10月', { exact: true }).isVisible());
    i++
  ) {
    await page.getByRole('button', { name: '上一月' }).click()
  }
  await expect(page.getByText('2026年10月', { exact: true })).toBeVisible()

  // 种子:10-12 至 10-16 五天都已确认;三班应到 = 人数 × 5
  const expectRow = async (cls: string, cells: string[]) => {
    const row = page
      .getByRole('row')
      .filter({ has: page.getByText(cls, { exact: true }) })
      .first()
    await expect(row).toBeVisible()
    await expect(row.locator('td')).toHaveText([cls, ...cells])
  }
  await expectRow('三年一班', ['5', '30', '28', '1', '1', '0', '93.3%'])
  await expectRow('三年二班', ['5', '50', '49', '1', '0', '1', '98.0%'])
  await expectRow('四年一班', ['5', '30', '29', '0', '1', '1', '96.7%'])

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 CSV' }).click()
  expect((await download).suggestedFilename()).toBe('考勤报告-2026-10.csv')
  await expect(page.getByRole('button', { name: '打印' })).toBeEnabled()
})

test('it admin finds audit entries by group and saves + tests the fake AI service', async ({
  page,
  request,
}) => {
  const it = await login(request, 'itadmin01')
  const principal = await login(request, 'principal01')
  const loginName = `e2e_audit_${Date.now().toString(36)}`
  // 自己发一条通知再撤回,让"通知"分组里一定有记录,不依赖用例 1 先跑
  await recallNotice(
    request,
    principal,
    await sendSchoolNotice(request, principal, `E2E审计通知${Date.now().toString(36)}`),
  )
  const created = await request.post(`${API}/admin/accounts`, {
    headers: { Authorization: `Bearer ${it}` },
    data: {
      login_name: loginName,
      display_name: '审计测试',
      employee_no: null,
      phone: null,
      subjects: [],
    },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const accountId = ((await created.json()) as { account: { id: string } }).account.id
  try {
    await signIn(page, 'itadmin01')
    await expect(page).toHaveURL(/\/admin/)
    await openAdminPage(page, '审计日志', '系统')
    await expect(page.getByRole('heading', { name: '审计日志' })).toBeVisible()
    // 默认区间的结束日取浏览器本地日期,而后端按学校时区(上海)算日界:浏览器时区落后于上海时今天的记录会被排除。
    // 用例把结束日放宽到两天后,不依赖跑测试的机器所在时区(台账 L43)
    await page
      .getByLabel('结束日期')
      .fill(new Date(Date.now() + 2 * 86_400_000).toLocaleDateString('sv-SE'))
    await page.getByLabel('分组').selectOption({ label: '账号' })
    const rows = page.getByRole('table').locator('tbody tr')
    await expect(rows.first()).toBeVisible()
    await expect(rows.filter({ hasText: '新建账号' }).first()).toBeVisible()
    await page.getByLabel('分组').selectOption({ label: '通知' })
    await expect(rows.filter({ hasText: '发送通知' }).first()).toBeVisible()

    // AI 配置:沿用假服务地址;换地址必须同时填 Key,这里一并填假值
    await openAdminPage(page, 'AI 配置', '系统')
    await expect(page.getByLabel('接口地址')).toHaveValue(FAKE_LLM)
    await page.getByLabel('接口地址').fill(FAKE_LLM)
    await page.getByLabel('模型').fill('fake-model')
    await page.getByLabel('API Key').fill('test-key')
    await page.getByRole('button', { name: '测试连接' }).click()
    await expect(page.getByRole('status').filter({ hasText: '连接成功' })).toBeVisible()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('已保存')).toBeVisible()
  } finally {
    await request.post(`${API}/admin/accounts/${accountId}/freeze`, {
      headers: { Authorization: `Bearer ${it}` },
    })
  }
})

test.describe('year upgrade', () => {
  const NAME = 'E2E升级考试'

  async function rollbackIfNeeded(request: APIRequestContext) {
    const principal = await login(request, 'principal01')
    const latest = await adminGet<{ id: string; rolled_back: boolean } | null>(
      request,
      principal,
      '/admin/years/upgrade/latest',
    )
    if (latest && !latest.rolled_back) {
      const res = await request.post(`${API}/admin/years/upgrade/rollback`, {
        headers: { Authorization: `Bearer ${principal}` },
        data: { upgrade_id: latest.id },
      })
      expect(res.ok(), await res.text()).toBeTruthy()
    }
  }
  async function dropExam(request: APIRequestContext) {
    const t1 = await login(request, 'teacher01')
    await deleteE2eExams(request, t1, CLASS_3_2)
  }
  test.beforeEach(async ({ request }) => {
    await rollbackIfNeeded(request)
    await dropExam(request)
  })
  test.afterEach(async ({ request }) => {
    await rollbackIfNeeded(request)
    await dropExam(request)
  })

  test('principal upgrades the year with dean as the new grade head, reads last year read-only, then rolls back', async ({
    page,
    request,
  }) => {
    // 往年班级要有一场考试可看:升级前给三年二班建一场(名字以 E2E 开头,afterEach 兜底删除)
    const t1 = await login(request, 'teacher01')
    const ids = (await rosterEnrollmentIds(request, t1, CLASS_3_2)).slice(0, 2)
    const examRes = await request.post(`${API}/classes/${CLASS_3_2}/exams`, {
      headers: { Authorization: `Bearer ${t1}` },
      data: {
        name: NAME,
        date: '2026-10-20',
        exam_type: '月考',
        subjects: [{ name: '语文', full: 100 }],
      },
    })
    expect(examRes.ok(), await examRes.text()).toBeTruthy()
    await putScores(
      request,
      t1,
      CLASS_3_2,
      ((await examRes.json()) as { id: string }).id,
      '语文',
      ids,
      [88, 77],
    )

    await signIn(page, 'principal01')
    await expect(page).toHaveURL(/\/admin\/today/)
    await openAdminPage(page, '学年升级', '学校管理')
    await expect(page.getByRole('heading', { name: '学年升级' })).toBeVisible()
    await expect(page.getByText('最近一次升级')).toBeVisible() // 重跑时库里可能已有一条"已回滚"的旧记录,所以不断言空状态

    await page.getByLabel('学年名称').fill('2027-2028')
    await page.getByLabel('开学日期').fill('2027-09-01')
    await page.getByLabel('结束日期').fill('2028-07-15')
    await page.getByRole('button', { name: '生成建议' }).click()
    await expect(page.getByRole('button', { name: /2\. 班级去向/ })).toHaveAttribute(
      'aria-current',
      'step',
    )

    // 人员一步:四年级组长(跟届沿用 gradehead03)换成 dean01
    await page.getByRole('button', { name: /5\. 人员/ }).click()
    await page.getByRole('button', { name: /^移除 四年级 年级组长 / }).click()
    await page.getByRole('button', { name: '四年级 年级组长', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择:四年级 年级组长' })
    await picker.getByLabel('搜索账号').fill('dean01')
    await picker.getByRole('button', { name: /dean01/ }).click()
    await picker.getByRole('button', { name: '完成' }).click()

    await page.getByRole('button', { name: /6\. 预览/ }).click()
    await expect(page.getByText('新学年:')).toBeVisible()
    await page.getByRole('button', { name: '执行升级' }).click()
    await page.getByRole('button', { name: '确认执行' }).click()
    await expect(page.getByText('升级已执行,新学年已生效')).toBeVisible()
    await expect(page.getByText(/2026-2027 → 2027-2028/)).toBeVisible()

    // 新学年四年级的组长确实换成了 dean01(冯主任),原组长(韩组长)不在其中
    const roles = await adminGet<{ role: string; display_name: string }[]>(
      request,
      await login(request, 'principal01'),
      '/admin/roles',
    )
    const heads = roles.filter((r) => r.role === 'grade_head').map((r) => r.display_name)
    expect(heads).toContain('冯主任')
    expect(heads).not.toContain('韩组长')

    // 往年班级:上一学年的三年二班,名单 + 一场考试的成绩,没有任何写入口
    await openAdminPage(page, '往年班级', '学校管理')
    await expect(page.getByRole('heading', { name: '往年班级' })).toBeVisible()
    await expect(page.getByLabel('学年')).toContainText('2026-2027')
    await page.getByRole('link', { name: /三年二班/ }).click()
    await expect(page.getByRole('heading', { name: /三年二班/ })).toBeVisible()
    await expect(page.getByRole('table', { name: '名单' }).getByRole('row')).toHaveCount(11) // 表头 + 10 人
    await page.getByRole('tab', { name: '成绩' }).click()
    await expect(page.getByLabel('考试')).toContainText(NAME)
    await expect(page.getByRole('table', { name: '成绩表' })).toContainText('88')
    await expect(
      page.getByRole('button', { name: /新建|添加|编辑|删除|保存|导入|导出|考勤|点评|排座/ }),
    ).toHaveCount(0)

    // 回滚 → 回到原学年,往年班级回到空状态
    await openAdminPage(page, '学年升级', '学校管理')
    await page.getByRole('button', { name: '回滚', exact: true }).click()
    await page.getByRole('button', { name: '确认回滚' }).click()
    await expect(page.getByText('已回滚,新学年的班级与注册记录已删除')).toBeVisible()
    await expect(page.getByText('已回滚', { exact: true })).toBeVisible()
    await openAdminPage(page, '往年班级', '学校管理')
    await expect(page.getByText('还没有往年数据')).toBeVisible()
    const years = await adminGet<{ name: string; is_active: boolean }[]>(
      request,
      await login(request, 'principal01'),
      '/admin/years',
    )
    expect(years.find((y) => y.is_active)?.name).toBe('2026-2027')
  })
})

for (const [width, height] of [
  [1280, 720],
  [1024, 768],
  [768, 1024],
] as const) {
  test(`admin nav keeps every entry reachable without page overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    // 长校名:导航不能被压缩,校名自己截断(种子校名太短,区分不出)
    if (width < 1280) {
      await page.route('**/api/v1/admin/school', (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              json: { name: '北京市海淀区中关村第一实验小学教育集团', address: null },
            })
          : route.continue(),
      )
    }
    await signIn(page, 'principal01')
    await expect(page).toHaveURL(/\/admin\/today/)
    const nav = page.getByRole('navigation', { name: '主导航' })
    // 直接显示的:今日关注、全校看板、通知;其余都收在三个下拉里
    for (const name of ['今日关注', '全校看板', '通知'])
      await expect(nav.getByRole('link', { name })).toBeVisible()
    const groups: Record<string, string[]> = {
      学校管理: ['组织架构', '账号', '学校设置', '学年升级', '往年班级'],
      联考与报表: ['年级联考', '成绩汇总', '考勤报告'],
      系统: ['审计日志', 'AI 使用', 'AI 配置'],
    }
    for (const [group, items] of Object.entries(groups)) {
      await nav.getByRole('button', { name: group }).click()
      const menu = page.getByRole('menu', { name: group })
      for (const item of items)
        await expect(menu.getByRole('menuitem', { name: item })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)
    }
    await openAdminPage(page, '成绩汇总', '联考与报表')
    await expect(page).toHaveURL(/\/admin\/reports\/scores/)
    await expect(nav.getByRole('button', { name: '联考与报表' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0)
    // 文字标签:≥ 1024 显示,768–1023 只剩图标(sr-only,宽高 1px);导航不能压到右侧的铃铛 / 主题 / 账号按钮上
    for (const label of ['今日关注', '联考与报表']) {
      const box = await nav.getByText(label, { exact: true }).boundingBox()
      if (width >= 1024) expect(box!.width).toBeGreaterThan(20)
      else expect(box!.width).toBeLessThanOrEqual(1)
    }
    const navBox = (await nav.boundingBox())!
    const bellBox = (await page.getByRole('button', { name: /^通知,\d+ 条未读$/ }).boundingBox())!
    // 入口之间不重叠、最后一个不压到右侧按钮(导航被压缩时,下拉的外层 wrapper 会缩、里面的按钮溢出去盖住相邻入口)
    const boxes = await nav.locator('a, button').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return [r.x, r.right]
      }),
    )
    for (let i = 1; i < boxes.length; i++)
      expect(boxes[i][0]).toBeGreaterThanOrEqual(boxes[i - 1][1] - 1)
    expect(boxes[boxes.length - 1][1]).toBeLessThanOrEqual(bellBox.x)
    expect(navBox.x + navBox.width).toBeLessThanOrEqual(bellBox.x + 1)
    // 学校名在 1280 宽放得下,不被截成"示…"
    if (width === 1280) {
      const name = page.locator('header span.truncate').first()
      expect(await name.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
    }
  })
}
