import Avatar from '@/shared/components/ClassroomMap/art/Avatar'
import { groupColor } from '@/shared/components/ClassroomMap/art/palette'
import { badgeVariants } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import type { DraftStudent } from './draft'

export interface UnseatedTrayProps {
  students: DraftStudent[]
  selectedId: string | null
  /** 选中了可移出的已就座学生 */
  canUnseat: boolean
  /** 保存 / 加载中:不可编辑 */
  busy: boolean
  /** 头像种子(与地图上的小人一致) */
  seedOf(enrollmentId: string): string
  onSelect(enrollmentId: string): void
  onUnseat(): void
}

/** 待安排托盘:未排座的学生;点一下选中,再点地图上的空座安排进去。 */
export default function UnseatedTray({
  students,
  selectedId,
  canUnseat,
  busy,
  seedOf,
  onSelect,
  onUnseat,
}: UnseatedTrayProps) {
  const title = `待安排 (${students.length})`
  return (
    <section
      aria-label={title}
      className="flex max-h-24 flex-wrap items-center gap-2 overflow-y-auto rounded-lg border bg-card px-3 py-2 text-sm text-card-foreground"
    >
      {/* 文字仍是"待安排 (n)",人数部分用徽章显示 */}
      <h3 className="flex items-center gap-1.5 font-semibold">
        {'待安排 '}
        <span className={badgeVariants({ variant: 'neutral' })}>{`(${students.length})`}</span>
      </h3>
      {students.length === 0 && <span className="text-muted-foreground">全部已安排</span>}
      {students.map((s) => (
        <button
          key={s.enrollmentId}
          type="button"
          aria-pressed={s.enrollmentId === selectedId}
          disabled={busy}
          onClick={() => onSelect(s.enrollmentId)}
          className="flex items-center gap-1 rounded-full border px-2 py-0.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-primary aria-pressed:bg-accent"
        >
          <span aria-hidden="true">
            <Avatar
              gender={s.gender}
              seed={seedOf(s.enrollmentId)}
              color={groupColor(0)}
              size={24}
              title={s.name}
            />
          </span>
          {s.name}
        </button>
      ))}
      {canUnseat && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={busy}
          onClick={onUnseat}
        >
          移到待安排
        </Button>
      )}
    </section>
  )
}
