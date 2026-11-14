import {
  ChartColumn,
  ClipboardList,
  Megaphone,
  School,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { SidebarGroup } from '@/shared/components/layout/Sidebar'

const LINKS: readonly { to: string; label: string; icon: LucideIcon; perm?: string }[] = [
  { to: '/teacher/classroom', label: '教室', icon: School },
  { to: '/teacher/scores', label: '成绩', icon: ClipboardList },
  { to: '/teacher/analysis', label: '分析', icon: ChartColumn },
  { to: '/teacher/students', label: '学生', icon: Users },
  { to: '/teacher/ai', label: 'AI 助手', icon: Sparkles },
  { to: '/teacher/notices', label: '班级公告', icon: Megaphone, perm: 'class.notice' },
]

/** 教师端侧栏的导航:一个没有标题的组。带 perm 的入口只在当前班 my_perms 含该权限时出现 */
export function teacherGroups(perms: readonly string[] | undefined): SidebarGroup[] {
  return [
    {
      key: 'main',
      items: LINKS.filter((l) => !l.perm || perms?.includes(l.perm)).map(({ to, label, icon }) => ({
        to,
        label,
        icon,
      })),
    },
  ]
}
