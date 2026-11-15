import { useRef, type MouseEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { GraduationCap } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

export interface AppShellProps {
  /** 品牌("班级工作台")链接目标 */
  home: string
  /** 品牌右侧的上下文:班级名 / 切换班级;过长时截断(外层给 min-w-0,内容自己带 truncate / max-w,免得裁掉焦点环) */
  context?: ReactNode
  /** 紧随 context 之后、同一行的主导航;不收缩(shrink-0),窄屏由导航自己缩成图标 */
  nav?: ReactNode
  /** 顶栏下面的第二行(家长端 768–1023 宽的导航):和顶栏之间只有一条分隔线,不随 main 滚动 */
  subNav?: ReactNode
  /** 顶栏右侧的操作,所有宽度都显示。AppShell 自身不渲染 ThemeToggle,各 shell 须在此放入 */
  actions: ReactNode
  /** 放在 <main> 之外的东西(抽屉、Toaster) */
  overlays?: ReactNode
  children: ReactNode
}

export default function AppShell({
  home,
  context,
  nav,
  subNav,
  actions,
  overlays,
  children,
}: AppShellProps) {
  const mainRef = useRef<HTMLElement>(null)

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
      <header
        className={cn(
          'flex h-14 shrink-0 items-center justify-between gap-2 bg-background px-3 md:px-4',
          !subNav && 'border-b',
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link
            to={home}
            aria-label="班级工作台"
            title="班级工作台"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-primary"
          >
            <GraduationCap className="h-5 w-5" aria-hidden="true" />
          </Link>
          {context && <div className="flex min-w-0 items-center gap-2">{context}</div>}
          {nav}
        </div>
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </header>
      {subNav && <div className="shrink-0 border-b bg-background px-3 md:px-4">{subNav}</div>}
      <main
        ref={mainRef}
        id="main"
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-auto focus:outline-none"
      >
        {children}
      </main>
      {overlays}
    </div>
  )
}
