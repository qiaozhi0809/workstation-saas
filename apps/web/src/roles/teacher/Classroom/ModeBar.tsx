import type { ClassPerm } from '@/shared/types/classroom'

export type ClassroomUiMode = 'daily' | 'attendance' | 'review' | 'seating'

// 成绩模式属于 M2b,这里不出现
const MODES: { mode: ClassroomUiMode; label: string; perm: ClassPerm | null }[] = [
  { mode: 'daily', label: '日常', perm: null },
  { mode: 'attendance', label: '考勤', perm: 'attendance.read' },
  { mode: 'review', label: '点评', perm: 'review.read' },
  { mode: 'seating', label: '排座', perm: 'seating.write' },
]

/** 我的权限下可用的模式(日常始终可用),按模式条顺序。 */
// eslint-disable-next-line react-refresh/only-export-components
export function modesFor(perms: readonly ClassPerm[]): ClassroomUiMode[] {
  return MODES.filter((m) => !m.perm || perms.includes(m.perm)).map((m) => m.mode)
}

export default function ModeBar({ mode, perms, onChange }: {
  mode: ClassroomUiMode
  perms: readonly ClassPerm[]
  onChange(mode: ClassroomUiMode): void
}) {
  const allowed = modesFor(perms)
  return (
    <div role="tablist" aria-label="教室模式" className="flex justify-center gap-1 rounded-xl bg-panel p-1 shadow-sm">
      {MODES.filter((m) => allowed.includes(m.mode)).map((m) => (
        <button key={m.mode} type="button" role="tab" aria-selected={mode === m.mode}
          onClick={() => { if (m.mode !== mode) onChange(m.mode) }}
          className={`rounded-lg px-5 py-1.5 text-sm ${mode === m.mode ? 'bg-ink text-white' : 'text-ink-2 hover:bg-fill'}`}>
          {m.label}
        </button>
      ))}
    </div>
  )
}
