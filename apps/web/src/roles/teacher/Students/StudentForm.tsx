import {
  cloneElement,
  isValidElement,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { schoolApi } from '@/shared/api/school'
import { studentsApi } from '@/shared/api/students'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { Textarea } from '@/shared/components/ui/textarea'
import { FAMILY_TYPES } from '@/shared/lib/columns'
import { gridCells, gridOf, podiumCells, seatText } from '@/shared/lib/seats'
import { DEFAULT_TAG_POOL } from '@/shared/lib/tags'
import { cn } from '@/shared/lib/utils'
import type { ClassView } from '@/shared/types/class'
import type { Contact, StudentInput, StudentRecord, StudentSeat } from '@/shared/types/student'
import { invalidateRosterQueries } from './invalidate'

// 预设枚举来自原版(PRD §1.9)
const ROLES = [
  '班长',
  '副班长',
  '学习委员',
  '纪律委员',
  '体育委员',
  '文艺委员',
  '劳动委员',
  '宣传委员',
  '心理委员',
  '语文课代表',
  '数学课代表',
  '英语课代表',
  '物理课代表',
  '化学课代表',
  '小组长',
]
const RELATIONS = ['母亲', '父亲', '祖母', '祖父', '外祖母', '外祖父', '其他']
const BOARDING_TAG = '住校'
const MAX_TAGS = 12

/** 现有数字学号里最大的那个 +1,保持它的前缀和位宽;没有数字学号 → 空。 */
// eslint-disable-next-line react-refresh/only-export-components
export function nextStudentNo(roster: Pick<StudentSeat, 'student_no'>[]): string {
  let best: { prefix: string; digits: string; n: bigint } | null = null
  for (const r of roster) {
    const m = /^(.*?)(\d+)$/.exec(r.student_no ?? '')
    if (!m) continue
    const n = BigInt(m[2])
    if (!best || n > best.n) best = { prefix: m[1], digits: m[2], n }
  }
  if (!best) return ''
  return best.prefix + String(best.n + 1n).padStart(best.digits.length, '0')
}

interface FormState {
  name: string
  gender: string
  studentNo: string
  birthdate: string
  classRole: string
  seat: string
  tags: string[]
  boarding: boolean
  family: string
  contacts: Contact[]
  familyNote: string
  learning: string
  personality: string
  health: string
  note: string
}

const emptyContact = (): Contact => ({ name: '', relation: '', phone: '', job: '' })
const seatKey = (row: number | null, col: number | null) =>
  row !== null && col !== null ? `${row}-${col}` : ''
const AUTO_SEAT = 'auto'
// 讲台座位的列是负数("0--1"),不能直接按 - 拆开
const parseSeat = (v: string): { row: number; col: number } | null => {
  const m = /^(\d+)-(-?\d+)$/.exec(v)
  return m ? { row: Number(m[1]), col: Number(m[2]) } : null
}
/** 新增学生、按人数自动排的班级、普通座位已坐满:提供"自动加座位"并默认选中 */
const wantsAutoSeat = (cls: ClassView, roster: StudentSeat[], editing: boolean) =>
  !editing &&
  cls.seat_layout === 'auto' &&
  gridCells(gridOf(cls)).every((c) =>
    roster.some((s) => s.seat_row === c.row && s.seat_col === c.col),
  )

// 编辑表单依赖: 持有 student.manage 的角色同时拥有全部读权限(read_basic/family/learning/profile),
// 见 server/app/rbac/roles.py;否则记录里缺失的字段会回退为空值并被 PUT 覆盖掉。权限矩阵变动时需重新评估。
function initialState(
  record: StudentRecord | undefined,
  roster: StudentSeat[],
  autoSeat = false,
): FormState {
  const tags = record?.tags ?? []
  const contacts = [...(record?.contacts ?? []), emptyContact(), emptyContact()].slice(0, 2)
  return {
    name: record?.name ?? '',
    gender: record?.gender ?? '',
    studentNo: record ? (record.student_no ?? '') : nextStudentNo(roster),
    birthdate: record?.birthdate ?? '',
    classRole: record?.class_role ?? '',
    seat: record ? seatKey(record.seat_row, record.seat_col) : autoSeat ? AUTO_SEAT : '',
    tags,
    boarding: record?.boarding === true || tags.includes(BOARDING_TAG),
    family: record?.family_structure ?? '',
    contacts,
    familyNote: record?.family_note ?? '',
    learning: record?.learning_summary ?? '',
    personality: record?.personality ?? '',
    health: record?.health_notes ?? '',
    note: record?.note ?? '',
  }
}

const orNull = (s: string) => s.trim() || null

function Field({
  id,
  label,
  error,
  className,
  children,
}: {
  id: string
  label: string
  error?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <Label htmlFor={id}>{label}</Label>
      {error && isValidElement<Record<string, unknown>>(children)
        ? cloneElement(children, { 'aria-invalid': true, 'aria-describedby': `${id}-error` })
        : children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export default function StudentForm({
  cls,
  record,
  roster,
  onClose,
}: {
  cls: ClassView
  record?: StudentRecord
  roster: StudentSeat[]
  onClose(): void
}) {
  const qc = useQueryClient()
  const uid = useId()
  const id = (k: string) => `${uid}-${k}`
  const editing = !!record
  const nameRef = useRef<HTMLInputElement>(null)
  // 每行联系人的"姓名"框:校验出错时焦点落到第一个出错的那行(L14)
  const contactNameRefs = useRef<(HTMLInputElement | null)[]>([])
  const [f, setF] = useState(() =>
    initialState(record, roster, wantsAutoSeat(cls, roster, !!record)),
  )
  // 标签池来自学校设置;加载中或失败时用默认池兜底
  const pool =
    useQuery({ queryKey: ['tag-pool'], queryFn: schoolApi.tagPool }).data?.tags ?? DEFAULT_TAG_POOL
  const [custom, setCustom] = useState(() => record?.tags ?? [])
  const [customDraft, setCustomDraft] = useState('')
  // 想选第 13 个标签时提示,取消一个后清掉(L15)
  const [tagsFull, setTagsFull] = useState(false)
  const [keepAdding, setKeepAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<{
    name?: string
    studentNo?: string
    seat?: string
    /** 出错的联系人行号(0 起)与提示 */
    contact?: { at: number; text: string }
    form?: string
  }>({})
  const [confirmDelete, setConfirmDelete] = useState(false)

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }))
  const setContact = (i: number, patch: Partial<Contact>) =>
    setF((s) => ({ ...s, contacts: s.contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))

  const toggleTag = (tag: string) => {
    const on = !f.tags.includes(tag)
    if (on && f.tags.length >= MAX_TAGS) {
      setTagsFull(true)
      return
    }
    setTagsFull(false)
    setF((s) => {
      const tags = on ? [...s.tags, tag] : s.tags.filter((t) => t !== tag)
      return { ...s, tags, boarding: tag === BOARDING_TAG ? on : s.boarding }
    })
  }
  // 住校勾选框与"住校"标签同步:走 toggleTag,满 12 个时同样只提示、不加第 13 个;取消时同样清掉提示
  const toggleBoarding = (on: boolean) => {
    if (on === f.tags.includes(BOARDING_TAG)) set('boarding', on)
    else toggleTag(BOARDING_TAG)
  }
  const addCustomTag = () => {
    const tag = customDraft.trim()
    if (!tag) return
    // 已满:只提示,输入保留,不悄悄丢掉
    if (!f.tags.includes(tag) && f.tags.length >= MAX_TAGS) {
      setTagsFull(true)
      return
    }
    if (!pool.includes(tag) && !custom.includes(tag)) setCustom((c) => [...c, tag])
    if (!f.tags.includes(tag)) toggleTag(tag)
    setCustomDraft('')
  }

  const grid = gridOf(cls)
  const seatOptions: { value: string; label: string; disabled: boolean }[] = []
  if (wantsAutoSeat(cls, roster, editing))
    seatOptions.push({ value: AUTO_SEAT, label: '自动加座位', disabled: false })
  seatOptions.push({ value: '', label: '不排座', disabled: false })
  for (const { row, col } of [...podiumCells(grid), ...gridCells(grid)]) {
    const occupant = roster.find(
      (s) => s.seat_row === row && s.seat_col === col && s.enrollment_id !== record?.enrollment_id,
    )
    let suffix = ''
    if (occupant)
      suffix = occupant.seat_locked
        ? ' (已固定)'
        : editing
          ? ' (将互换)'
          : ' (原座位同学将挪到空位)'
    seatOptions.push({
      value: `${row}-${col}`,
      label: `${seatText({ row, col }, grid)}${suffix}`,
      disabled: !!occupant?.seat_locked,
    })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const name = f.name.trim()
    const trimmed = f.contacts.map((c) => ({
      name: c.name.trim(),
      relation: c.relation.trim(),
      phone: c.phone.trim(),
      job: c.job.trim(),
    }))
    const filled = (c: Contact) => !!(c.name || c.relation || c.phone || c.job)
    const contacts = trimmed.filter(filled)
    const next: typeof errors = {}
    if (!name) next.name = '请填写姓名'
    const badContact = trimmed.findIndex((c) => filled(c) && !c.name && !c.phone)
    if (badContact >= 0) next.contact = { at: badContact, text: '联系人姓名和电话至少填一项' }
    setErrors(next)
    if (Object.keys(next).length > 0) {
      // 焦点移到表单里最靠前的出错字段
      if (next.name) nameRef.current?.focus()
      else if (next.contact) contactNameRefs.current[next.contact.at]?.focus()
      return
    }

    const picked = parseSeat(f.seat)
    const input: StudentInput = {
      name,
      gender: f.gender === '男' || f.gender === '女' ? f.gender : null,
      student_no: orNull(f.studentNo),
      birthdate: f.birthdate || null,
      class_role: orNull(f.classRole),
      tags: f.tags,
      boarding: f.boarding,
      family_structure: f.family || null,
      family_note: orNull(f.familyNote),
      learning_summary: orNull(f.learning),
      personality: orNull(f.personality),
      note: orNull(f.note),
      health_notes: orNull(f.health),
      contacts,
      seat: picked,
      ...(f.seat === AUTO_SEAT ? { auto_seat: true } : {}),
    }
    setBusy(true)
    try {
      const saved = record
        ? await studentsApi.update(cls.id, record.enrollment_id, input)
        : await studentsApi.create(cls.id, input)
      void invalidateRosterQueries(qc)
      toast(record ? `已保存${name}` : `已添加${name}`)
      if (!record && keepAdding) {
        setF(
          initialState(
            undefined,
            [...roster, saved],
            wantsAutoSeat(cls, [...roster, saved], false),
          ),
        )
        setCustom([])
        setCustomDraft('')
      } else onClose()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_STUDENT_NO')
        setErrors({ studentNo: '这个学号已经有人用了' })
      else if (err instanceof ApiError && err.code === 'SEAT_LOCKED')
        setErrors({ seat: '该座位的同学已固定,不能互换' })
      else setErrors({ form: err instanceof ApiError ? err.message : '保存失败,请重试' })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!record) return
    setBusy(true)
    try {
      await studentsApi.remove(cls.id, record.enrollment_id)
      void invalidateRosterQueries(qc)
      toast(`已删除${record.name}`)
      onClose()
    } catch (err) {
      setConfirmDelete(false)
      setErrors({ form: err instanceof ApiError ? err.message : '删除失败,请重试' })
    } finally {
      setBusy(false)
    }
  }

  const chips = [...pool, ...custom.filter((t) => !pool.includes(t))]

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? '编辑学生' : '添加学生'}
      dismissOnOutside={false}
      className="max-w-2xl"
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id={id('name')} label="姓名" error={errors.name}>
            <Input
              ref={nameRef}
              id={id('name')}
              maxLength={20}
              value={f.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field id={id('gender')} label="性别">
            <NativeSelect
              id={id('gender')}
              className="w-full"
              value={f.gender}
              onChange={(e) => set('gender', e.target.value)}
            >
              <option value="">未填</option>
              <option value="男">男</option>
              <option value="女">女</option>
            </NativeSelect>
          </Field>
          <Field id={id('no')} label="学号" error={errors.studentNo}>
            <Input
              id={id('no')}
              maxLength={20}
              value={f.studentNo}
              onChange={(e) => set('studentNo', e.target.value)}
            />
          </Field>
          <Field id={id('birthdate')} label="生日">
            <Input
              id={id('birthdate')}
              type="date"
              value={f.birthdate}
              onChange={(e) => set('birthdate', e.target.value)}
            />
          </Field>
          <Field id={id('role')} label="职务">
            <Input
              id={id('role')}
              list={id('roles')}
              maxLength={10}
              value={f.classRole}
              onChange={(e) => set('classRole', e.target.value)}
            />
            <datalist id={id('roles')}>
              {ROLES.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </Field>
          <Field id={id('seat')} label="座位" error={errors.seat}>
            <NativeSelect
              id={id('seat')}
              className="w-full"
              value={f.seat}
              onChange={(e) => set('seat', e.target.value)}
            >
              {seatOptions.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id={id('family')} label="家庭结构">
            <NativeSelect
              id={id('family')}
              className="w-full"
              value={f.family}
              onChange={(e) => set('family', e.target.value)}
            >
              <option value="">未填</option>
              {FAMILY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={f.boarding}
                onChange={(e) => toggleBoarding(e.target.checked)}
              />
              住校
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <Label>标签</Label>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((t) => {
              const on = f.tags.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleTag(t)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    on
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-background text-foreground hover:bg-accent',
                  )}
                >
                  {t}
                </button>
              )
            })}
          </div>
          <Input
            aria-label="自定义标签"
            placeholder="+ 自定义,回车添加"
            maxLength={10}
            className="max-w-48"
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            onKeyDown={(e) => {
              // Safari 在输入法结束后的那次 Enter 上 isComposing 已为 false,但 keyCode 仍是 229
              if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return
              e.preventDefault()
              addCustomTag()
            }}
          />
          {tagsFull && (
            <p role="status" className="text-sm text-muted-foreground">
              {`最多选 ${MAX_TAGS} 个标签,先取消一个再选`}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>联系人</Label>
          <datalist id={id('relations')}>
            {RELATIONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          {f.contacts.map((c, i) => {
            // 出错的那行:姓名与电话(二选一的两个字段)标 aria-invalid 并关联提示
            const bad = errors.contact?.at === i
            const invalid = bad
              ? { 'aria-invalid': true, 'aria-describedby': id('contact-error') }
              : {}
            return (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Input
                  ref={(el) => {
                    contactNameRefs.current[i] = el
                  }}
                  aria-label={`联系人${i + 1}姓名`}
                  placeholder="姓名"
                  maxLength={20}
                  value={c.name}
                  onChange={(e) => setContact(i, { name: e.target.value })}
                  {...invalid}
                />
                <Input
                  aria-label={`联系人${i + 1}关系`}
                  placeholder="关系"
                  list={id('relations')}
                  maxLength={10}
                  value={c.relation}
                  onChange={(e) => setContact(i, { relation: e.target.value })}
                />
                <Input
                  aria-label={`联系人${i + 1}电话`}
                  placeholder="电话"
                  maxLength={20}
                  value={c.phone}
                  onChange={(e) => setContact(i, { phone: e.target.value })}
                  {...invalid}
                />
                <Input
                  aria-label={`联系人${i + 1}职业`}
                  placeholder="职业"
                  maxLength={20}
                  value={c.job}
                  onChange={(e) => setContact(i, { job: e.target.value })}
                />
              </div>
            )
          })}
          {errors.contact && (
            <p id={id('contact-error')} className="text-sm text-destructive">
              {errors.contact.text}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id={id('familyNote')} label="家庭备注">
            <Textarea
              id={id('familyNote')}
              maxLength={500}
              value={f.familyNote}
              onChange={(e) => set('familyNote', e.target.value)}
            />
          </Field>
          <Field id={id('learning')} label="学习情况">
            <Textarea
              id={id('learning')}
              maxLength={500}
              value={f.learning}
              onChange={(e) => set('learning', e.target.value)}
            />
          </Field>
          <Field id={id('personality')} label="性格与特长">
            <Textarea
              id={id('personality')}
              maxLength={500}
              value={f.personality}
              onChange={(e) => set('personality', e.target.value)}
            />
          </Field>
          <Field id={id('health')} label="健康情况">
            <Textarea
              id={id('health')}
              maxLength={300}
              value={f.health}
              onChange={(e) => set('health', e.target.value)}
            />
          </Field>
          <Field id={id('note')} label="其他备注" className="sm:col-span-2">
            <Textarea
              id={id('note')}
              maxLength={500}
              value={f.note}
              onChange={(e) => set('note', e.target.value)}
            />
          </Field>
        </div>

        {errors.form && (
          <p role="alert" className="text-sm text-destructive">
            {errors.form}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              删除学生
            </Button>
          ) : (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={keepAdding}
                onChange={(e) => setKeepAdding(e.target.checked)}
              />
              保存后继续添加
            </label>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              保存
            </Button>
          </div>
        </div>
      </form>

      {record && (
        <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="删除学生">
          <p className="text-sm">{`删除${record.name}?删除后该学生不再出现在名单、教室和成绩里。`}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              确认删除
            </Button>
          </div>
        </Modal>
      )}
    </Modal>
  )
}
