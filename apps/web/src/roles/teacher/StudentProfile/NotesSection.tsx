import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { studentsApi } from '@/shared/api/students'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'
import type { TeacherNote } from '@/shared/types/student'

const MAX = 2000
const pad = (n: number) => String(n).padStart(2, '0')

function savedLabel(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function NotesSection({ studentId, note }: { studentId: string; note?: TeacherNote }) {
  const queryClient = useQueryClient()
  const [text, setText] = useState(note?.text ?? '')
  const [savedAt, setSavedAt] = useState(note?.updated_at)
  const save = useMutation({
    mutationFn: () => studentsApi.saveMyNotes(studentId, text),
    onSuccess: (saved) => {
      setSavedAt(saved.updated_at)
      return queryClient.invalidateQueries({ queryKey: ['student', studentId] })
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : '保存失败,请重试'),
  })

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-medium">我的笔记</h3>
        <p className="text-xs text-muted-foreground">只有你自己能看到</p>
      </div>
      <Textarea aria-label="我的笔记" maxLength={MAX} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{text.length}/{MAX}</span>
        <div className="flex items-center gap-3">
          {savedAt && <span>已保存 {savedLabel(savedAt)}</span>}
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>保存</Button>
        </div>
      </div>
    </section>
  )
}
