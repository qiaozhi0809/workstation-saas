import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { adminApi } from '@/shared/api/admin'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { cn } from '@/shared/lib/utils'
import type { ClassAdmin, ClassInput, GradeAdmin, GradeInput, Stage } from '@/shared/types/admin'
import ConfirmBox from './ConfirmBox'
import { errMsg } from './errMsg'
import Field from './Field'

type Dialog =
  | { kind: 'create' } | { kind: 'edit'; g: GradeAdmin } | { kind: 'delete'; g: GradeAdmin }
  | { kind: 'class' } | { kind: 'delclass'; c: ClassAdmin }

const input = (g: GradeAdmin, display_order = g.display_order): GradeInput =>
  ({ name: g.name, stage: g.stage, display_order })

function GradeForm({ initial, onSubmit, busy, error, onClose, submitLabel }: {
  initial: { name: string; stage: Stage | null }; submitLabel: string; busy: boolean; error: string | null
  onSubmit(v: { name: string; stage: Stage | null }): void; onClose(): void
}) {
  const [name, setName] = useState(initial.name)
  const [stage, setStage] = useState<Stage | ''>(initial.stage ?? '')
  return (
    <div className="grid gap-3">
      <Field label="年级名称"><Input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="学段">
        <NativeSelect value={stage} onChange={(e) => setStage(e.target.value as Stage | '')}>
          <option value="">按年级名称自动判断</option>
          {(['小学', '初中', '高中'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
        </NativeSelect>
      </Field>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>取消</Button>
        <Button disabled={!name.trim() || busy} onClick={() => onSubmit({ name: name.trim(), stage: stage || null })}>{submitLabel}</Button>
      </div>
    </div>
  )
}

function ClassForm({ busy, error, onSubmit, onClose }: {
  busy: boolean; error: string | null; onSubmit(v: { name: string; room: string }): void; onClose(): void
}) {
  const [name, setName] = useState('')
  const [room, setRoom] = useState('')
  return (
    <div className="grid gap-3">
      <Field label="班级名称"><Input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="教室"><Input value={room} maxLength={30} onChange={(e) => setRoom(e.target.value)} /></Field>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>取消</Button>
        <Button disabled={!name.trim() || busy} onClick={() => onSubmit({ name: name.trim(), room: room.trim() })}>创建</Button>
      </div>
    </div>
  )
}

export default function GradesPanel() {
  const qc = useQueryClient()
  const grades = useQuery({ queryKey: ['admin', 'grades'], queryFn: adminApi.grades })
  const [sel, setSel] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [error, setError] = useState<string | null>(null)

  const list = grades.data ?? []
  const gradeId = sel && list.some((g) => g.id === sel) ? sel : (list[0]?.id ?? null)
  const classes = useQuery({
    queryKey: ['admin', 'classes', gradeId], queryFn: () => adminApi.classes(gradeId), enabled: gradeId !== null,
  })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'grades'] })
    void qc.invalidateQueries({ queryKey: ['admin', 'classes'] })
  }
  const close = () => { setDialog(null); setError(null) }
  const ok = (msg: string) => { toast(msg); refresh(); close() }
  const fail = (e: unknown) => setError(errMsg(e))

  const createGrade = useMutation({ mutationFn: (b: GradeInput) => adminApi.createGrade(b), onSuccess: () => ok('年级已创建'), onError: fail })
  const editGrade = useMutation({
    mutationFn: ({ g, v }: { g: GradeAdmin; v: GradeInput }) => adminApi.updateGrade(g.id, v),
    onSuccess: () => ok('年级已保存'), onError: fail,
  })
  const deleteGrade = useMutation({ mutationFn: (id: string) => adminApi.deleteGrade(id), onSuccess: () => ok('年级已删除'), onError: fail })
  const createClass = useMutation({ mutationFn: (b: ClassInput) => adminApi.createClass(b), onSuccess: () => ok('班级已创建'), onError: fail })
  const deleteClass = useMutation({ mutationFn: (id: string) => adminApi.deleteClass(id), onSuccess: () => ok('班级已删除'), onError: fail })
  const move = useMutation({
    mutationFn: async ({ i, j }: { i: number; j: number }) => {
      // 按当前顺序整体重排为 0..n-1,再交换 i、j;只对序号变化的年级发 PUT
      const next = list.map((_, k) => k)
      next[i] = j
      next[j] = i
      for (let k = 0; k < list.length; k++) {
        if (next[k] !== list[k].display_order) await adminApi.updateGrade(list[k].id, input(list[k], next[k]))
      }
    },
    onSettled: refresh,
    onError: (e) => toast(errMsg(e)),
  })

  const nextOrder = Math.min(99, list.reduce((m, g) => Math.max(m, g.display_order), -1) + 1)

  return (
    <Card>
      <CardHeader><CardTitle>年级与班级</CardTitle></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="grid content-start gap-2">
          {grades.isPending && <LoadingState />}
          {grades.isError && <ErrorState title="年级加载失败" description={errMsg(grades.error)} onRetry={() => void grades.refetch()} />}
          <ul className="grid gap-1">
            {list.map((g, i) => (
              <li key={g.id} className={cn('flex items-center gap-1 rounded-md border px-2 py-1', g.id === gradeId && 'border-primary bg-accent')}>
                <button type="button" aria-pressed={g.id === gradeId} className="flex min-w-0 flex-1 flex-col text-left text-sm"
                  onClick={() => setSel(g.id)}>
                  <span className="font-medium">{g.name}</span>
                  <span className="text-xs text-muted-foreground">{`${g.effective_stage} · ${g.class_count} 个班`}</span>
                </button>
                <Button variant="ghost" size="icon" aria-label={`上移 ${g.name}`} disabled={i === 0 || move.isPending}
                  onClick={() => move.mutate({ i, j: i - 1 })}><ArrowUp /></Button>
                <Button variant="ghost" size="icon" aria-label={`下移 ${g.name}`} disabled={i === list.length - 1 || move.isPending}
                  onClick={() => move.mutate({ i, j: i + 1 })}><ArrowDown /></Button>
                <Button variant="ghost" size="sm" aria-label={`编辑年级 ${g.name}`} onClick={() => setDialog({ kind: 'edit', g })}>编辑</Button>
                <Button variant="ghost" size="sm" aria-label={`删除年级 ${g.name}`} onClick={() => setDialog({ kind: 'delete', g })}>删除</Button>
              </li>
            ))}
          </ul>
          <div><Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'create' })}>新建年级</Button></div>
        </div>

        <div className="grid min-w-0 content-start gap-2">
          <div className="flex justify-end">
            <Button size="sm" disabled={gradeId === null} onClick={() => setDialog({ kind: 'class' })}>新建班级</Button>
          </div>
          {classes.isPending && gradeId !== null && <LoadingState />}
          {classes.isError && <ErrorState title="班级加载失败" description={errMsg(classes.error)} onRetry={() => void classes.refetch()} />}
          {classes.data && classes.data.length === 0 && <EmptyState title="这个年级还没有班级" />}
          {classes.data && classes.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">班名</th><th className="py-2 pr-3 font-medium">教室</th>
                    <th className="py-2 pr-3 font-medium">班主任</th><th className="py-2 pr-3 font-medium">学生数</th>
                    <th className="py-2 font-medium"><span className="sr-only">操作</span></th>
                  </tr>
                </thead>
                <tbody>
                  {classes.data.map((c) => (
                    <tr key={c.id} className="border-b">
                      <td className="py-2 pr-3">
                        <Link to={`/admin/org/classes/${c.id}`} className="text-primary underline-offset-4 hover:underline">{c.name}</Link>
                      </td>
                      <td className="py-2 pr-3">{c.room || '—'}</td>
                      <td className="py-2 pr-3">{c.homeroom?.display_name ?? '未任命'}</td>
                      <td className="py-2 pr-3">{c.student_count}</td>
                      <td className="py-2 text-right">
                        <Button variant="ghost" size="sm" aria-label={`删除班级 ${c.name}`} onClick={() => setDialog({ kind: 'delclass', c })}>删除</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>

      <Modal open={dialog?.kind === 'create'} onClose={close} title="新建年级" dismissOnOutside={false} className="max-w-md">
        <GradeForm initial={{ name: '', stage: null }} submitLabel="创建" busy={createGrade.isPending} error={error} onClose={close}
          onSubmit={(v) => createGrade.mutate({ ...v, display_order: nextOrder })} />
      </Modal>
      <Modal open={dialog?.kind === 'edit'} onClose={close} title="编辑年级" dismissOnOutside={false} className="max-w-md">
        {dialog?.kind === 'edit' && (
          <GradeForm key={dialog.g.id} initial={dialog.g} submitLabel="保存" busy={editGrade.isPending} error={error} onClose={close}
            onSubmit={(v) => editGrade.mutate({ g: dialog.g, v: { ...v, display_order: dialog.g.display_order } })} />
        )}
      </Modal>
      <Modal open={dialog?.kind === 'class'} onClose={close} title="新建班级" dismissOnOutside={false} className="max-w-md">
        <ClassForm busy={createClass.isPending} error={error} onClose={close}
          onSubmit={(v) => gradeId && createClass.mutate({ grade_id: gradeId, ...v })} />
      </Modal>
      <ConfirmBox open={dialog?.kind === 'delete'} title="删除年级" confirmLabel="确认删除" error={error}
        busy={deleteGrade.isPending} onClose={close}
        onConfirm={() => dialog?.kind === 'delete' && deleteGrade.mutate(dialog.g.id)}>
        <p>{dialog?.kind === 'delete' ? `确定删除 ${dialog.g.name} 吗?` : ''}</p>
      </ConfirmBox>
      <ConfirmBox open={dialog?.kind === 'delclass'} title="删除班级" confirmLabel="确认删除" error={error}
        busy={deleteClass.isPending} onClose={close}
        onConfirm={() => dialog?.kind === 'delclass' && deleteClass.mutate(dialog.c.id)}>
        <p>{dialog?.kind === 'delclass' ? `确定删除 ${dialog.c.name} 吗?该班全部任职会同时结束。` : ''}</p>
      </ConfirmBox>
    </Card>
  )
}
