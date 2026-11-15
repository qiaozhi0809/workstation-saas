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
  compact = false,
}: {
  name: string | undefined
  onLogout(): void
  switchTo?: { label: string; to: string; context: Context }[]
  /** 是否显示"我的偏好"(教师端专有),默认显示 */
  preferences?: boolean
  /** 菜单弹出方向;侧栏展开时在底部用 'top',rail 下用 'right'(从底部往上、在侧栏右边展开) */
  placement?: 'top' | 'bottom' | 'right'
  /** 只显示头像、不画下拉箭头(侧栏 rail 宽 72,放不下头像加箭头) */
  compact?: boolean
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
        // rail 下的间距:aside 72 宽、footer 内边距 12,内容区 48;账号按钮 44 宽居中,右缘离侧栏右缘
        // 12 + 2 = 14px。默认的 ml-2(8px)推不出侧栏,所以用 ml-6(24px):24 - 14 = 浮层左缘在侧栏外 10px
        className={placement === 'right' ? 'ml-6' : undefined}
        triggerProps={{
          variant: 'ghost',
          size: 'touch',
          className: compact ? 'touch-target px-0' : 'touch-target gap-1 px-1.5',
          'aria-label': '账号菜单',
          title: name,
        }}
        trigger={
          <>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
              {Array.from(name ?? '')[0] ?? <User className="h-4 w-4" aria-hidden="true" />}
            </span>
            {!compact && <ChevronDown className="h-4 w-4" aria-hidden="true" />}
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
