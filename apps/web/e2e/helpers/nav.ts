import type { Page } from '@playwright/test'

/** 管理端侧栏导航:所有页面都是侧栏里的链接,直接点。group 参数只为不改调用处而保留,不再使用。 */
export async function openAdminPage(page: Page, item: string, group?: string): Promise<void> {
  void group
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: item }).click()
}
