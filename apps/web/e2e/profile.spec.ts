import { expect, test, type Page } from '@playwright/test'
import {
  activeReviewOps,
  giveReview,
  login,
  restoreAiData,
  reviewTotal,
  revokeReviewsSince,
  snapshotAiData,
  studentRecord,
  type AiDataSnapshot,
} from './helpers/api'

const CLASS_ID = '44444444-4444-4444-4444-444444444444'

async function signIn(page: Page, name = 'teacher01') {
  await page.goto('/login')
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill('dev123')
  await page.getByRole('button', { name: /登录/ }).click()
  await expect(page.getByRole('heading', { name: '三年二班' })).toBeVisible()
}

// 本文件的用例会写成长记录、点评:用例前取快照,用例后(含失败)删掉新增的成长记录与评语、撤销新增的点评。
let before: AiDataSnapshot
let reviewsBefore = new Set<string>()
test.beforeEach(async ({ request }) => {
  const token = await login(request, 'teacher01')
  before = await snapshotAiData(request, token, CLASS_ID)
  reviewsBefore = await activeReviewOps(request, token, CLASS_ID)
})
test.afterEach(async ({ request }) => {
  const token = await login(request, 'teacher01')
  await restoreAiData(request, [token], CLASS_ID, before)
  await revokeReviewsSince(request, token, CLASS_ID, reviewsBefore)
})

async function openProfile(page: Page, tab: string) {
  await page.goto('/teacher/students')
  await page.getByRole('button', { name: '王小一', exact: true }).click()
  await page.getByRole('tab', { name: tab }).click()
}

test('adds and deletes a growth record', async ({ page }) => {
  await signIn(page)
  await openProfile(page, '成长记录')
  await page.getByLabel('记录类型').selectOption('表扬')
  await page.getByLabel('记录内容').fill('E2E 主动整理图书角')
  await page.getByRole('button', { name: '添加', exact: true }).click()
  const row = page.getByRole('listitem').filter({ hasText: 'E2E 主动整理图书角' })
  await expect(row).toBeVisible()

  await page.reload()
  await page.getByRole('tab', { name: '成长记录' }).click()
  await expect(row).toBeVisible()

  page.once('dialog', (d) => void d.accept())
  await row.getByRole('button', { name: '删除' }).click()
  await expect(row).toHaveCount(0)
  // 种子里王小一原有的记录不受影响
  await expect(page.getByText('主动帮同学讲解数学题')).toBeVisible()
})

test('assistant teacher can add a growth record but not comments', async ({ page }) => {
  await signIn(page, 'teacher02')
  await openProfile(page, '成长记录')
  await page.getByLabel('记录内容').fill('E2E 副班主任的观察')
  await page.getByRole('button', { name: '添加', exact: true }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'E2E 副班主任的观察' })).toBeVisible()

  await page.getByRole('tab', { name: '评语' }).click()
  await expect(page.getByText('只有班主任可以查看评语')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '评语内容' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '保存评语' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'AI 生成' })).toHaveCount(0)
})

test('undoes a single review from the profile', async ({ page, request }) => {
  const token = await login(request, 'teacher01')
  const { enrollment_id: enrollmentId } = await studentRecord(request, token, CLASS_ID, '王小一')
  const total0 = await reviewTotal(request, token, CLASS_ID, enrollmentId)
  await giveReview(request, token, CLASS_ID, enrollmentId, 'E2E 随堂小测', 1)
  expect(await reviewTotal(request, token, CLASS_ID, enrollmentId)).toBe(total0 + 1)

  await signIn(page)
  await openProfile(page, '成长记录')
  const row = page.getByRole('listitem').filter({ hasText: 'E2E 随堂小测' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('+1')
  await row.getByRole('button', { name: '撤销' }).click()
  await expect(row).toHaveCount(0)
  expect(await reviewTotal(request, token, CLASS_ID, enrollmentId)).toBe(total0)
})
