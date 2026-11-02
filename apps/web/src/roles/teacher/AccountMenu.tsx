import { ChevronDown, User } from 'lucide-react'
import Menu, { MenuItem, MenuLabel, MenuLinkItem } from '@/shared/components/overlay/Menu'

/** 头像菜单:首字当头像,我的偏好 / 退出登录收在里面 */
export default function AccountMenu({ name, onLogout }: { name: string | undefined; onLogout(): void }) {
  return (
    <Menu
      label="账号菜单"
      side="bottom"
      align="end"
      triggerProps={{ variant: 'ghost', className: 'gap-1 px-1.5', 'aria-label': '账号菜单', title: name }}
      trigger={
        <>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
            {Array.from(name ?? '')[0] ?? <User className="h-4 w-4" aria-hidden="true" />}
          </span>
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </>
      }
    >
      {name && <MenuLabel>{name}</MenuLabel>}
      {/* 排座有未保存修改时,站内跳转由教室页的路由守卫确认 */}
      <MenuLinkItem to="/teacher/preferences">我的偏好</MenuLinkItem>
      <MenuItem onSelect={onLogout}>退出登录</MenuItem>
    </Menu>
  )
}
