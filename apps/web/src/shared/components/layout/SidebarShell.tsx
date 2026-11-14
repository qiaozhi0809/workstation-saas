import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { Menu as MenuIcon } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import SidePanel from '@/shared/components/overlay/SidePanel'
import { Button } from '@/shared/components/ui/button'
import { Sidebar, type SidebarGroup } from './Sidebar'
import { isSidebarShortcut, useSidebarState, type SidebarScope } from './useSidebarState'

export interface SidebarShellProps {
  scope: SidebarScope
  groups: SidebarGroup[]
  navLoading?: boolean
  header(collapsed: boolean): ReactNode
  footer(collapsed: boolean): ReactNode
  /** null = 不渲染面包屑条(教室) */
  breadcrumb: ReactNode | null
  /** 抽屉形态下顶部条里菜单按钮右边的内容;只在 breadcrumb 为 null 时用(教室页的班名与周次) */
  drawerBar?: ReactNode
  /** 放在 <main> 之外的东西(抽屉、Toaster) */
  overlays?: ReactNode
  children: ReactNode
}

export default function SidebarShell({
  scope,
  groups,
  navLoading,
  header,
  footer,
  breadcrumb,
  drawerBar,
  overlays,
  children,
}: SidebarShellProps) {
  const { mode, collapsed, toggle, drawerOpen, setDrawerOpen } = useSidebarState(scope)
  const mainRef = useRef<HTMLElement>(null)
  const { pathname } = useLocation()

  // 不走原生 #main 跳转:那会产生 data router 不认识的历史记录,惊动教室页的路由守卫
  const skipToMain = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    mainRef.current?.focus()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSidebarShortcut(e)) return
      e.preventDefault()
      toggle()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toggle])

  // 抽屉里点了链接:换页后收起
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname, setDrawerOpen])

  const drawer = mode === 'drawer'
  const showBar = drawer || breadcrumb !== null

  return (
    <div className="flex h-full bg-background">
      <a
        href="#main"
        onClick={skipToMain}
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-overlay focus:outline-none focus:ring-2 focus:ring-ring"
      >
        跳到主要内容
      </a>
      {!drawer && (
        <Sidebar
          groups={groups}
          collapsed={collapsed}
          onToggle={toggle}
          navLoading={navLoading}
          header={header(collapsed)}
          footer={footer(collapsed)}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {showBar && (
          <div className="flex h-12 shrink-0 items-center gap-2 px-4 lg:px-8">
            {drawer && (
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label="打开菜单"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
              >
                <MenuIcon className="h-5 w-5" aria-hidden="true" />
              </Button>
            )}
            {breadcrumb ?? drawerBar}
          </div>
        )}
        <main
          ref={mainRef}
          id="main"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-auto focus:outline-none"
        >
          {children}
        </main>
      </div>
      {drawer && (
        <SidePanel
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="菜单"
          side="left"
          className="p-4"
        >
          <Sidebar
            variant="drawer"
            groups={groups}
            collapsed={false}
            onToggle={() => setDrawerOpen(false)}
            navLoading={navLoading}
            header={header(false)}
            footer={footer(false)}
          />
        </SidePanel>
      )}
      {overlays}
    </div>
  )
}
