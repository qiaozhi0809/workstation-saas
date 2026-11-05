import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { classroomApi } from '@/shared/api/classroom'
import { Button } from '@/shared/components/ui/button'
import { aiLink } from '@/shared/lib/aiLink'
import type { StudentProfile } from '@/shared/types/student'

/** 抽屉头部的 AI 快捷入口:跳到 AI 助手并预选模板与该学生 */
export default function ProfileActions({ profile }: { profile: StudentProfile }) {
  const navigate = useNavigate()
  const summary = useQuery({
    queryKey: ['classroom', profile.class_id],
    queryFn: () => classroomApi.summary(profile.class_id),
  })
  const perms = summary.data?.my_perms ?? []
  if (!perms.includes('ai.class')) return null

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {perms.includes('comment.write') && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => navigate(aiLink({ tpl: 'comment1', studentId: profile.id }))}
        >
          AI 写评语
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => navigate(aiLink({ tpl: 'parent', studentId: profile.id }))}
      >
        家长沟通
      </Button>
    </div>
  )
}
