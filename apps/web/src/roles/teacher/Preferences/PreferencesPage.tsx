import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { preferencesApi } from '@/shared/api/preferences'
import { toast } from '@/shared/components/Toast'
import type { Preferences } from '@/shared/types/preferences'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'

const MAX_REASONS = 20

// 分值输入框的文本(空串表示还没填),保存时才按契约解析
interface Row { key: number; text: string; delta: string }
interface Form { figure: Preferences['teacher_figure']; idle: boolean; rows: Row[] }

let rowKey = 0
const toForm = (p: Preferences): Form => ({
  figure: p.teacher_figure,
  idle: p.idle_animation,
  rows: p.review_reasons.map((r) => ({ key: ++rowKey, text: r.text, delta: String(r.delta) })),
})

function build(form: Form): { error: string } | { value: Preferences } {
  const reasons = []
  for (const r of form.rows) {
    const n = Array.from(r.text.trim()).length
    if (n < 1 || n > 20) return { error: '理由要填 1–20 个字' }
    const delta = r.delta.trim() === '' ? NaN : Number(r.delta)
    if (delta === 0) return { error: '分值不能为 0' }
    if (!Number.isInteger(delta) || delta < -10 || delta > 10) return { error: '分值要在 -10 到 10 之间' }
    reasons.push({ text: r.text.trim(), delta })
  }
  return { value: { teacher_figure: form.figure, idle_animation: form.idle, review_reasons: reasons } }
}

export default function PreferencesPage() {
  const query = useQuery({ queryKey: ['preferences'], queryFn: preferencesApi.get })
  // 后台刷新失败时保留正在编辑的表单,只有从没加载成功过才显示错误
  if (query.isError && !query.data) {
    return <ErrorState title="偏好加载失败" onRetry={() => void query.refetch()} retrying={query.isFetching} />
  }
  if (!query.data) return <LoadingState />
  // 表单只用首次加载的数据初始化,之后的重新拉取不覆盖正在编辑的内容
  return <PreferencesForm initial={query.data} />
}

function PreferencesForm({ initial }: { initial: Preferences }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Form>(() => toForm(initial))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)

  const setRow = (key: number, patch: Partial<Row>) =>
    setForm((f) => ({ ...f, rows: f.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }))

  const save = async () => {
    if (inFlight.current) return
    const built = build(form)
    setError('error' in built ? built.error : null)
    if ('error' in built) return
    inFlight.current = true
    setSaving(true)
    try {
      await preferencesApi.save(built.value)
      await queryClient.invalidateQueries({ queryKey: ['preferences'] })
      toast('已保存')
    } catch (err) {
      toast(err instanceof ApiError ? err.message : '保存失败,请重试')
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const legend = 'mb-3 text-sm font-medium text-muted-foreground'
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 md:p-6">
      <h2 className="text-xl font-semibold tracking-tight">我的偏好</h2>
      <Card>
        <CardContent className="pt-6">
          <fieldset className="flex flex-wrap items-center gap-4">
            <legend className={legend}>老师形象</legend>
            {([['female', '女老师'], ['male', '男老师']] as const).map(([value, name]) => (
              <Label key={value} className="flex items-center gap-2 font-normal">
                <input type="radio" name="teacher_figure" checked={form.figure === value}
                  onChange={() => setForm((f) => ({ ...f, figure: value }))} />
                {name}
              </Label>
            ))}
          </fieldset>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <fieldset>
            <legend className={legend}>教室</legend>
            <Label className="flex items-center gap-2 font-normal">
              <input type="checkbox" checked={form.idle} onChange={(e) => setForm((f) => ({ ...f, idle: e.target.checked }))} />
              空闲小动画
            </Label>
          </fieldset>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <fieldset className="flex flex-col gap-2">
            <legend className={legend}>点评理由</legend>
            {form.rows.map((r) => (
              <div key={r.key} className="flex items-center gap-2">
                <Input aria-label="理由" className="min-w-0 flex-1" value={r.text}
                  onChange={(e) => setRow(r.key, { text: e.target.value })} />
                <Input aria-label="分值" type="number" className="w-20" value={r.delta}
                  onChange={(e) => setRow(r.key, { delta: e.target.value })} />
                <Button type="button" variant="outline" size="sm" disabled={form.rows.length <= 1}
                  onClick={() => setForm((f) => ({ ...f, rows: f.rows.filter((x) => x.key !== r.key) }))}>删除</Button>
              </div>
            ))}
            <div>
              <Button type="button" variant="outline" size="sm" disabled={form.rows.length >= MAX_REASONS}
                onClick={() => setForm((f) => ({ ...f, rows: [...f.rows, { key: ++rowKey, text: '', delta: '1' }] }))}>
                添加理由
              </Button>
            </div>
          </fieldset>
        </CardContent>
      </Card>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div>
        <Button type="button" disabled={saving} onClick={() => void save()}>保存</Button>
      </div>
    </div>
  )
}
