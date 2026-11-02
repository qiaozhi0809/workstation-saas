import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { GraduationCap, Menu } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import SidePanel from '@/shared/components/overlay/SidePanel'

export type ShellLayout = 'bar' | 'menu'

export interface AppShellProps {
  /** 品牌("班级工作台")链接目标 */
  home: string
  /** 品牌右侧的上下文:班级名 / 切换班级;过长时截断(外层给 min-w-0,内容自己带 truncate / max-w,免得裁掉焦点环) */
  context?: ReactNode
  /** 右侧操作。'bar':顶栏横排(≥768px 显示);'menu':窄屏菜单抽屉里竖排 */
  actions(layout: ShellLayout): ReactNode
  /** 放在 <main> 之外的东西(抽屉、Toaster) */
  overlays?: ReactNode
  children: ReactNode
}

export default function AppShell({ home, context, actions, overlays, children }: AppShellProps) {
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // 地址一变(站内跳转、后退)就关菜单;在 render 里对比上次的地址,不用 effect
  const [seenKey, setSeenKey] = useState(location.key)
  if (seenKey !== location.key) {
    setSeenKey(location.key)
    setMenuOpen(false)
  }

  // 不走原生 #main 跳转:那会产生 data router 不认识的历史记录,惊动教室页的路由守卫
  const skipToMain = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    mainRef.current?.focus()
  }

  return (
    <div className="flex h-full flex-col">
      <a
        href="#main"
        onClick={skipToMain}
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow focus:outline-none focus:ring-2 focus:ring-ring"
      >
        跳到主要内容
      </a>
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background px-3 md:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link to={home} className="flex shrink-0 items-center gap-2 font-semibold text-foreground">
            <GraduationCap className="h-5 w-5 text-primary" aria-hidden="true" />
            班级工作台
          </Link>
          {context && <div className="flex min-w-0 items-center gap-2">{context}</div>}
        </div>
        <div className="flex shrink-0 items-center">
          <div className="hidden items-center gap-1 md:flex">{actions('bar')}</div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 md:hidden"
            aria-label="打开菜单"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>
      </header>
      <SidePanel open={menuOpen} onClose={() => setMenuOpen(false)} title="菜单" side="right">
        <div className="flex flex-col gap-1">{actions('menu')}</div>
      </SidePanel>
      <main ref={mainRef} id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-auto focus:outline-none">
        {children}
      </main>
      {overlays}
    </div>
  )
}
