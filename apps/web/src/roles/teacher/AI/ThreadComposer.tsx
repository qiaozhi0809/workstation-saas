import { Square } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'

/** 对话底部的追问输入框:Enter 发送 / Shift+Enter 换行 / 输入法组合中不处理;生成中显示"停止"。 */
export default function ThreadComposer({ value, onChange, streaming, onSend, onStop }: {
  /** 草稿由父组件持有:请求没发出去时可以放回输入框 */
  value: string
  onChange(v: string): void
  streaming: boolean
  /** 返回 false = 请求被拒绝,输入框内容保留;被接受时由父组件清空草稿 */
  onSend(text: string): boolean | void
  onStop(): void
}) {
  const trimmed = value.trim()
  const send = () => {
    if (streaming || !trimmed) return
    onSend(trimmed)
  }
  return (
    <div className="flex items-end gap-2 border-t border-border bg-background p-3">
      <Textarea
        aria-label="继续追问…"
        placeholder="继续追问…"
        rows={2}
        maxLength={4000}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return
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
