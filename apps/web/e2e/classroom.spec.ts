import { expect, test, type Page } from '@playwright/test'
import { login, restoreSeedSeating } from './helpers/api'

const CLASS_ID = '44444444-4444-4444-4444-444444444444'

async function signIn(page: Page, name = 'teacher01') {
  await page.goto('/login')
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill('dev123')
  await page.getByRole('button', { name: /登录/ }).click()
  await expect(page.getByRole('heading', { name: '三年二班' })).toBeVisible()
}

test('attendance cycles and persists', async ({ page }) => {
  await signIn(page)
  await page.getByRole('tab', { name: '考勤' }).click()
  const wang = page.getByRole('button', { name: '王小一' })
  await wang.click()
  await expect(page.locator('[data-enrollment]', { hasText: '王小一' })).toContainText('请假')
  await page.reload()
  await page.getByRole('tab', { name: '考勤' }).click()
  await expect(page.getByRole('complementary', { name: '班级概况' }).getByText(/请假 1/)).toBeVisible()
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '王小一' }).click()
  await expect(page.getByRole('complementary', { name: '班级概况' }).getByText(/请假 0/)).toBeVisible()
})

test('review with undo', async ({ page }) => {
  await signIn(page)
  await page.getByRole('tab', { name: '点评' }).click()
  await page.getByRole('button', { name: '李小二' }).click()
  await page.getByRole('button', { name: '积极发言 +1' }).click()
  await expect(page.getByText('已给 李小二 积极发言 +1')).toBeVisible()
  const li = page.locator('[data-enrollment]', { hasText: '李小二' })
  await expect(li).toContainText('+1')
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(li).not.toContainText('+1')
  await expect(page.locator('[data-enrollment] >> text=+1')).toHaveCount(0)
})

test('random roll call shows a card', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await signIn(page)
  await page.getByRole('button', { name: '随机点名' }).click()
  await expect(page.getByRole('dialog', { name: '随机点名' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '随机点名' })).toBeHidden()
})

test('seating swap is saved and restored', async ({ page, request }) => {
  const token = await login(request, 'teacher01')
  await restoreSeedSeating(request, token, CLASS_ID)
  try {
    await signIn(page)
    await page.getByRole('tab', { name: '排座' }).click()
    await page.getByRole('button', { name: '王小一' }).click()
    await page.getByRole('button', { name: '李小二' }).click()
    await page.getByRole('button', { name: '保存座位' }).click()
    await expect(page.getByText('座位已保存')).toBeVisible()
    await page.reload()
    await expect(page.locator('[data-seat="1-2"]')).toContainText('王小一')
  } finally {
    await restoreSeedSeating(request, token, CLASS_ID)
  }
})

test('subject teacher cannot mark attendance or arrange seats', async ({ page }) => {
  await signIn(page, 'teacher03')
  await expect(page.getByRole('tab', { name: '排座' })).toHaveCount(0)
  await page.getByRole('tab', { name: '考勤' }).click()
  await page.getByRole('button', { name: '王小一' }).click()
  await expect(page.getByText('只有班主任和副班主任可以记考勤')).toBeVisible()
})
