import { expect, test } from '@playwright/test'

test('teacher can login, see classroom, open student profile', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('登录名').fill('teacher01')
  await page.getByLabel('密码').fill('dev123')
  await page.getByRole('button', { name: /登录/ }).click()

  await expect(page).toHaveURL(/\/teacher\/classroom/)
  await expect(page.getByRole('heading', { name: '三年二班' })).toBeVisible()

  await page.getByRole('button', { name: '王小一' }).click()
  await expect(page.getByRole('heading', { name: '王小一' })).toBeVisible()
  await page.getByRole('tab', { name: '档案' }).click()
  await expect(page.getByText('双亲家庭')).toBeVisible()

  await page.getByRole('button', { name: '关闭' }).click()
  await expect(page.getByRole('heading', { name: '王小一' })).toBeHidden()
})
