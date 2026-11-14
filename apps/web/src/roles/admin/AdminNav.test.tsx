import { cleanup } from '@testing-library/react'
import { Building2, Sun, Users } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import type { AdminPerm } from '@/shared/types/admin'
import { adminGroups } from './AdminNav'
import { hasPagePerm } from './perms'
import { ADMIN_PAGES, type AdminPage } from './pages'

const PERMS: Record<string, AdminPerm[]> = {
  principal: [
    'school.view',
    'org.manage',
    'account.manage',
    'settings.manage',
    'audit.read',
    'ai.usage',
    'notice.send',
    'exam.grade_write',
    'year.upgrade',
  ],
  dean: [
    'school.view',
    'org.manage',
    'ai.usage',
    'notice.send',
    'exam.grade_write',
    'year.upgrade',
  ],
  gradeHead: ['school.view', 'notice.send', 'exam.grade_write'],
  itAdmin: ['org.manage', 'account.manage', 'settings.manage', 'audit.read'],
}

const setPerms = (admin_perms: AdminPerm[]) =>
  useAuthStore.setState({
    accessToken: 'a',
    refreshToken: 'r',
    lastContext: null,
    user: {
      id: 'u',
      display_name: '张主任',
      contexts: ['admin'],
      admin_perms,
      must_change_password: false,
      password_change_reason: null,
    },
  })

const GROUP_LABEL = { manage: '学校管理', reports: '联考与报表', system: '系统' } as const

/** 该权限集能看到的页面(不含 hidden),保持数组顺序 */
const visible = (perms: AdminPerm[], pages = ADMIN_PAGES) =>
  pages.filter((p) => !p.hidden && hasPagePerm(perms, p.perm))
const labels = (g: { items: { label: string }[] }) => g.items.map((i) => i.label)

beforeEach(() => setPerms(PERMS.principal))
afterEach(() => {
  cleanup()
  useAuthStore.getState().logout()
})

describe('adminGroups', () => {
  it('groups follow pages.tsx', () => {
    const groups = adminGroups(ADMIN_PAGES, PERMS.principal)
    expect(groups.map((g) => g.label)).toEqual([
      undefined,
      GROUP_LABEL.manage,
      GROUP_LABEL.reports,
      GROUP_LABEL.system,
    ])
    // 无标题组:没标 group 的页面,按数组顺序
    expect(labels(groups[0])).toEqual(['今日关注', '全校看板', '通知'])
    // 其余各组的 items 顺序同 ADMIN_PAGES
    for (const [i, key] of (['manage', 'reports', 'system'] as const).entries()) {
      const expected = visible(PERMS.principal).filter((p) => p.group === key)
      expect(expected.length).toBeGreaterThan(1)
      expect(labels(groups[i + 1])).toEqual(expected.map((p) => p.label))
      expect(groups[i + 1].items.map((it) => it.to)).toEqual(
        expected.map((p) => `/admin/${p.path}`),
      )
    }
  })

  it('hidden and unauthorized pages are excluded', () => {
    const all = adminGroups(ADMIN_PAGES, PERMS.principal).flatMap((g) => g.items.map((i) => i.to))
    // hidden 的子页不进导航
    expect(all).not.toContain('/admin/org/classes/:id')
    expect(all).not.toContain('/admin/history/classes/:id')
    expect(all).not.toContain('/admin/classes/:id')
    // 校长没有 camera.manage
    expect(all).not.toContain('/admin/cameras')
    expect([...all].sort()).toEqual(
      visible(PERMS.principal)
        .map((p) => `/admin/${p.path}`)
        .sort(),
    )
  })

  // 写死的期望:不在测试里重算权限,pages.tsx 的顺序或权限变了这里要跟着改
  const EXPECTED: Record<string, [string, string[]][]> = {
    dean: [
      ['', ['今日关注', '全校看板', '通知']],
      ['学校管理', ['组织架构', '作息与课表', '学年升级', '往年班级']],
      ['联考与报表', ['年级联考', '成绩汇总', '考勤报告']],
      ['系统', ['AI 使用']],
    ],
    gradeHead: [
      ['', ['今日关注', '全校看板', '通知']],
      ['学校管理', ['往年班级']],
      ['联考与报表', ['年级联考', '成绩汇总', '考勤报告']],
    ],
    itAdmin: [
      ['', ['今日关注']],
      ['学校管理', ['组织架构', '作息与课表', '账号', '学校设置']],
      ['系统', ['审计日志', 'AI 配置', '登录日志']],
    ],
  }
  it.each(Object.keys(EXPECTED))('lists exactly these pages for %s', (role) => {
    const groups = adminGroups(ADMIN_PAGES, PERMS[role])
    expect(groups.map((g) => [g.label ?? '', labels(g)])).toEqual(EXPECTED[role])
  })

  it('info-center sees today without school.view', () => {
    for (const perms of [['org.manage'], ['settings.manage']] as AdminPerm[][]) {
      const top = adminGroups(ADMIN_PAGES, perms)[0]
      expect(labels(top)).toContain('今日关注')
      expect(top.items.find((i) => i.label === '今日关注')?.to).toBe('/admin/today')
      // 其余 school.view 页面(看板)仍不给
      expect(labels(top)).not.toContain('全校看板')
    }
  })

  it('a group left with one page still shows its heading', () => {
    const groups = adminGroups(ADMIN_PAGES, PERMS.dean)
    const system = groups.find((g) => g.key === 'system')
    expect(system?.label).toBe('系统')
    expect(labels(system!)).toEqual(['AI 使用'])
  })

  it('uses hasPagePerm for array perms', () => {
    const pages: AdminPage[] = [
      {
        path: 'x',
        label: '甲页',
        icon: Sun,
        perm: ['school.view', 'org.manage'],
        element: null,
      },
    ]
    expect(labels(adminGroups(pages, ['org.manage'])[0])).toEqual(['甲页'])
    expect(adminGroups(pages, ['account.manage'])).toEqual([])
    expect(adminGroups(pages, undefined)).toEqual([])
  })

  it('is data-driven: any page with a group lands in that group', () => {
    const pages: AdminPage[] = [
      { path: 'today', label: '今日关注', icon: Sun, perm: 'school.view', element: null },
      {
        path: 'x-one',
        label: '甲页',
        icon: Building2,
        perm: 'org.manage',
        element: null,
        group: 'system',
      },
      {
        path: 'x-two',
        label: '乙页',
        icon: Users,
        perm: 'account.manage',
        element: null,
        group: 'system',
      },
    ]
    const groups = adminGroups(pages, ['school.view', 'org.manage', 'account.manage'])
    expect(groups.map((g) => [g.label, labels(g)])).toEqual([
      [undefined, ['今日关注']],
      ['系统', ['甲页', '乙页']],
    ])
  })

  it('shows pages without a group in the untitled group', () => {
    const pages: AdminPage[] = [
      { path: 'org', label: '组织架构', icon: Building2, perm: 'org.manage', element: null },
    ]
    const groups = adminGroups(pages, ['org.manage'])
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBeUndefined()
    expect(labels(groups[0])).toEqual(['组织架构'])
  })
})
