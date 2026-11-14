import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { PagePerm } from './perms'
// 第 2 波各段只在自己的锚点处追加 import,不动别人的行;锚点之间留空行以免 git 合并冲突。

import { LayoutGrid, Sun } from 'lucide-react'
import BoardPage from './Board/BoardPage'
import ClassViewPage from './Board/ClassViewPage'
import TodayPage from './Today/TodayPage'
// ── 段 F(今日 / 看板):import 追加在此行之上 ──

import { Building2 } from 'lucide-react'
import ClassInfoPage from './Org/ClassInfoPage'
import OrgPage from './Org/OrgPage'
import { CalendarClock } from 'lucide-react'
import TimetablePage from './Timetable/TimetablePage'
// ── 段 D(组织架构):import 追加在此行之上 ──

import { Settings, Users } from 'lucide-react'
import AccountsPage from './Accounts/AccountsPage'
import SettingsPage from './Settings/SettingsPage'
// ── 段 E(账号 / 设置):import 追加在此行之上 ──

import { BarChart3, ClipboardList } from 'lucide-react'
import GradeExamsPage from './GradeExams/GradeExamsPage'
import ScoresReportPage from './Reports/ScoresReportPage'
// ── 段 C(联考 / 成绩汇总):import 追加在此行之上 ──

import { CalendarCheck } from 'lucide-react'
import AttendanceReportPage from './Reports/AttendanceReportPage'
// ── 段 D(报表 / 考勤):import 追加在此行之上 ──

import { KeyRound, LogIn, ScrollText, Sparkles } from 'lucide-react'
import AiConfigPage from './Ai/AiConfigPage'
import AiUsagePage from './Ai/AiUsagePage'
import AuditPage from './Audit/AuditPage'
import LoginLogsPage from './LoginLogs/LoginLogsPage'
import { Cctv } from 'lucide-react'
import CamerasPage from './Cameras/CamerasPage'
// ── 段 D(审计 / AI):import 追加在此行之上 ──

import { Megaphone } from 'lucide-react'
import NoticesPage from './Notices/NoticesPage'
// ── 段 E(通知):import 追加在此行之上 ──

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
  perm: PagePerm
  /** 当 /admin 落地页用的权限;没写就用 perm。今日关注对信息中心只开放开学准备卡,不改变他们原来的落地页 */
  landing?: PagePerm
  element: ReactNode
  /** 只注册路由,不进导航 */
  hidden?: boolean
  /** 导航分组:同组的页面在侧栏里放进同一个有标题的组;没标的进最前面的无标题组。组的名字见 Breadcrumb 的 ADMIN_GROUP_LABELS */
  group?: AdminGroup
}

export type AdminGroup = 'manage' | 'reports' | 'system'

// 导航顺序即数组顺序;标了 group 的页面按数组顺序放进同一个侧栏组,按权限过滤后一项都没有的组不出现。
// 每段只在自己的锚点处追加(一个元素一行,末尾带逗号),不动别人的行。
export const ADMIN_PAGES: AdminPage[] = [
  {
    path: 'today',
    label: '今日关注',
    icon: Sun,
    // 业务区块要 school.view;org.manage / settings.manage 也能进,但只看到开学准备卡(见 TodayPage)
    perm: ['school.view', 'org.manage', 'settings.manage'],
    landing: 'school.view',
    element: <TodayPage />,
  },
  // ── today:追加在此行之上 ──

  {
    path: 'board',
    label: '全校看板',
    icon: LayoutGrid,
    perm: 'school.view',
    element: <BoardPage />,
  },
  {
    path: 'classes/:id',
    label: '班级',
    icon: LayoutGrid,
    perm: 'school.view',
    element: <ClassViewPage />,
    hidden: true,
  },
  // ── board:追加在此行之上 ──

  {
    path: 'org',
    label: '组织架构',
    icon: Building2,
    perm: 'org.manage',
    element: <OrgPage />,
    group: 'manage',
  },
  {
    path: 'org/classes/:id',
    label: '班级信息',
    icon: Building2,
    perm: 'org.manage',
    element: <ClassInfoPage />,
    hidden: true,
    group: 'manage',
  },
  {
    path: 'timetable',
    label: '作息与课表',
    icon: CalendarClock,
    perm: 'org.manage',
    element: <TimetablePage />,
    group: 'manage',
  },
  // ── org:追加在此行之上 ──

  {
    path: 'accounts',
    label: '账号',
    icon: Users,
    perm: 'account.manage',
    element: <AccountsPage />,
    group: 'manage',
  },
  // ── accounts:追加在此行之上 ──

  {
    path: 'settings',
    label: '学校设置',
    icon: Settings,
    perm: 'settings.manage',
    element: <SettingsPage />,
    group: 'manage',
  },
  // ── settings:追加在此行之上 ──

  {
    path: 'grade-exams',
    label: '年级联考',
    icon: ClipboardList,
    perm: 'exam.grade_write',
    element: <GradeExamsPage />,
    group: 'reports',
  },
  {
    path: 'reports/scores',
    label: '成绩汇总',
    icon: BarChart3,
    perm: 'school.view',
    element: <ScoresReportPage />,
    group: 'reports',
  },
  // ── 段 C(联考 / 成绩汇总):追加在此行之上 ──

  {
    path: 'reports/attendance',
    label: '考勤报告',
    icon: CalendarCheck,
    perm: 'school.view',
    element: <AttendanceReportPage />,
    group: 'reports',
  },
  // ── reports-attendance:追加在此行之上 ──

  {
    path: 'audit',
    label: '审计日志',
    icon: ScrollText,
    perm: 'audit.read',
    element: <AuditPage />,
    group: 'system',
  },
  {
    path: 'ai/usage',
    label: 'AI 使用',
    icon: Sparkles,
    perm: 'ai.usage',
    element: <AiUsagePage />,
    group: 'system',
  },
  {
    path: 'ai/config',
    label: 'AI 配置',
    icon: KeyRound,
    perm: 'settings.manage',
    element: <AiConfigPage />,
    group: 'system',
  },
  {
    path: 'login-logs',
    label: '登录日志',
    icon: LogIn,
    perm: 'audit.read',
    element: <LoginLogsPage />,
    group: 'system',
  },
  {
    path: 'cameras',
    label: '摄像头',
    icon: Cctv,
    perm: 'camera.manage',
    element: <CamerasPage />,
    group: 'system',
  },
  // ── audit-ai:追加在此行之上 ──

  {
    path: 'notices',
    label: '通知',
    icon: Megaphone,
    perm: 'notice.send',
    element: <NoticesPage />,
  },
  // ── notices:追加在此行之上 ──

  {
    path: 'upgrade',
    label: '学年升级',
    icon: GraduationCap,
    perm: 'year.upgrade',
    element: <UpgradePage />,
    group: 'manage',
  },
  // ── upgrade:追加在此行之上 ──

  {
    path: 'history',
    label: '往年班级',
    icon: History,
    perm: 'school.view',
    element: <HistoryPage />,
    group: 'manage',
  },
  {
    path: 'history/classes/:id',
    label: '往年班级',
    icon: History,
    perm: 'school.view',
    element: <HistoryClassPage />,
    hidden: true,
    group: 'manage',
  },
  // ── history:追加在此行之上 ──
]
