import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

export function ErrorState({
  title,
  description,
  onRetry,
  retrying,
  className,
}: {
  title: string
  description?: string
  onRetry?: () => void
  retrying?: boolean
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center gap-2 py-8 text-center', className)}
    >
      <p className="text-sm font-medium text-destructive">{title}</p>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          重试
        </Button>
      )}
    </div>
  )
}
