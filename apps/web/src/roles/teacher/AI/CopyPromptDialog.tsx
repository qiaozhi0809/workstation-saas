import { toast } from '@/shared/components/Toast'
import Modal from '@/shared/components/overlay/Modal'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'
import type { AiPrompt } from '@/shared/types/ai'

/** 复制提示词对话框:只读提示词 + 复制按钮;隐去姓名时附编号对照表。 */
export default function CopyPromptDialog({
  prompt,
  onClose,
}: {
  prompt: AiPrompt
  onClose(): void
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt.prompt)
      toast('已复制')
    } catch {
      toast('复制失败,请手动选中文字复制')
    }
  }
  return (
    <Modal open onClose={onClose} title="复制提示词" className="max-w-2xl">
      <div className="space-y-3">
        <Textarea readOnly aria-label="提示词内容" value={prompt.prompt} className="h-72" />
        {prompt.mapping.length > 0 && (
          <details className="rounded-md border border-border p-2 text-sm">
            <summary className="cursor-pointer">编号对照表</summary>
            <ul className="mt-2 space-y-1">
              {prompt.mapping.map((m) => (
                <li key={m.code}>{`${m.code} ${m.name}`}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              把 AI 的回答贴回来之前,可以对照这张表把编号换回名字
            </p>
          </details>
        )}
        <div className="flex justify-end">
          <Button onClick={() => void copy()}>复制提示词</Button>
        </div>
      </div>
    </Modal>
  )
}
