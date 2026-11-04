import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { AdminPerm } from '@/shared/types/admin'
// 第 2 波各段只在自己的锚点处追加 import,不动别人的行;锚点之间留空行以免 git 合并冲突。

import { LayoutGrid, Sun } from 'lucide-react'
import BoardPage from './Board/BoardPage'
import ClassViewPage from './Board/ClassViewPage'
import TodayPage from './Today/TodayPage'
// ── 段 F(今日 / 看板):import 追加在此行之上 ──

import { Building2 } from 'lucide-react'
import ClassInfoPage from './Org/ClassInfoPage'
import OrgPage from './Org/OrgPage'
// ── 段 D(组织架构):import 追加在此行之上 ──

import { Settings, Users } from 'lucide-react'
import AccountsPage from './Accounts/AccountsPage'
import SettingsPage from './Settings/SettingsPage'
// ── 段 E(账号 / 设置):import 追加在此行之上 ──

import { GraduationCap } from 'lucide-react'
import UpgradePage from './Upgrade/UpgradePage'
// ── M3b 段 F(学年升级):import 追加在此行之上 ──

import { History } from 'lucide-react'
import HistoryPage from './History/HistoryPage'
import HistoryClassPage from './History/HistoryClassPage'
// ── 段 H(往年班级):import 追加在此行之上 ──

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
  { path: 'today', label: '今日关注', icon: Sun, perm: 'school.view', element: <TodayPage /> },
  // ── today:追加在此行之上 ──

  { path: 'board', label: '全校看板', icon: LayoutGrid, perm: 'school.view', element: <BoardPage /> },
  { path: 'classes/:id', label: '班级', icon: LayoutGrid, perm: 'school.view', element: <ClassViewPage />, hidden: true },
  // ── board:追加在此行之上 ──

  { path: 'org', label: '组织架构', icon: Building2, perm: 'org.manage', element: <OrgPage /> },
  { path: 'org/classes/:id', label: '班级信息', icon: Building2, perm: 'org.manage', element: <ClassInfoPage />, hidden: true },
  // ── org:追加在此行之上 ──

  { path: 'accounts', label: '账号', icon: Users, perm: 'account.manage', element: <AccountsPage /> },
  // ── accounts:追加在此行之上 ──

  { path: 'settings', label: '学校设置', icon: Settings, perm: 'settings.manage', element: <SettingsPage /> },
  // ── settings:追加在此行之上 ──

  { path: 'upgrade', label: '学年升级', icon: GraduationCap, perm: 'year.upgrade', element: <UpgradePage /> },
  // ── upgrade:追加在此行之上 ──

  { path: 'history', label: '往年班级', icon: History, perm: 'school.view', element: <HistoryPage /> },
  { path: 'history/classes/:id', label: '往年班级', icon: History, perm: 'school.view', element: <HistoryClassPage />, hidden: true },
  // ── history:追加在此行之上 ──
]
