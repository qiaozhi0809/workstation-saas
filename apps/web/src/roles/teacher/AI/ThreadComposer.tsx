import { useState } from 'react'
import { Square } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'

/** 对话底部的追问输入框:Enter 发送 / Shift+Enter 换行 / 输入法组合中不处理;生成中显示"停止"。 */
export default function ThreadComposer({ streaming, onSend, onStop }: {
  streaming: boolean
  onSend(text: string): void
  onStop(): void
}) {
  const [value, setValue] = useState('')
  const trimmed = value.trim()
  const send = () => {
    if (streaming || !trimmed) return
    onSend(trimmed)
    setValue('')
  }
  return (
    <div className="flex items-end gap-2 border-t border-border bg-background p-3">
      <Textarea
        aria-label="继续追问…"
        placeholder="继续追问…"
        rows={2}
        maxLength={4000}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
          e.preventDefault()
          send()
        }}
        className="min-h-0 flex-1 resize-none"
      />
      {streaming ? (
        <Button variant="outline" onClick={onStop}>
          <Square aria-hidden="true" className="fill-current" />
          停止
        </Button>
      ) : (
        <Button onClick={send} disabled={!trimmed}>发送</Button>
      )}
    </div>
  )
}
