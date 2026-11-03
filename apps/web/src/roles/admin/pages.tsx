import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { AdminPerm } from '@/shared/types/admin'

export interface AdminPage {
  path: string
  label: string
  icon: LucideIcon
  perm: AdminPerm
  element: ReactNode
  /** 只注册路由,不进导航 */
  hidden?: boolean
}

// 每段只追加自己的行:一个元素一行,末尾带逗号;导航顺序即数组顺序
export const ADMIN_PAGES: AdminPage[] = [
]
