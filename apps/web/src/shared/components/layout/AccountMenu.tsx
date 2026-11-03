import { useState } from 'react'
import { ChevronDown, User } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Menu, { MenuItem, MenuLabel, MenuLinkItem } from '@/shared/components/overlay/Menu'
import { useAuthStore } from '@/shared/stores/auth'
import ChangePasswordDialog from './ChangePasswordDialog'

/** 头像菜单:首字当头像,修改密码 / 切换端 / 退出登录收在里面 */
export default function AccountMenu({ name, onLogout, switchTo, preferences = true }: {
  name: string | undefined
  onLogout(): void
  switchTo?: { label: string; to: string }
  /** 是否显示"我的偏好"(教师端专有),默认显示 */
  preferences?: boolean
}) {
  const navigate = useNavigate()
  const [pwOpen, setPwOpen] = useState(false)
  const onSwitch = () => {
    if (!switchTo) return
    useAuthStore.getState().setLastContext(switchTo.to.startsWith('/admin') ? 'admin' : 'teacher')
    navigate(switchTo.to)
  }
  return (
    <>
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
        {preferences && <MenuLinkItem to="/teacher/preferences">我的偏好</MenuLinkItem>}
        <MenuItem onSelect={() => setPwOpen(true)}>修改密码</MenuItem>
        {switchTo && <MenuItem onSelect={onSwitch}>{switchTo.label}</MenuItem>}
        <MenuItem onSelect={onLogout}>退出登录</MenuItem>
      </Menu>
      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  )
}
