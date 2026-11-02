import { Trash2 } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { todosApi } from '@/shared/api/todos'
import { Button } from '@/shared/components/ui/button'
import { Card } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { toast } from '@/shared/components/Toast'

export default function TodoSection() {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const todos = useQuery({ queryKey: ['todos'], queryFn: todosApi.list })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['todos'] })
  const onError = (err: Error) => toast(err.message)
  const create = useMutation({
    mutationFn: (content: string) => todosApi.create(content),
    onSuccess: () => { setText(''); refresh() },
    onError,
  })
  const update = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => todosApi.update(v.id, { done: v.done }),
    onSuccess: refresh,
    onError,
  })
  const remove = useMutation({ mutationFn: (id: string) => todosApi.remove(id), onSuccess: refresh, onError })

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    // 输入法选词时的回车不算提交
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
    const content = text.trim()
    if (!content || create.isPending) return
    create.mutate(content)
  }

  return (
    <Card className="p-3">
      <h3 className="text-sm font-semibold">待办</h3>
      <ul className="mt-1 flex flex-col gap-1 text-sm">
        {(todos.data?.items ?? []).map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <input type="checkbox" aria-label={t.content} checked={t.done}
              onChange={() => update.mutate({ id: t.id, done: !t.done })} />
            <span className={`flex-1 ${t.done ? 'text-muted-foreground line-through' : ''}`}>{t.content}</span>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`删除 ${t.content}`}
              onClick={() => remove.mutate(t.id)}>
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown}
        placeholder="添加一件要做的事" className="mt-2 h-8" />
    </Card>
  )
}
