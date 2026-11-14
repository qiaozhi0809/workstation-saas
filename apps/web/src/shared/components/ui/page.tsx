import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

export type PageWidth = 'default' | 'narrow' | 'full'

export interface PageContainerProps {
  width?: PageWidth
  className?: string
  children: ReactNode
}

/**
 * 页面容器:default 最大宽 1320;narrow 外框同 default(标题左缘对齐),
 * 除标题区之外的内容限 max-w-3xl;full 不限宽。左右 16 / ≥1024 宽 32,上下 24。
 */
export function PageContainer({ width = 'default', className, children }: PageContainerProps) {
  return (
    <div
      data-page-container
      data-width={width}
      className={cn(
        'mx-auto w-full px-4 py-6 lg:px-8',
        width !== 'full' && 'max-w-[1320px]',
        width === 'narrow' && '[&>*:not([data-page-header])]:max-w-3xl',
        className,
      )}
    >
      {children}
    </div>
  )
}

export interface PageHeaderProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
}

/** 页面头:每页唯一的 <h1> + 描述 + 右对齐操作区。 */
export function PageHeader({ title, description, actions, meta }: PageHeaderProps) {
  return (
    <header
      data-page-header
      className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-medium sm:text-3xl">{title}</h1>
          {meta}
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </header>
  )
}
