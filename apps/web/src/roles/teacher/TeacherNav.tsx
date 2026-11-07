import {
  ChartColumn,
  ClipboardList,
  Megaphone,
  School,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'

const LINKS: readonly { to: string; label: string; icon: LucideIcon; perm?: string }[] = [
  { to: '/teacher/classroom', label: '教室', icon: School },
  { to: '/teacher/scores', label: '成绩', icon: ClipboardList },
  { to: '/teacher/analysis', label: '分析', icon: ChartColumn },
  { to: '/teacher/students', label: '学生', icon: Users },
  { to: '/teacher/ai', label: 'AI 助手', icon: Sparkles },
  { to: '/teacher/notices', label: '班级公告', icon: Megaphone, perm: 'class.notice' },
]

/** 顶栏主导航。< 768px 只显示图标,文字留给读屏(可访问名称不变),鼠标悬停靠 title 看名称(L260);当前页由 NavLink 标 aria-current="page"。带 perm 的入口只在当前班 my_perms 含该权限时出现。触屏下由 theme/index.css 的 .touch-target 放大点击区(L82)。 */
export default function TeacherNav({ perms }: { perms?: readonly string[] }) {
  return (
    <nav aria-label="主导航" className="flex shrink-0 items-center gap-0.5">
      {LINKS.filter((l) => !l.perm || perms?.includes(l.perm)).map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          title={label}
          className={({ isActive }) =>
            cn(
              'touch-target flex h-9 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:px-3',
              isActive
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="sr-only md:not-sr-only">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
