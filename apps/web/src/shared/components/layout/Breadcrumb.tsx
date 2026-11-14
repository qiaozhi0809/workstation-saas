import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Crumb } from './crumbs'

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="面包屑" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        {items.map((c, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${i}-${c.label}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
              {c.to && !last ? (
                <Link to={c.to} className="truncate rounded-sm hover:text-foreground">
                  {c.label}
                </Link>
              ) : (
                <span
                  className={last ? 'truncate font-medium text-foreground' : 'truncate'}
                  aria-current={last ? 'page' : undefined}
                >
                  {c.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
