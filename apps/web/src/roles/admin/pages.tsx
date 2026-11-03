import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { AdminPerm } from '@/shared/types/admin'
// 第 2 波各段只在自己的锚点处追加 import,不动别人的行;锚点之间留空行以免 git 合并冲突。

// ── 段 F(今日 / 看板):import 追加在此行之上 ──

import { Building2 } from 'lucide-react'
import ClassInfoPage from './Org/ClassInfoPage'
import OrgPage from './Org/OrgPage'
// ── 段 D(组织架构):import 追加在此行之上 ──

// ── 段 E(账号 / 设置):import 追加在此行之上 ──

export interface AdminPage {
  path: string
  label: string
  icon: LucideIcon
  perm: AdminPerm
  element: ReactNode
  /** 只注册路由,不进导航 */
  hidden?: boolean
}

// 导航顺序即数组顺序:today、board、org、accounts、settings。
// 每段只在自己的锚点处追加(一个元素一行,末尾带逗号),不动别人的行。
export const ADMIN_PAGES: AdminPage[] = [
  // ── today:追加在此行之上 ──

  // ── board:追加在此行之上 ──

  { path: 'org', label: '组织架构', icon: Building2, perm: 'org.manage', element: <OrgPage /> },
  { path: 'org/classes/:id', label: '班级信息', icon: Building2, perm: 'org.manage', element: <ClassInfoPage />, hidden: true },
  // ── org:追加在此行之上 ──

  // ── accounts:追加在此行之上 ──

  // ── settings:追加在此行之上 ──
]
