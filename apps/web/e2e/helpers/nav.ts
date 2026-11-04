import { expect, type Page } from '@playwright/test'

/** 管理端顶栏导航:宽屏(≥ 768)里分组的页面收在下拉里,先点开组再点项;不在组里的直接点链接。 */
export async function openAdminPage(page: Page, item: string, group?: string): Promise<void> {
  const nav = page.getByRole('navigation', { name: '主导航' })
  if (!group) {
    await nav.getByRole('link', { name: item }).click()
    return
  }
  await nav.getByRole('button', { name: group }).click()
  await page.getByRole('menu', { name: group }).getByRole('menuitem', { name: item }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
}
