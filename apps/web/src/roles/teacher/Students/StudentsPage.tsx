import { EmptyState } from '@/shared/components/feedback/EmptyState'
import ClassGate from '../ClassGate'

// 页面骨架:后续任务用真实内容替换整个 children
export default function StudentsPage() {
  return (
    <ClassGate title="学生" need={undefined}>
      {() => <EmptyState title="还没有学生" />}
    </ClassGate>
  )
}
