import * as React from 'react'
import { cn } from '@/shared/lib/utils'

type Density = 'default' | 'compact'
const DensityContext = React.createContext<Density>('default')

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** 行高 44 / 36 */
  density?: Density
  /** 设了就包一层横向滚动容器,table 的 min-width 用这个值(px) */
  minWidth?: number
  caption?: string
}

export function Table({
  density = 'default',
  minWidth,
  caption,
  className,
  style,
  children,
  ...props
}: TableProps) {
  const table = (
    <table
      className={cn('w-auto text-sm', className)}
      style={minWidth ? { ...style, minWidth: `${minWidth}px` } : style}
      {...props}
    >
      {caption && <caption className="sr-only">{caption}</caption>}
      {children}
    </table>
  )
  return (
    <DensityContext.Provider value={density}>
      <div data-slot="table-container" className="rounded-lg bg-card shadow-surface">
        {minWidth ? (
          <div data-table-scroll className="overflow-x-auto rounded-lg">
            {table}
          </div>
        ) : (
          table
        )}
      </div>
    </DensityContext.Provider>
  )
}

export const TableHead = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className={cn(className)} {...props} />

export const TableBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody className={cn(className)} {...props} />

export const TableFoot = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <tfoot className={cn('font-medium', className)} {...props} />
)

export const TableRow = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => {
  const density = React.useContext(DensityContext)
  return (
    <tr
      className={cn(
        density === 'compact' ? 'h-9' : 'h-11',
        // 表头行固定 40
        '[thead_&]:h-10',
        'border-b border-border/60 last:border-b-0',
        className,
      )}
      {...props}
    />
  )
}

type CellAlign = 'start' | 'end'

function alignClass({ numeric, align }: { numeric?: boolean; align?: CellAlign }) {
  // numeric 是 Q2(数字列右对齐 + 等宽数字)的唯一映射点
  if (numeric) return 'text-right tabular-nums'
  if (align === 'end') return 'text-right'
  return 'text-left'
}

export interface ThProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean
  align?: CellAlign
  nowrap?: boolean
}

export function Th({ numeric, align, nowrap = true, className, scope = 'col', ...props }: ThProps) {
  return (
    <th
      scope={scope}
      className={cn(
        'h-10 px-3 text-xs font-medium text-muted-foreground',
        alignClass({ numeric, align }),
        nowrap && 'whitespace-nowrap',
        className,
      )}
      {...props}
    />
  )
}

export interface TdProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean
  align?: CellAlign
  nowrap?: boolean
}

export function Td({ numeric, align, nowrap = true, className, ...props }: TdProps) {
  return (
    <td
      className={cn(
        'px-3 align-middle',
        alignClass({ numeric, align }),
        nowrap && 'whitespace-nowrap',
        className,
      )}
      {...props}
    />
  )
}
