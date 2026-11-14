import { useState } from 'react'
import { ChevronDown, User } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Menu, { MenuItem, MenuLabel, MenuLinkItem } from '@/shared/components/overlay/Menu'
import { useAuthStore } from '@/shared/stores/auth'
import type { Context } from '@/shared/types/admin'
import AboutDialog from './AboutDialog'
import AccountSecurityDialog from './AccountSecurityDialog'
import ChangePasswordDialog from './ChangePasswordDialog'

/** 头像菜单:首字当头像,修改密码 / 账号安全 / 切换端 / 关于 / 退出登录收在里面 */
export default function AccountMenu({
  name,
  onLogout,
  switchTo,
  preferences = true,
  placement = 'bottom',
}: {
  name: string | undefined
  onLogout(): void
  switchTo?: { label: string; to: string; context: Context }[]
  /** 是否显示"我的偏好"(教师端专有),默认显示 */
  preferences?: boolean
  /** 菜单弹出方向;侧栏底部用 'top' */
  placement?: 'top' | 'bottom'
}) {
  const navigate = useNavigate()
  const [pwOpen, setPwOpen] = useState(false)
  const [secOpen, setSecOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const onSwitch = (s: { to: string; context: Context }) => {
    useAuthStore.getState().setLastContext(s.context)
    navigate(s.to)
  }
  return (
    <>
      <Menu
        label="账号菜单"
        side={placement}
        align={placement === 'top' ? 'start' : 'end'}
        triggerProps={{
          variant: 'ghost',
          className: 'min-h-11 min-w-11 gap-1 px-1.5',
          'aria-label': '账号菜单',
          title: name,
        }}
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
        <MenuItem onSelect={() => setSecOpen(true)}>账号安全</MenuItem>
        {switchTo?.map((s) => (
          <MenuItem key={s.context} onSelect={() => onSwitch(s)}>
            {s.label}
          </MenuItem>
        ))}
        <MenuItem onSelect={() => setAboutOpen(true)}>关于</MenuItem>
        <MenuItem onSelect={onLogout}>退出登录</MenuItem>
      </Menu>
      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
      <AccountSecurityDialog open={secOpen} onClose={() => setSecOpen(false)} />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  )
}
