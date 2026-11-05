import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import type { TodayView } from '@/shared/types/admin'
import TodayPage from './TodayPage'

vi.mock('@/shared/api/admin', () => ({ adminApi: { today: vi.fn() } }))
vi.mock('@/roles/teacher/StudentProfile/StudentProfileDrawer', () => ({
  default: ({ studentId }: { studentId: string }) => (
    <div role="dialog" aria-label="学生档案">
      档案 {studentId}
    </div>
  ),
}))

const view = (over: Partial<TodayView> = {}): TodayView => ({
  date: '2026-10-14',
  scope_label: '全校',
  totals: {
    students: 22,
    present: 20,
    leave: 1,
    absent: 1,
    late: 2,
    classes: 3,
    confirmed_classes: 2,
  },
  absentees: [
    {
      class_id: 'c1',
      class_name: '三年一班',
      student_id: 's1',
      name: '王小一',
      status: 'leave',
      reason: '发烧',
    },
    {
      class_id: 'c2',
      class_name: '三年二班',
      student_id: 's2',
      name: '李小二',
      status: 'absent',
      reason: null,
    },
  ],
  unconfirmed: [{ class_id: 'c3', class_name: '四年一班', homeroom_name: '赵老师' }],
  week_reviews: {
    classes: [
      { class_id: 'c1', class_name: '三年一班', plus: 9, minus: 1, net: 8 },
      { class_id: 'c2', class_name: '三年二班', plus: 2, minus: 4, net: -2 },
    ],
    bottom: [{ class_id: 'c2', class_name: '三年二班', student_id: 's2', name: '李小二', net: -3 }],
    teachers: [{ user_id: 't1', display_name: '赵老师', count: 12 }],
  },
  ...over,
})

function Url() {
  const l = useLocation()
  return <div data-testid="url">{l.pathname + l.search}</div>
}

function setup(data: TodayView) {
  vi.mocked(adminApi.today).mockResolvedValue(data)
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/admin/today']}>
        <TodayPage />
        <Url />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.resetAllMocks())
afterEach(cleanup)

describe('今日关注页', () => {
  it('标题、日期星期与 KPI 计算', async () => {
    setup(view())
    expect(
      await screen.findByRole('heading', { level: 1, name: '今日关注 · 全校' }),
    ).toBeInTheDocument()
    expect(screen.getByText('2026-10-14 星期三')).toBeInTheDocument()
    const kpi = (name: string) =>
      screen
        .getAllByText(name)
        .map((e) => e.closest('[data-kpi]'))
        .find(Boolean) as HTMLElement
    expect(within(kpi('在读')).getByText('22')).toBeInTheDocument()
    expect(within(kpi('出勤率')).getByText('90.9%')).toBeInTheDocument()
    expect(within(kpi('请假')).getByText('1')).toBeInTheDocument()
    expect(within(kpi('缺勤')).getByText('1')).toBeInTheDocument()
    expect(within(kpi('迟到')).getByText('2')).toBeInTheDocument()
    expect(within(kpi('考勤确认')).getByText('2 / 3')).toBeInTheDocument()
  })

  it('缺勤列表按班分组,点学生打开档案抽屉', async () => {
    setup(view())
    const group = (await screen.findByText('三年一班', { selector: 'h3' })).closest(
      'section',
    ) as HTMLElement
    expect(within(group).getByText('请假')).toBeInTheDocument()
    expect(within(group).getByText('发烧')).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('button', { name: '王小一' }))
    await waitFor(() =>
      expect(screen.getByTestId('url')).toHaveTextContent('/admin/today?student=s1'),
    )
    expect(screen.getByRole('dialog', { name: '学生档案' })).toHaveTextContent('s1')
  })

  it('未确认班级与本周点评', async () => {
    setup(view())
    expect(await screen.findByText('四年一班')).toBeInTheDocument()
    expect(screen.getByText('班主任 赵老师')).toBeInTheDocument()
    expect(screen.getByText('+8')).toBeInTheDocument()
    expect(screen.getByText('-2')).toBeInTheDocument()
    expect(screen.getByText('需要关注的同学')).toBeInTheDocument()
    expect(screen.getByText('-3')).toBeInTheDocument()
    expect(screen.getByText('12 次')).toBeInTheDocument()
  })

  it('三个空状态', async () => {
    setup(
      view({
        absentees: [],
        unconfirmed: [],
        // 与后端一致:没有点评时每个班仍在 classes 里,只是 0 分
        week_reviews: {
          classes: [{ class_id: 'c1', class_name: '三年一班', plus: 0, minus: 0, net: 0 }],
          bottom: [],
          teachers: [],
        },
      }),
    )
    expect(await screen.findByText('今天全员到齐')).toBeInTheDocument()
    expect(screen.getByText('各班都已确认')).toBeInTheDocument()
    expect(screen.getByText('本周还没有点评')).toBeInTheDocument()
  })

  it('年级组长标题显示年级', async () => {
    setup(view({ scope_label: '三年级' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: '今日关注 · 三年级' }),
    ).toBeInTheDocument()
  })

  it('加载失败显示错误并可重试', async () => {
    vi.mocked(adminApi.today).mockRejectedValueOnce(new Error('x'))
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <TodayPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    vi.mocked(adminApi.today).mockResolvedValue(view())
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: '今日关注 · 全校' }),
    ).toBeInTheDocument()
  })

  describe('联考与通知两张卡', () => {
    const exam = { id: 'ge1', name: '期中联考', grade_name: '三年级', entered: 1, expected: 4 }
    const notices = [
      {
        id: 'n1',
        title: '期中考试通知',
        created_at: '2026-11-04T01:00:00Z',
        recipients: 8,
        read: 6,
      },
      { id: 'n2', title: '周五放假', created_at: '2026-11-03T01:00:00Z', recipients: 0, read: 0 },
    ]

    it('联考卡:联考名、年级、录分进度与成绩汇总链接', async () => {
      setup(view({ grade_exam: exam }))
      const card = await screen.findByRole('region', { name: '年级联考' })
      expect(within(card).getByText('期中联考')).toBeInTheDocument()
      expect(within(card).getByText('三年级')).toBeInTheDocument()
      expect(within(card).getByText('已录 1 / 4')).toBeInTheDocument()
      const bar = within(card).getByRole('progressbar', { name: '录分进度' })
      expect(bar).toHaveAttribute('aria-valuenow', '25')
      expect(within(card).getByRole('link', { name: '查看成绩汇总' })).toHaveAttribute(
        'href',
        '/admin/reports/scores?exam=ge1',
      )
    })

    it('联考卡:只有一张卡时占满整行(md:only:col-span-2)', async () => {
      setup(view({ grade_exam: exam, my_notices: [] }))
      const card = await screen.findByRole('region', { name: '年级联考' })
      expect(card.className).toContain('md:only:col-span-2')
    })

    it('通知卡:最近几条与已读率,去发通知链接', async () => {
      setup(view({ my_notices: notices }))
      const card = await screen.findByRole('region', { name: '我发出的通知' })
      expect(within(card).getByText('期中考试通知')).toBeInTheDocument()
      expect(within(card).getByText('已读 6 / 8(75%)')).toBeInTheDocument()
      expect(within(card).getByText('周五放假')).toBeInTheDocument()
      expect(within(card).getByText('已读 0 / 0')).toBeInTheDocument()
      expect(within(card).getByRole('link', { name: '去发通知' })).toHaveAttribute(
        'href',
        '/admin/notices',
      )
    })

    it('字段缺失、为 null 或空数组时两张卡都不显示', async () => {
      const first = setup(view())
      await screen.findByRole('heading', { level: 1, name: '今日关注 · 全校' })
      expect(screen.queryByRole('region', { name: '年级联考' })).toBeNull()
      expect(screen.queryByRole('region', { name: '我发出的通知' })).toBeNull()
      first.unmount()
      setup(view({ grade_exam: null, my_notices: [] }))
      await screen.findByRole('heading', { level: 1, name: '今日关注 · 全校' })
      expect(screen.queryByRole('region', { name: '年级联考' })).toBeNull()
      expect(screen.queryByRole('region', { name: '我发出的通知' })).toBeNull()
      expect(screen.queryByRole('link', { name: '去发通知' })).toBeNull()
    })
  })
})
