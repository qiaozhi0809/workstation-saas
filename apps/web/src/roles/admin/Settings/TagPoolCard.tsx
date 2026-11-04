import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Lock, X } from 'lucide-react'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { schoolApi } from '@/shared/api/school'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { PROTECTED_TAGS } from '@/shared/lib/tags'
import { invalidateRosterQueries } from '@/roles/teacher/Students/invalidate'

const MAX_TAGS = 30
const MAX_LEN = 8
const PROTECTED_NOTE = '这个标签有特殊用途'
type Rename = { from: string; to: string }

function validate(name: string, others: string[], count: number): string {
  if (!name) return '请填写标签名'
  if (name.length > MAX_LEN) return `标签最多 ${MAX_LEN} 个字`
  if (others.includes(name)) return '池里已经有这个标签'
  if (count > MAX_TAGS) return `最多 ${MAX_TAGS} 个标签`
  return ''
}

export default function TagPoolCard() {
  const qc = useQueryClient()
  const pool = useQuery({ queryKey: ['tag-pool'], queryFn: schoolApi.tagPool })
  const [draft, setDraft] = useState<string[] | null>(null)
  const [renames, setRenames] = useState<Rename[]>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [alsoStudents, setAlsoStudents] = useState(true)
  const [addDraft, setAddDraft] = useState('')
  const [dialogError, setDialogError] = useState('')
  const [addError, setAddError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [busy, setBusy] = useState(false)

  if (pool.isPending) return <LoadingState />
  if (pool.isError) {
    return <ErrorState title={pool.error instanceof ApiError ? pool.error.message : '加载失败,请重试'}
      onRetry={() => void pool.refetch()} retrying={pool.isFetching} />
  }
  const tags = draft ?? pool.data.tags
  const dirty = draft !== null || renames.length > 0

  const move = (i: number, d: -1 | 1) => {
    const next = [...tags]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    setDraft(next)
  }

  const add = () => {
    const name = addDraft.trim()
    const err = validate(name, tags, tags.length + 1)
    if (err) return setAddError(err)
    setDraft([...tags, name])
    setAddDraft('')
    setAddError('')
  }

  const openRename = (t: string) => { setRenaming(t); setNewName(t); setAlsoStudents(true); setDialogError('') }
  const confirmRename = () => {
    const from = renaming!
    const to = newName.trim()
    if (to === from) return setRenaming(null)
    const others = tags.filter((t) => t !== from)
    // 改成池里已有的名字:勾选"同时修改已有学生"时合并(旧 chip 消失),否则不允许
    const merge = alsoStudents && others.includes(to)
    const err = merge ? validate(to, [], tags.length) : validate(to, others, tags.length)
    if (err) return setDialogError(err)
    setDraft(merge ? others : tags.map((t) => (t === from ? to : t)))
    if (alsoStudents) {
      // 指向 from 的改名(含合并进来的)一并改指 to;from 本身是池里原有的标签时,它的学生也要改成 to
      const next = renames.map((r) => (r.to === from ? { ...r, to } : r))
      if (pool.data.tags.includes(from)) next.push({ from, to })
      setRenames(next.filter((r) => r.from !== r.to))
    }
    setRenaming(null)
  }

  const confirmDelete = () => {
    setDraft(tags.filter((t) => t !== deleting))
    // 不能把学生改成池里已不存在的名字
    setRenames(renames.filter((r) => r.to !== deleting))
    setDeleting(null)
  }

  const save = async () => {
    setBusy(true)
    setSaveError('')
    try {
      const saved = await adminApi.saveTagPool({ tags, renames: renames.filter((r) => r.from !== r.to) })
      qc.setQueryData(['tag-pool'], saved)
      setDraft(null)
      setRenames([])
      void invalidateRosterQueries(qc)
      toast('已保存')
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : '保存失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>学生标签池</CardTitle>
        <CardDescription>老师在学生资料里从这里选标签;顺序就是显示顺序。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul aria-label="标签池" className="flex flex-wrap gap-2">
          {tags.map((t, i) => {
            const locked = PROTECTED_TAGS.includes(t)
            return (
              <li key={t} data-tag={t} className="flex items-center gap-0.5 rounded-full border bg-background py-0.5 pl-1 pr-1.5 text-sm">
                <button type="button" aria-label={`上移 ${t}`} disabled={i === 0} onClick={() => move(i, -1)}
                  className="rounded-full p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button type="button" aria-label={`下移 ${t}`} disabled={i === tags.length - 1} onClick={() => move(i, 1)}
                  className="rounded-full p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                {locked ? (
                  <span title={PROTECTED_NOTE} className="flex items-center gap-1 px-1.5">
                    {t}<Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                    <span className="sr-only">{PROTECTED_NOTE}</span>
                  </span>
                ) : (
                  <>
                    <button type="button" aria-label={`改名 ${t}`} onClick={() => openRename(t)}
                      className="rounded px-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                      {t}
                    </button>
                    <button type="button" aria-label={`删除 ${t}`} onClick={() => setDeleting(t)}
                      className="rounded-full p-0.5 text-muted-foreground hover:text-destructive">
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-muted-foreground">带锁的标签有特殊用途,不能改名或删除。点标签名可以改名。</p>

        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="新标签" placeholder="新标签" maxLength={MAX_LEN} className="w-40" value={addDraft}
            onChange={(e) => { setAddDraft(e.target.value); setAddError('') }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return
              e.preventDefault()
              add()
            }} />
          <Button type="button" variant="outline" onClick={add}>添加</Button>
          {addError && <p role="alert" className="text-sm text-destructive">{addError}</p>}
        </div>

        {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
        <div className="flex justify-end">
          <Button type="button" disabled={!dirty || busy} onClick={() => void save()}>保存标签池</Button>
        </div>
      </CardContent>

      {renaming !== null && (
        <Modal open onClose={() => setRenaming(null)} title={`改名「${renaming}」`} dismissOnOutside={false} className="max-w-sm">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); confirmRename() }}>
            <div className="space-y-1">
              <Label htmlFor="tag-new-name">新名称</Label>
              <Input id="tag-new-name" value={newName} maxLength={MAX_LEN} autoFocus
                onChange={(e) => { setNewName(e.target.value); setDialogError('') }} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={alsoStudents} onChange={(e) => setAlsoStudents(e.target.checked)} />
              同时修改已有学生的这个标签
            </label>
            {dialogError && <p role="alert" className="text-sm text-destructive">{dialogError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>取消</Button>
              <Button type="submit">确定</Button>
            </div>
          </form>
        </Modal>
      )}
      {deleting !== null && (
        <Modal open onClose={() => setDeleting(null)} title="删除标签" className="max-w-sm">
          <p className="text-sm">{`从标签池删除「${deleting}」?已有学生身上的这个标签会保留。`}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>取消</Button>
            <Button type="button" variant="destructive" onClick={confirmDelete}>删除</Button>
          </div>
        </Modal>
      )}
    </Card>
  )
}
