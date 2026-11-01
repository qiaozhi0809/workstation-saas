import { useMemo, useRef, useState, type ReactNode } from 'react'
import ClassroomMap from '@/shared/components/ClassroomMap'
import type {
  ClassroomEffects, ClassroomMode, FloatFx, IdleAction, TeacherAction,
} from '@/shared/components/ClassroomMap/types'
import FigureGallery from './FigureGallery'
import { SAMPLE_BOARD, makeSeats, sampleViews } from './fixtures'

const MODES: ClassroomMode[] = ['daily', 'attendance', 'review', 'seating', 'overview', 'mini']
const IDLES: IdleAction[] = ['look', 'raise', 'doze', 'stretch']
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex items-center gap-1 text-sm">{label}{children}</label>
}

export default function ClassroomPlayground() {
  const [rows, setRows] = useState(6)
  const [cols, setCols] = useState(6)
  const [filled, setFilled] = useState(30)
  const [mode, setMode] = useState<ClassroomMode>('daily')
  const [presenting, setPresenting] = useState(false)
  const [idle, setIdle] = useState<IdleAction | ''>('')
  const [figure, setFigure] = useState<'female' | 'male'>('female')
  const [action, setAction] = useState<TeacherAction>('idle')
  const [pickedId, setPickedId] = useState('')
  const [withViews, setWithViews] = useState(false)
  const [floats, setFloats] = useState<FloatFx[]>([])
  const [last, setLast] = useState('')
  const seq = useRef(0)

  const seats = useMemo(() => makeSeats(rows, cols, filled), [rows, cols, filled])
  const picked = seats.some((s) => s.enrollment_id === pickedId) ? pickedId : null
  const effects = useMemo<ClassroomEffects>(() => ({
    idle: idle ? Object.fromEntries(seats.map((s) => [s.enrollment_id, idle])) : {},
    teacher: action, pickedId: picked, spotlightId: picked, floats,
  }), [seats, idle, action, picked, floats])
  const views = useMemo(() => (withViews ? sampleViews(seats) : undefined), [withViews, seats])

  const fire = (tone: FloatFx['tone']) => {
    if (!seats.length) return
    const key = `f${++seq.current}`
    setFloats((fs) => [...fs, { key, enrollmentId: pick(seats).enrollment_id, text: tone === 'plus' ? '+1' : '-1', tone }])
    setTimeout(() => setFloats((fs) => fs.filter((f) => f.key !== key)), 1500)
  }
  const num = (label: string, value: number, set: (n: number) => void, max: number, min = 1) => (
    <Field label={label}>
      <select value={value} onChange={(e) => set(Number(e.target.value))} className="rounded border px-1">
        {Array.from({ length: max - min + 1 }, (_, i) => i + min).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </Field>
  )
  const btn = 'rounded border px-2 py-0.5 text-sm'

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        {num('排数', rows, setRows, 12)}
        {num('列数', cols, setCols, 12)}
        {num('学生数', Math.min(filled, rows * cols), setFilled, rows * cols, 0)}
        <Field label="模式">
          <select value={mode} onChange={(e) => setMode(e.target.value as ClassroomMode)} className="rounded border px-1">
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="">
          <input type="checkbox" checked={presenting} onChange={(e) => setPresenting(e.target.checked)} />投屏
        </Field>
        <Field label="统一姿态">
          <select value={idle} onChange={(e) => setIdle(e.target.value as IdleAction | '')} className="rounded border px-1">
            <option value="">无</option>
            {IDLES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="老师">
          <select value={figure} onChange={(e) => setFigure(e.target.value as 'female' | 'male')} className="rounded border px-1">
            <option value="female">女</option>
            <option value="male">男</option>
          </select>
        </Field>
        <Field label="老师动作">
          <select value={action} onChange={(e) => setAction(e.target.value as TeacherAction)} className="rounded border px-1">
            {(['idle', 'sip', 'point'] as const).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="选中/点名">
          <select value={picked ?? ''} onChange={(e) => setPickedId(e.target.value)} className="rounded border px-1">
            <option value="">无</option>
            {seats.map((s) => <option key={s.enrollment_id} value={s.enrollment_id}>{s.seat_row}-{s.seat_col} {s.name}</option>)}
          </select>
        </Field>
        <button type="button" className={btn} onClick={() => seats.length && setPickedId(pick(seats).enrollment_id)}>随机点名</button>
        <button type="button" className={btn} onClick={() => fire('plus')}>+1 气泡</button>
        <button type="button" className={btn} onClick={() => fire('minus')}>−1 气泡</button>
        <Field label="">
          <input type="checkbox" checked={withViews} onChange={(e) => setWithViews(e.target.checked)} />示例外观
        </Field>
        {last && <span className="text-sm text-ink-2">{last}</span>}
      </div>
      <ClassroomMap
        rows={rows} cols={cols} seats={seats} mode={mode} presenting={presenting}
        teacher={{ figure, label: '张老师 · 班主任' }} board={SAMPLE_BOARD} views={views} effects={effects}
        onSeatClick={(s) => setLast(`点击:${s.name}`)}
        onEmptySeatClick={(c) => setLast(`空座:${c.row}排${c.col}列`)}
      />
      <FigureGallery />
    </div>
  )
}
