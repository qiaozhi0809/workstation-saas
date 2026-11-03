import { EmptyState } from '@/shared/components/feedback/EmptyState'
import ClassGate from '../ClassGate'

/** AI 助手对话页 /teacher/ai/:chatId(骨架):需要本班 ai.use 权限;内容由后续任务替换。 */
export default function AiThreadPage() {
  return (
    <ClassGate title="AI 助手" need="ai.use">
      {() => <EmptyState title="AI 助手" />}
    </ClassGate>
  )
}
