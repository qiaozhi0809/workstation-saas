import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { examsApi } from '@/shared/api/exams'
import type { ClassroomMapProps, SeatView } from '@/shared/components/ClassroomMap/types'
import { examTable, latestExam, previousExam, rankChanges, rankTint } from '@/shared/lib/grades'
import type { StudentSeat } from '@/shared/types/student'
import GradesBar from './GradesBar'

const BIG_MOVE = 5
const NO_VIEWS: Record<string, SeatView> = {}

export interface GradesMode {
  views: Record<string, SeatView>
  bar: ReactNode
  onSeatClick?: ClassroomMapProps['onSeatClick']
}

/** 成绩模式:桌面按名次五等分着色,进退 5 名以上的挂角标,没有成绩的变淡。 */
export function useGradesMode({ classId, enabled, presenting, roster, onOpenScores }: {
  classId: string
  enabled: boolean
  presenting: boolean
  roster: StudentSeat[]
  onOpenScores(seat: StudentSeat): void
}): GradesMode {
  const gradebook = useQuery({
    queryKey: ['gradebook', classId],
    queryFn: () => examsApi.gradebook(classId),
    enabled,
  })
  const [picked, setPicked] = useState<string | null>(null)
  const exams = gradebook.data?.exams
  const latest = useMemo(() => (exams ? latestExam(exams) : null), [exams])
  const selected = (picked && exams?.find((e) => e.id === picked)) || latest

  const views = useMemo(() => {
    // 页面在有 exam.read 时总会取成绩册,但只有成绩模式才用得上外观
    // 投屏时不展示全班排名:不着色、不挂进退角标、不标无成绩
    if (!enabled || presenting || !exams || !selected) return NO_VIEWS
    const ids = roster.map((s) => s.enrollment_id)
    const cur = examTable(selected, ids)
    const before = previousExam(exams, selected.id)
    const changes = rankChanges(cur, before ? examTable(before, ids) : null)
    const n = cur.filter((r) => r.rank !== null).length
    const out: Record<string, SeatView> = {}
    for (const r of cur) {
      if (r.total === null || r.rank === null) { out[r.id] = { ghost: true, badge: { text: '无成绩', tone: 'gray' } }; continue }
      const view: SeatView = { tint: rankTint(r.rank, n) }
      const c = changes.get(r.id) ?? 0
      if (c >= BIG_MOVE) view.badge = { text: `#${r.rank} ↑${c}`, tone: 'green', strong: true }
      else if (c <= -BIG_MOVE) view.badge = { text: `#${r.rank} ↓${-c}`, tone: 'red', strong: true }
      out[r.id] = view
    }
    return out
  }, [enabled, presenting, exams, selected, roster])

  let bar: ReactNode = null
  if (gradebook.isError && !gradebook.data) bar = <p role="alert" className="text-sm text-destructive">成绩加载失败</p>
  else if (exams) {
    bar = (
      <GradesBar
        exams={selected ? [...exams].reverse() : []}
        value={selected?.id ?? ''}
        onChange={setPicked}
        showLegend={!presenting}
        analysisHref={`/teacher/analysis?exam=${selected?.id ?? ''}`}
      />
    )
  }
  return { views, bar, onSeatClick: presenting ? undefined : onOpenScores }
}
