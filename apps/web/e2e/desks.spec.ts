import { expect, test, type Page } from '@playwright/test'
import {
  addTestStudents,
  deleteTestStudents,
  login,
  restoreSeedLayout,
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

async function openSettings(page: Page) {
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '班级设置' }).click()
  const dialog = page.getByRole('dialog', { name: /班级设置/ })
  await expect(dialog).toBeVisible()
  return dialog
}

// 本文件的用例会改桌椅排列、增删学生:每个用例前后兜底删掉 测试* 学生、把桌椅和座位还原成种子(双人 6 × 4、教室 求知楼 201),
// 失败中途退出也不留脏数据。与其他 spec 的隔离由 playwright.config.ts 的 project 依赖链保证。
async function cleanup(request: Parameters<typeof login>[0]) {
  const token = await login(request, 'teacher01')
  await deleteTestStudents(request, token, CLASS_ID)
  await restoreSeedLayout(request, token, CLASS_ID)
}
test.beforeEach(({ request }) => cleanup(request))
test.afterEach(({ request }) => cleanup(request))

test('homeroom teacher sets triple desks with a podium seat and keeps them through seating tools', async ({
  page,
  request,
}) => {
  const token = await login(request, 'teacher01')
  const firstId = (await rosterEnrollmentIds(request, token, CLASS_ID))[0]
  await signIn(page)

  const dialog = await openSettings(page)
  await dialog.getByLabel('教室').fill('博学楼 301')
  await dialog.getByRole('tab', { name: '三人一排' }).click()
  await dialog.getByRole('tab', { name: '自己设定' }).click()
  // 种子是 6 排 × 4 座;换成三人桌后每排只剩 1 张桌子 → 加到 3 张(9 个座位),排数减到 4
  await dialog.getByRole('button', { name: '排数减少' }).click()
  await dialog.getByRole('button', { name: '排数减少' }).click()
  await dialog.getByRole('button', { name: '每排增加' }).click()
  await dialog.getByRole('button', { name: '每排增加' }).click()
  await dialog.getByRole('button', { name: '左边增加' }).click()
  await dialog.getByRole('button', { name: '按学号横着排' }).click()
  await expect(
    dialog.getByText('4 排 × 9 个座位 + 讲台边 1 个 = 37 个座位 · 学生 10 人'),
  ).toBeVisible()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('已保存,座位已按新桌椅排好')).toBeVisible()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(/博学楼 301/).first()).toBeVisible()
  await expect(page.locator('[data-seat]')).toHaveCount(37)
  // 学号最小的同学按学号横着排,坐在第 1 排第 1 个座位
  await expect(page.locator('[data-seat="1-1"]')).toContainText('王小一')

  // 排座模式:选中学号最小的同学,点讲台左边座位把他挪过去,保存
  await switchMode(page, '排座')
  await expect(page.getByRole('button', { name: '随机打乱' })).toBeEnabled()
  await page.getByRole('button', { name: /^王小一，/ }).click()
  await page.locator('[data-seat="0--1"]').click()
  await expect(page.locator('[data-seat="0--1"]')).toContainText('王小一')
  await page.getByRole('button', { name: '保存座位' }).click()
  await expect(page.getByText('座位已保存')).toBeVisible()

  // 随机打乱:讲台边的同学不动(第一次保存的 toast 消失后再存,免得断言命中旧 toast)
  await expect(page.getByText('座位已保存')).toBeHidden()
  await page.getByRole('button', { name: '随机打乱' }).click()
  await expect(page.locator('[data-seat="0--1"]')).toContainText('王小一')
  const saved = page.waitForResponse(
    (r) => r.url().endsWith(`/classes/${CLASS_ID}/seating`) && r.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: '保存座位' }).click()
  expect((await saved).ok()).toBe(true)
  await page.reload()
  await expect(page.locator('[data-seat="0--1"]')).toContainText('王小一')
  const seats = (await (
    await request.get(`/api/v1/classes/${CLASS_ID}/students`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as {
    items: { enrollment_id: string; seat_row: number | null; seat_col: number | null }[]
  }
  const first = seats.items.find((s) => s.enrollment_id === firstId)
  expect([first?.seat_row, first?.seat_col]).toEqual([0, -1])

  // 排座栏的"桌椅排列"按钮:有未保存修改时不可用;保存后点开,讲台右边加一张,草稿按新桌椅重建、讲台同学不动
  await switchMode(page, '排座')
  await expect(page.getByRole('button', { name: '随机打乱' })).toBeEnabled()
  await page.getByRole('button', { name: '随机打乱' }).click()
  await expect(page.getByRole('button', { name: '桌椅排列' })).toBeDisabled()
  await page.getByRole('button', { name: '保存座位' }).click()
  await expect(page.getByRole('button', { name: '保存座位' })).toBeDisabled()
  await page.getByRole('button', { name: '桌椅排列' }).click()
  const dlg2 = page.getByRole('dialog', { name: /班级设置/ })
  await dlg2.getByRole('button', { name: '右边增加' }).click()
  await dlg2.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dlg2).toBeHidden()
  await expect(page.locator('[data-seat]')).toHaveCount(38)
  await expect(page.locator('[data-seat="0--1"]')).toContainText('王小一')

  // 打印:拦截 window.open,写入的 HTML 含教室名,讲台边的同学印在讲台那一行
  await page.evaluate(() => {
    const w = window as unknown as { __printed: string; open: () => unknown }
    w.__printed = ''
    w.open = () => ({
      document: {
        write: (h: string) => {
          w.__printed += h
        },
        close() {},
      },
      focus() {},
      print() {},
    })
  })
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '打印' }).click()
  const html = await page.evaluate(() => (window as unknown as { __printed: string }).__printed)
  expect(html).toContain('博学楼 301')
  expect(html).toContain('<span class="ps">王小一')
})

test('auto layout grows a row when a student is added to a full class', async ({
  page,
  request,
}) => {
  const token = await login(request, 'teacher01')
  await signIn(page)

  const dialog = await openSettings(page)
  await dialog.getByRole('tab', { name: '双人同桌' }).click()
  await dialog.getByRole('tab', { name: '按人数自动排' }).click()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toBeHidden()
  // 10 人 → 4 排 × 4 座 = 16 座
  await expect(page.locator('[data-seat]')).toHaveCount(16)

  // 经 API 再加 6 人坐满 16 座
  await addTestStudents(request, token, CLASS_ID, 6)
  await page.reload()
  await expect(page.locator('[data-seat]')).toHaveCount(16)

  // 学生页再加 1 人,座位默认"自动加座位" → 5 排共 20 座
  await page.goto('/teacher/students')
  await page.getByRole('button', { name: '添加学生' }).click()
  const form = page.getByRole('dialog', { name: '添加学生' })
  await form.getByLabel('姓名', { exact: true }).fill('测试加人满员')
  await expect(form.getByLabel('座位')).toHaveValue(/./)
  await expect(form.getByLabel('座位').locator('option:checked')).toHaveText('自动加座位')
  await form.getByRole('button', { name: '保存' }).click()
  await expect(form).toBeHidden()
  // 站内跳回教室(不整页刷新):靠名单变动后失效 my-classes,教室图才拿到新行列
  await page.getByRole('link', { name: '教室' }).click()
  await expect(page.locator('[data-seat]')).toHaveCount(20)
})

test('subject teacher sees the layout but no class settings', async ({ page }) => {
  await signIn(page, 'teacher03')
  // 种子是双人同桌 6 × 4
  await expect(page.locator('[data-seat]')).toHaveCount(24)
  // 日常模式下任课老师没有"更多操作";切到考勤后菜单里有随机点名,但没有"班级设置"
  await switchMode(page, '考勤')
  await page.getByRole('button', { name: '更多操作' }).click()
  await expect(page.getByRole('menuitem', { name: '随机点名' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '班级设置' })).toHaveCount(0)
})
