import Avatar from '@/shared/components/ClassroomMap/art/Avatar'
import { groupColor } from '@/shared/components/ClassroomMap/art/palette'
import { toolButton } from '../Toolbar'
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
export default function UnseatedTray({ students, selectedId, canUnseat, busy, seedOf, onSelect, onUnseat }: UnseatedTrayProps) {
  const title = `待安排 (${students.length})`
  return (
    <section aria-label={title} className="flex max-h-24 flex-wrap items-center gap-2 overflow-y-auto rounded-xl bg-panel px-3 py-2 text-sm">
      <h3 className="font-semibold">{title}</h3>
      {students.length === 0 && <span className="text-ink-2">全部已安排</span>}
      {students.map((s) => (
        <button key={s.enrollmentId} type="button" aria-pressed={s.enrollmentId === selectedId} disabled={busy}
          onClick={() => onSelect(s.enrollmentId)}
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${
            s.enrollmentId === selectedId ? 'border-ink bg-fill' : 'border-line-2 hover:bg-fill'}`}>
          <span aria-hidden="true">
            <Avatar gender={s.gender} seed={seedOf(s.enrollmentId)} color={groupColor(0)} size={24} title={s.name} />
          </span>
          {s.name}
        </button>
      ))}
      {canUnseat && (
        <button type="button" className={`${toolButton} ml-auto`} disabled={busy} onClick={onUnseat}>移到待安排</button>
      )}
    </section>
  )
}
