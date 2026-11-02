import { Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

export function LoadingState({ label = '加载中…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground', className)}>
      <Loader2 aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />
      <span>{label}</span>
    </div>
  )
}
