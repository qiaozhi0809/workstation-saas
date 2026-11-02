import { EmptyState } from '@/shared/components/feedback/EmptyState'
import ClassGate from '../ClassGate'

// 页面骨架:后续任务用真实内容替换整个 children
export default function ScoresPage() {
  return (
    <ClassGate title="成绩录入" need="exam.read">
      {() => <EmptyState title="还没有考试" />}
    </ClassGate>
  )
}
