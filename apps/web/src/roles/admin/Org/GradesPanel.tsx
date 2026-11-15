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
import { Field, useFormErrors } from '@/shared/components/ui/field'
import { IconButton } from '@/shared/components/ui/icon-button'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { Table, TableBody, TableHead, TableRow, Td, Th } from '@/shared/components/ui/table'
import { cn } from '@/shared/lib/utils'
import type { ClassAdmin, ClassInput, GradeAdmin, GradeInput, Stage } from '@/shared/types/admin'
import ConfirmBox from './ConfirmBox'
import { errMsg } from './errMsg'

const NAME_ORDER = ['name'] as const

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; g: GradeAdmin }
  | { kind: 'delete'; g: GradeAdmin }
  | { kind: 'class' }
  | { kind: 'delclass'; c: ClassAdmin }

const input = (g: GradeAdmin, display_order = g.display_order): GradeInput => ({
  name: g.name,
  stage: g.stage,
  display_order,
})

function GradeForm({
  initial,
  onSubmit,
  busy,
  error,
  onClose,
  submitLabel,
}: {
  initial: { name: string; stage: Stage | null }
  submitLabel: string
  busy: boolean
  error: string | null
  onSubmit(v: { name: string; stage: Stage | null }): void
  onClose(): void
}) {
  const [name, setName] = useState(initial.name)
  const [stage, setStage] = useState<Stage | ''>(initial.stage ?? '')
  const { errors, report, clear, fieldRef } = useFormErrors(NAME_ORDER)
  const submit = () => {
    if (!report(name.trim() ? {} : { name: '请填写年级名' })) return
    onSubmit({ name: name.trim(), stage: stage || null })
  }
  return (
    <div className="grid gap-3">
      <Field label="年级名称" error={errors.name}>
        <Input
          ref={fieldRef('name')}
          value={name}
          maxLength={20}
          onChange={(e) => {
            setName(e.target.value)
            clear('name')
          }}
        />
      </Field>
      <Field label="学段">
        <NativeSelect value={stage} onChange={(e) => setStage(e.target.value as Stage | '')}>
          <option value="">按年级名称自动判断</option>
          {(['小学', '初中', '高中'] as const).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button disabled={busy} onClick={submit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

function ClassForm({
  busy,
  error,
  onSubmit,
  onClose,
}: {
  busy: boolean
  error: string | null
  onSubmit(v: { name: string; room: string }): void
  onClose(): void
}) {
  const [name, setName] = useState('')
  const [room, setRoom] = useState('')
  const { errors, report, clear, fieldRef } = useFormErrors(NAME_ORDER)
  const submit = () => {
    if (!report(name.trim() ? {} : { name: '请填写班级名称' })) return
    onSubmit({ name: name.trim(), room: room.trim() })
  }
  return (
    <div className="grid gap-3">
      <Field label="班级名称" error={errors.name}>
        <Input
          ref={fieldRef('name')}
          value={name}
          maxLength={20}
          onChange={(e) => {
            setName(e.target.value)
            clear('name')
          }}
        />
      </Field>
      <Field label="教室">
        <Input value={room} maxLength={30} onChange={(e) => setRoom(e.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button disabled={busy} onClick={submit}>
          创建
        </Button>
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
    queryKey: ['admin', 'classes', gradeId],
    queryFn: () => adminApi.classes(gradeId),
    enabled: gradeId !== null,
  })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'grades'] })
    void qc.invalidateQueries({ queryKey: ['admin', 'classes'] })
  }
  const close = () => {
    setDialog(null)
    setError(null)
  }
  const ok = (msg: string) => {
    toast(msg)
    refresh()
    close()
  }
  const fail = (e: unknown) => setError(errMsg(e))

  const createGrade = useMutation({
    mutationFn: (b: GradeInput) => adminApi.createGrade(b),
    onSuccess: () => ok('年级已创建'),
    onError: fail,
  })
  const editGrade = useMutation({
    mutationFn: ({ g, v }: { g: GradeAdmin; v: GradeInput }) => adminApi.updateGrade(g.id, v),
    onSuccess: () => ok('年级已保存'),
    onError: fail,
  })
  const deleteGrade = useMutation({
    mutationFn: (id: string) => adminApi.deleteGrade(id),
    onSuccess: () => ok('年级已删除'),
    onError: fail,
  })
  const createClass = useMutation({
    mutationFn: (b: ClassInput) => adminApi.createClass(b),
    onSuccess: () => ok('班级已创建'),
    onError: fail,
  })
  const deleteClass = useMutation({
    mutationFn: (id: string) => adminApi.deleteClass(id),
    onSuccess: () => ok('班级已删除'),
    onError: fail,
  })
  const move = useMutation({
    mutationFn: async ({ i, j }: { i: number; j: number }) => {
      // 按当前顺序整体重排为 0..n-1,再交换 i、j;只对序号变化的年级发 PUT
      const next = list.map((_, k) => k)
      next[i] = j
      next[j] = i
      for (let k = 0; k < list.length; k++) {
        if (next[k] !== list[k].display_order)
          await adminApi.updateGrade(list[k].id, input(list[k], next[k]))
      }
    },
    onSettled: refresh,
    onError: (e) => toast(errMsg(e)),
  })

  const nextOrder = Math.min(99, list.reduce((m, g) => Math.max(m, g.display_order), -1) + 1)

  return (
    <Card>
      <CardHeader>
        <CardTitle>年级与班级</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
        {/* 两列都从同一套行高开始:工具条 h-8 → 表头行 h-10 → 数据行 3.25rem + 左列行距 gap-1(0.25rem),右表行高同步加上(L399) */}
        <div className="grid content-start gap-2">
          <div className="flex h-8 items-center justify-between gap-2">
            <h3 className="text-sm font-medium">年级</h3>
            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'create' })}>
              新建年级
            </Button>
          </div>
          <div
            aria-hidden="true"
            className="flex h-10 items-center border-b px-2 text-sm font-medium text-muted-foreground"
          >
            名称 · 学段 · 班数
          </div>
          {grades.isPending && <LoadingState />}
          {grades.isError && (
            <ErrorState
              title="年级加载失败"
              description={errMsg(grades.error)}
              onRetry={() => void grades.refetch()}
            />
          )}
          <ul className="grid gap-1">
            {list.map((g, i) => (
              <li
                key={g.id}
                className={cn(
                  'flex h-[3.25rem] items-center gap-1 rounded-md px-2',
                  g.id === gradeId && 'bg-accent',
                )}
              >
                <button
                  type="button"
                  aria-pressed={g.id === gradeId}
                  className="flex h-11 min-w-0 flex-1 flex-col justify-center text-left text-sm"
                  onClick={() => setSel(g.id)}
                >
                  <span className="truncate font-medium">{g.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{`${g.effective_stage} · ${g.class_count} 个班`}</span>
                </button>
                <IconButton
                  size="sm"
                  icon={ArrowUp}
                  aria-label={`上移 ${g.name}`}
                  disabled={i === 0 || move.isPending}
                  onClick={() => move.mutate({ i, j: i - 1 })}
                />
                <IconButton
                  size="sm"
                  icon={ArrowDown}
                  aria-label={`下移 ${g.name}`}
                  disabled={i === list.length - 1 || move.isPending}
                  onClick={() => move.mutate({ i, j: i + 1 })}
                />
                <Button
                  variant="link"
                  size="sm"
                  className="px-1"
                  aria-label={`编辑年级 ${g.name}`}
                  onClick={() => setDialog({ kind: 'edit', g })}
                >
                  编辑
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  className="px-1"
                  aria-label={`删除年级 ${g.name}`}
                  onClick={() => setDialog({ kind: 'delete', g })}
                >
                  删除
                </Button>
              </li>
            ))}
          </ul>
        </div>

        <div className="grid min-w-0 content-start gap-2">
          <div className="flex h-8 items-center justify-between gap-2">
            <h3 className="text-sm font-medium">班级</h3>
            <Button
              size="sm"
              disabled={gradeId === null}
              onClick={() => setDialog({ kind: 'class' })}
            >
              新建班级
            </Button>
          </div>
          {classes.isPending && gradeId !== null && <LoadingState />}
          {classes.isError && (
            <ErrorState
              title="班级加载失败"
              description={errMsg(classes.error)}
              onRetry={() => void classes.refetch()}
            />
          )}
          {classes.data && classes.data.length === 0 && <EmptyState title="这个年级还没有班级" />}
          {classes.data && classes.data.length > 0 && (
            <Table
              minWidth={512}
              containerClassName="relative rounded-none bg-transparent shadow-none"
              className="w-full"
            >
              <TableHead>
                <TableRow>
                  <Th>班名</Th>
                  <Th>教室</Th>
                  <Th>班主任</Th>
                  <Th numeric>学生数</Th>
                  <Th align="end">
                    {/* sr-only 是绝对定位:外层容器 relative,才会被它的横向滚动裁住,不撑宽整页 */}
                    <span className="sr-only">操作</span>
                  </Th>
                </TableRow>
              </TableHead>
              <TableBody>
                {classes.data.map((c) => (
                  <TableRow key={c.id} className="h-[calc(3.25rem+0.25rem)]">
                    <Td>
                      <Link
                        to={`/admin/org/classes/${c.id}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {c.name}
                      </Link>
                    </Td>
                    <Td>{c.room || '—'}</Td>
                    <Td>{c.homeroom?.display_name ?? '未任命'}</Td>
                    <Td numeric>{c.student_count}</Td>
                    <Td align="end">
                      <Button
                        variant="link"
                        size="sm"
                        aria-label={`删除班级 ${c.name}`}
                        onClick={() => setDialog({ kind: 'delclass', c })}
                      >
                        删除
                      </Button>
                    </Td>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>

      <Modal
        open={dialog?.kind === 'create'}
        onClose={close}
        title="新建年级"
        dismissOnOutside={false}
        className="max-w-md"
      >
        <GradeForm
          initial={{ name: '', stage: null }}
          submitLabel="创建"
          busy={createGrade.isPending}
          error={error}
          onClose={close}
          onSubmit={(v) => createGrade.mutate({ ...v, display_order: nextOrder })}
        />
      </Modal>
      <Modal
        open={dialog?.kind === 'edit'}
        onClose={close}
        title="编辑年级"
        dismissOnOutside={false}
        className="max-w-md"
      >
        {dialog?.kind === 'edit' && (
          <GradeForm
            key={dialog.g.id}
            initial={dialog.g}
            submitLabel="保存"
            busy={editGrade.isPending}
            error={error}
            onClose={close}
            onSubmit={(v) =>
              editGrade.mutate({ g: dialog.g, v: { ...v, display_order: dialog.g.display_order } })
            }
          />
        )}
      </Modal>
      <Modal
        open={dialog?.kind === 'class'}
        onClose={close}
        title="新建班级"
        dismissOnOutside={false}
        className="max-w-md"
      >
        <ClassForm
          busy={createClass.isPending}
          error={error}
          onClose={close}
          onSubmit={(v) => gradeId && createClass.mutate({ grade_id: gradeId, ...v })}
        />
      </Modal>
      <ConfirmBox
        open={dialog?.kind === 'delete'}
        title="删除年级"
        confirmLabel="确认删除"
        error={error}
        busy={deleteGrade.isPending}
        onClose={close}
        onConfirm={() => dialog?.kind === 'delete' && deleteGrade.mutate(dialog.g.id)}
      >
        <p>{dialog?.kind === 'delete' ? `确定删除 ${dialog.g.name} 吗?` : ''}</p>
      </ConfirmBox>
      <ConfirmBox
        open={dialog?.kind === 'delclass'}
        title="删除班级"
        confirmLabel="确认删除"
        error={error}
        busy={deleteClass.isPending}
        onClose={close}
        onConfirm={() => dialog?.kind === 'delclass' && deleteClass.mutate(dialog.c.id)}
      >
        <p>
          {dialog?.kind === 'delclass'
            ? `确定删除 ${dialog.c.name} 吗?该班全部任职会同时结束。`
            : ''}
        </p>
      </ConfirmBox>
    </Card>
  )
}
