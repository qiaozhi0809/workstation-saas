import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import type { YearAdmin } from '@/shared/types/admin'
import { errMsg } from './errMsg'
import Field from './Field'

function YearForm({ year }: { year: YearAdmin }) {
  const qc = useQueryClient()
  const [name, setName] = useState(year.name)
  const [start, setStart] = useState(year.start_date)
  const [term2, setTerm2] = useState(year.term2_start ?? '')
  const [end, setEnd] = useState(year.end_date)
  const [problem, setProblem] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => adminApi.saveYear(year.id, { name: name.trim(), start_date: start, end_date: end, term2_start: term2 || null }),
    onSuccess: () => { toast('学年已保存'); void qc.invalidateQueries({ queryKey: ['admin', 'years'] }) },
  })
  const submit = () => {
    if (!start || !end || start >= end) return setProblem('结束日期须晚于开学日期')
    if (term2 && !(start < term2 && term2 < end))
      return setProblem('第二学期开学日期须晚于开学日期、早于结束日期')
    setProblem(null)
    save.mutate()
  }
  const shown = problem ?? (save.isError ? errMsg(save.error) : null)
  return (
    <CardContent className="grid gap-3">
      <Field label="学年名称"><Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="开学日期"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="第二学期开学日期"><Input type="date" value={term2} onChange={(e) => setTerm2(e.target.value)} /></Field>
        <Field label="结束日期"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      {shown && <p role="alert" className="text-sm text-destructive">{shown}</p>}
      <div><Button disabled={!name.trim() || save.isPending} onClick={submit}>保存学年</Button></div>
    </CardContent>
  )
}

export default function YearCard() {
  const q = useQuery({ queryKey: ['admin', 'years'], queryFn: adminApi.years })
  const year = q.data?.find((y) => y.is_active) ?? q.data?.[0]
  return (
    <Card>
      <CardHeader>
        <CardTitle>学年</CardTitle>
        <CardDescription>开学日期决定教室顶栏的第几周</CardDescription>
      </CardHeader>
      {year ? <YearForm key={year.id} year={year} /> : <LoadingState />}
    </Card>
  )
}
