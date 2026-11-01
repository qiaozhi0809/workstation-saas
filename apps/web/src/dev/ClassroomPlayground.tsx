import { useMemo, useState } from 'react'
import ClassroomMap from '@/shared/components/ClassroomMap'
import type { ClassroomMode, IdleAction, TeacherAction } from '@/shared/components/ClassroomMap/types'
import FigureGallery from './FigureGallery'
import ScenePreview from './ScenePreview'
import { makeSeats } from './fixtures'

const MODES: ClassroomMode[] = ['daily', 'attendance', 'review', 'seating', 'overview', 'mini']
const IDLES: IdleAction[] = ['look', 'raise', 'doze', 'stretch']

export default function ClassroomPlayground() {
  const [rows, setRows] = useState(6)
  const [cols, setCols] = useState(6)
  const [filled, setFilled] = useState(30)
  const [mode, setMode] = useState<ClassroomMode>('daily')
  const [presenting, setPresenting] = useState(false)
  const [idle, setIdle] = useState<IdleAction | ''>('')
  const [figure, setFigure] = useState<'female' | 'male'>('female')
  const [action, setAction] = useState<TeacherAction>('idle')

  const seats = useMemo(() => makeSeats(rows, cols, filled), [rows, cols, filled])
  const effects = useMemo(
    () => ({ idle: idle ? Object.fromEntries(seats.map((s) => [s.enrollment_id, idle])) : {} }),
    [seats, idle],
  )
  const num = (label: string, value: number, set: (n: number) => void, max: number, min = 1) => (
    <label className="flex items-center gap-1 text-sm">{label}
      <select value={value} onChange={(e) => set(Number(e.target.value))} className="rounded border px-1">
        {Array.from({ length: max - min + 1 }, (_, i) => i + min).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  )

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        {num('排数', rows, setRows, 12)}
        {num('列数', cols, setCols, 12)}
        {num('学生数', Math.min(filled, rows * cols), setFilled, rows * cols, 0)}
        <label className="flex items-center gap-1 text-sm">模式
          <select value={mode} onChange={(e) => setMode(e.target.value as ClassroomMode)} className="rounded border px-1">
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={presenting} onChange={(e) => setPresenting(e.target.checked)} />投屏
        </label>
        <label className="flex items-center gap-1 text-sm">统一姿态
          <select value={idle} onChange={(e) => setIdle(e.target.value as IdleAction | '')} className="rounded border px-1">
            <option value="">无</option>
            {IDLES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm">老师
          <select value={figure} onChange={(e) => setFigure(e.target.value as 'female' | 'male')} className="rounded border px-1">
            <option value="female">女</option>
            <option value="male">男</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm">老师动作
          <select value={action} onChange={(e) => setAction(e.target.value as TeacherAction)} className="rounded border px-1">
            {(['idle', 'sip', 'point'] as const).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <ClassroomMap
        rows={rows} cols={cols} seats={seats} mode={mode} presenting={presenting}
        teacher={{ figure, label: '班主任' }} effects={effects}
      />
      <ScenePreview rows={rows} cols={cols} figure={figure} action={action} />
      <FigureGallery />
    </div>
  )
}
