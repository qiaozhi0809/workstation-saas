import { useState } from 'react'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import { cn } from '@/shared/lib/utils'
import type { AiCategory, AiTemplate, AiTemplates } from '@/shared/types/ai'

/** 模板分类 + 卡片;只列 hidden=false,不可用的卡片禁用并写明原因。 */
export default function TemplateGrid({ templates, onPick }: {
  templates: AiTemplates
  onPick(t: AiTemplate): void
}) {
  const [cat, setCat] = useState<AiCategory>('rec')
  const shown = templates.items.filter((t) => !t.hidden && (cat === 'rec' ? t.rec : t.cat === cat))
  return (
    <section className="space-y-3">
      <SegmentedTabs
        label="模板分类"
        items={templates.categories.map((c) => ({ value: c.id, label: c.label }))}
        value={cat}
        onChange={(v) => setCat(v as AiCategory)}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={!t.available}
            onClick={() => onPick(t)}
            className={cn(
              'rounded-lg border border-border bg-card p-3 text-left transition-colors',
              'hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-card',
            )}
          >
            <span className="block text-sm font-medium text-foreground">{t.title}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{t.desc}</span>
            {!t.available && t.unavailable_reason && (
              <span className="mt-1 block text-xs text-destructive">{t.unavailable_reason}</span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}
