import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { ApiError } from '@/shared/api/client'
import { schoolApi } from '@/shared/api/school'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import type { SubjectFull } from '@/shared/types/grades'
import { STAGES, STAGE_LABEL, type Stage, type SubjectCatalog } from '@/shared/types/school'

const QUERY_KEY = ['school', 'subject-catalog']

const MAX_SUBJECTS = 20
const NAME_MAX = 10
const FULL_MSG = '满分须为 1–1000 的整数'
const validFull = (n: number) => Number.isInteger(n) && n >= 1 && n <= 1000
const nameLen = (s: string) => Array.from(s).length

/** 草稿里满分先存字符串,保存时再转数字校验 */
type DraftList = { name: string; full: string }[]
type Draft = Record<Stage, DraftList>

const toDraft = (c: SubjectCatalog): Draft =>
  Object.fromEntries(
    STAGES.map((s) => [s, c[s].map((x) => ({ name: x.name, full: String(x.full) }))]),
  ) as Draft

/** 整份目录的校验:返回第一条问题;'' 表示合法 */
function validate(d: Draft): string {
  for (const s of STAGES) {
    const label = STAGE_LABEL[s]
    if (d[s].length === 0) return `${label}至少要有 1 门科目`
    if (d[s].length > MAX_SUBJECTS) return `${label}最多 ${MAX_SUBJECTS} 门科目`
    for (const x of d[s]) {
      if (!validFull(Number(x.full)) || x.full.trim() === '')
        return `${label}「${x.name}」的${FULL_MSG}`
    }
  }
  return ''
}

const toCatalog = (d: Draft): SubjectCatalog =>
  Object.fromEntries(
    STAGES.map((s) => [s, d[s].map((x): SubjectFull => ({ name: x.name, full: Number(x.full) }))]),
  ) as SubjectCatalog

export default function SubjectCatalogCard() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: QUERY_KEY, queryFn: schoolApi.subjectCatalog })
  const [stage, setStage] = useState<Stage>('primary')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [newName, setNewName] = useState('')
  const [newFull, setNewFull] = useState('100')
  const [addError, setAddError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [busy, setBusy] = useState(false)

  if (q.isPending) return <LoadingState />
  if (q.isError) {
    return (
      <ErrorState
        title={q.error instanceof ApiError ? q.error.message : '加载失败,请重试'}
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    )
  }
  const value = draft ?? toDraft(q.data)
  const list = value[stage]
  const setList = (next: DraftList) => {
    setDraft({ ...value, [stage]: next })
    setSaveError('')
  }

  const move = (i: number, d: -1 | 1) => {
    const next = [...list]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    setList(next)
  }

  const add = () => {
    const name = newName.trim()
    const full = Number(newFull)
    const n = nameLen(name)
    if (n < 1 || n > NAME_MAX) return setAddError(`科目名要在 1–${NAME_MAX} 个字`)
    if (list.some((x) => x.name === name)) return setAddError('这个学段已经有这门科目')
    if (list.length >= MAX_SUBJECTS) return setAddError(`每个学段最多 ${MAX_SUBJECTS} 门科目`)
    if (newFull.trim() === '' || !validFull(full)) return setAddError(FULL_MSG)
    setList([...list, { name, full: String(full) }])
    setNewName('')
    setNewFull('100')
    setAddError('')
  }

  const save = async () => {
    const problem = validate(value)
    if (problem) return setSaveError(problem)
    setBusy(true)
    setSaveError('')
    try {
      const saved = await schoolApi.saveSubjectCatalog(toCatalog(value))
      qc.setQueryData(QUERY_KEY, saved)
      void qc.invalidateQueries({ queryKey: QUERY_KEY })
      setDraft(null)
      toast('已保存')
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : '保存失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card role="group" aria-label="科目目录">
      <CardHeader>
        <CardTitle>科目目录</CardTitle>
        <CardDescription>只影响之后新建的班级和联考可选科目</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <SegmentedTabs
          label="学段"
          value={stage}
          items={STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))}
          onChange={(s) => {
            setStage(s)
            setAddError('')
          }}
        />
        <ul aria-label={`${STAGE_LABEL[stage]}科目`} className="grid gap-1.5">
          {list.map((x, i) => (
            <li
              key={x.name}
              data-subject={x.name}
              className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-2 py-1 text-sm"
            >
              <button
                type="button"
                aria-label={`上移 ${x.name}`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`下移 ${x.name}`}
                disabled={i === list.length - 1}
                onClick={() => move(i, 1)}
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span className="min-w-12 flex-1">{x.name}</span>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                满分
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1000}
                  step={1}
                  aria-label={`${x.name} 满分`}
                  className="h-8 w-20 text-sm text-foreground"
                  value={x.full}
                  onChange={(e) =>
                    setList(list.map((y, j) => (j === i ? { ...y, full: e.target.value } : y)))
                  }
                />
              </label>
              <button
                type="button"
                aria-label={`删除 ${x.name}`}
                onClick={() => setList(list.filter((_, j) => j !== i))}
                className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="新科目名称"
            placeholder="科目名"
            maxLength={NAME_MAX}
            className="h-8 w-32"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value)
              setAddError('')
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return
              e.preventDefault()
              add()
            }}
          />
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            step={1}
            aria-label="新科目满分"
            className="h-8 w-20"
            value={newFull}
            onChange={(e) => {
              setNewFull(e.target.value)
              setAddError('')
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={add}>
            添加科目
          </Button>
          {addError && (
            <p role="alert" className="text-sm text-destructive">
              {addError}
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          三个学段一起保存;顺序就是新建班级时的科目顺序。已有班级的科目不变,老师可在成绩页用"从学校目录补齐"加进来。
        </p>
        {saveError && (
          <p role="alert" className="text-sm text-destructive">
            {saveError}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="button" disabled={draft === null || busy} onClick={() => void save()}>
            保存科目目录
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
