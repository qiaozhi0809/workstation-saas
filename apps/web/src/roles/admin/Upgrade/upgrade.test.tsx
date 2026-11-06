import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { studentsApi } from '@/shared/api/students'
import { useAuthStore } from '@/shared/stores/auth'
import type {
  AdminRole,
  ClassAdmin,
  ClassPreview,
  UpgradeLatest,
  UpgradePlan,
  UpgradePreview,
  YearAdmin,
} from '@/shared/types/admin'
import type { User } from '@/shared/types/user'
import type { StudentSeat } from '@/shared/types/student'
import { orgApi } from '../Org/orgApi'
import { removeNewClass } from './planOps'
import UpgradePage from './UpgradePage'

vi.mock('@/shared/api/admin', () => ({
  adminApi: {
    upgradeSuggest: vi.fn(),
    upgradePreview: vi.fn(),
    upgradeApply: vi.fn(),
    upgradeLatest: vi.fn(),
    upgradeRollback: vi.fn(),
    classes: vi.fn(),
    roles: vi.fn(),
    years: vi.fn(),
  },
}))
vi.mock('@/shared/api/students', () => ({ studentsApi: { listInClass: vi.fn() } }))
vi.mock('../Org/orgApi', () => ({ orgApi: { people: vi.fn() } }))
const api = vi.mocked(adminApi)
const students = vi.mocked(studentsApi)
const org = vi.mocked(orgApi)

const seats = { seat_rows: 7, seat_cols: 4, desk_size: 2, seat_layout: 'auto' } as const
const suggested = (): UpgradePlan => ({
  version: 1,
  from_year_id: 'y1',
  new_year: { name: '2027-2028学年', start_date: '2027-09-01', end_date: '2028-07-10' },
  classes: [
    {
      from_class_id: 'c1',
      from_name: '三年一班',
      action: 'promote',
      to_grade_name: '四年级',
      to_name: '一班',
      homeroom_teacher_id: 't1',
      teacher_name: '李老师',
      keep_teachers: true,
    },
    { from_class_id: 'c2', from_name: '六年一班', action: 'graduate', keep_teachers: true },
    {
      from_class_id: 'c3',
      from_name: '二年一班',
      action: 'promote',
      to_grade_name: '三年级',
      to_name: '一班',
      homeroom_teacher_id: null,
      teacher_name: null,
      keep_teachers: false,
    },
  ],
  students: [],
  new_classes: [],
  grade_heads: [
    { grade_name: '四年级', user_ids: ['u9'] },
    { grade_name: '三年级', user_ids: [] },
  ],
})
const adminClass = (id: string, name: string, grade: string) =>
  ({ id, name, grade_name: grade }) as ClassAdmin
const seat = (eid: string, name: string) =>
  ({ enrollment_id: eid, student_id: `s-${eid}`, name }) as StudentSeat
const headRole: AdminRole = {
  binding_id: 'b1',
  user_id: 'u9',
  display_name: '赵组长',
  role: 'grade_head',
  grade_id: 'g4',
  grade_name: '四年级',
}
const preview = (classes: ClassPreview[] = []): UpgradePreview => ({
  new_year: '2027-2028学年',
  classes,
  new_classes: [],
  warnings: [],
})
const activeYear = (id: string): YearAdmin => ({
  id,
  name: '学年',
  start_date: '2026-09-01',
  end_date: '2027-07-10',
  term2_start: null,
  is_active: true,
})
const latest: UpgradeLatest = {
  id: 'up1',
  executed_at: '2027-08-20T08:30:00Z',
  from_year_name: '2026-2027',
  to_year_name: '2027-2028',
  rolled_back: false,
}
const cp = (o: Partial<ClassPreview>): ClassPreview => ({
  from_name: '三年一班',
  action: 'promote',
  to_label: '四年级 一班',
  teacher_name: '李老师',
  follow: 38,
  repeat_in: 0,
  repeat_out: 1,
  leave: 1,
  graduate: 0,
  ...o,
})

beforeEach(() => {
  window.localStorage.clear()
  api.upgradeSuggest.mockResolvedValue(suggested())
  api.upgradePreview.mockResolvedValue(preview([cp({})]))
  api.upgradeLatest.mockResolvedValue(null)
  api.classes.mockResolvedValue([
    adminClass('c1', '三年一班', '三年级'),
    adminClass('c2', '六年一班', '六年级'),
    adminClass('c3', '二年一班', '二年级'),
  ])
  api.roles.mockResolvedValue([headRole])
  api.years.mockResolvedValue([activeYear('y1')])
  students.listInClass.mockResolvedValue({ items: [seat('e1', '周小乐'), seat('e2', '吴小米')] })
  org.people.mockResolvedValue([
    { user_id: 'u7', name: '王老师', login_name: 'wang', subjects: ['数学'] },
  ])
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  useAuthStore.setState({ user: null })
})

let qc: QueryClient
const renderPage = () =>
  render(
    <QueryClientProvider
      client={(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }))}
    >
      <UpgradePage />
    </QueryClientProvider>,
  )

async function generate() {
  fireEvent.change(await screen.findByLabelText('学年名称'), { target: { value: '2027-2028学年' } })
  fireEvent.change(screen.getByLabelText('开学日期'), { target: { value: '2027-09-01' } })
  fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2028-07-10' } })
  fireEvent.click(screen.getByRole('button', { name: '生成建议' }))
  await screen.findByLabelText('三年一班 去向')
}
const step = (n: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(n) }))
const lastPreviewBody = () => api.upgradePreview.mock.calls.at(-1)![0]

describe('suggest and prefill', () => {
  it('prefills every step from the suggested plan', async () => {
    renderPage()
    await generate()
    expect(api.upgradeSuggest).toHaveBeenCalledWith({
      name: '2027-2028学年',
      start_date: '2027-09-01',
      end_date: '2028-07-10',
    })
    expect(screen.getByLabelText('三年一班 去向')).toHaveValue('promote')
    expect(screen.getByLabelText('三年一班 新年级名')).toHaveValue('四年级')
    expect(screen.getByLabelText('三年一班 新班名')).toHaveValue('一班')
    expect(screen.getByRole('button', { name: '三年一班 班主任' })).toHaveTextContent('李老师')
    expect(screen.getByLabelText('三年一班 保留任课老师')).toBeChecked()
    expect(screen.getByLabelText('二年一班 保留任课老师')).not.toBeChecked()
    expect(screen.getByLabelText('六年一班 去向')).toHaveValue('graduate')
    step('学生例外')
    expect(await screen.findByLabelText('周小乐 去向')).toHaveValue('follow')
    step('新建班级')
    expect(screen.queryByLabelText(/新建班1/)).toBeNull()
    step('人员')
    expect(screen.getByText('四年级')).toBeInTheDocument()
    expect(await screen.findByText('赵组长')).toBeInTheDocument()
  })

  it('shows an unknown-account placeholder without losing the id', async () => {
    api.roles.mockResolvedValue([])
    renderPage()
    await generate()
    step('人员')
    expect(await screen.findByText('(未知账号)')).toBeInTheDocument()
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    expect(lastPreviewBody().grade_heads).toEqual([
      { grade_name: '四年级', user_ids: ['u9'] },
      { grade_name: '三年级', user_ids: [] },
    ])
  })
})

describe('draft', () => {
  it('survives a remount', async () => {
    const first = renderPage()
    await generate()
    fireEvent.change(screen.getByLabelText('三年一班 新班名'), { target: { value: '二班' } })
    first.unmount()
    renderPage()
    expect(await screen.findByLabelText('三年一班 新班名')).toHaveValue('二班')
    expect(api.upgradeSuggest).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem('ws-upgrade-draft')).not.toBeNull()
  })

  it('is cleared by discarding', async () => {
    renderPage()
    await generate()
    fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }))
    fireEvent.click(screen.getByRole('button', { name: '确认放弃' }))
    await screen.findByLabelText('学年名称')
    expect(window.localStorage.getItem('ws-upgrade-draft')).toBeNull()
    expect(screen.getByLabelText('学年名称')).toHaveValue('')
  })

  it('keeps working when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    renderPage()
    await generate()
    fireEvent.change(screen.getByLabelText('三年一班 新班名'), { target: { value: '二班' } })
    expect(screen.getByLabelText('三年一班 新班名')).toHaveValue('二班')
    fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }))
    fireEvent.click(screen.getByRole('button', { name: '确认放弃' }))
    expect(await screen.findByLabelText('学年名称')).toHaveValue('')
  })
})

describe('B-5 complete fields', () => {
  it('sends full seat fields for a newly added class', async () => {
    renderPage()
    await generate()
    step('新建班级')
    fireEvent.click(screen.getByRole('button', { name: '新增班级' }))
    expect(screen.getByLabelText('新建班1 行数')).toHaveValue(7)
    expect(screen.getByLabelText('新建班1 列数')).toHaveValue(4)
    fireEvent.change(screen.getByLabelText('新建班1 年级名'), { target: { value: '一年级' } })
    fireEvent.change(screen.getByLabelText('新建班1 班名'), { target: { value: '一班' } })
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    expect(lastPreviewBody().new_classes).toEqual([
      {
        grade_name: '一年级',
        name: '一班',
        homeroom_teacher_id: null,
        seat_rows: 7,
        seat_cols: 4,
        desk_size: 2,
        seat_layout: 'auto',
      },
    ])
  })

  it('tolerates a suggest response with missing fields', async () => {
    const thin = suggested() as unknown as Record<string, unknown>
    delete thin.students
    delete thin.new_classes
    ;(thin.classes as Record<string, unknown>[]).forEach((c) => {
      delete c.keep_teachers
    })
    api.upgradeSuggest.mockResolvedValue(thin as unknown as UpgradePlan)
    renderPage()
    await generate()
    expect(screen.getByLabelText('三年一班 保留任课老师')).toBeChecked()
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    const body = lastPreviewBody()
    expect(body.students).toEqual([])
    expect(body.new_classes).toEqual([])
    expect(body.classes.every((c) => c.keep_teachers === true)).toBe(true)
  })

  it('removing a new class drops and renumbers student targets', () => {
    const plan: UpgradePlan = {
      ...suggested(),
      new_classes: [
        { grade_name: '一年级', name: '一班', ...seats },
        { grade_name: '一年级', name: '二班', ...seats },
      ],
      students: [
        { enrollment_id: 'a', action: 'repeat', to: { new_class: 0 } },
        { enrollment_id: 'b', action: 'repeat', to: { new_class: 1 } },
        { enrollment_id: 'c', action: 'leave', to: null },
      ],
    }
    const next = removeNewClass(plan, 0)
    expect(next.new_classes.map((n) => n.name)).toEqual(['二班'])
    expect(next.students).toEqual([
      { enrollment_id: 'b', action: 'repeat', to: { new_class: 0 } },
      { enrollment_id: 'c', action: 'leave', to: null },
    ])
  })
})

describe('homeroom teacher id contract', () => {
  it('writes the picked user_id and name into the plan', async () => {
    renderPage()
    await generate()
    fireEvent.click(screen.getByRole('button', { name: '三年一班 班主任' }))
    fireEvent.click(await screen.findByRole('button', { name: /王老师/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '三年一班 班主任' })).toHaveTextContent('王老师'),
    )
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    const c = lastPreviewBody().classes[0]
    expect(c.homeroom_teacher_id).toBe('u7')
    expect(c.teacher_name).toBe('王老师')
  })

  it('keeps the suggested teacher id untouched', async () => {
    renderPage()
    await generate()
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    expect(lastPreviewBody().classes[0].homeroom_teacher_id).toBe('t1')
  })
})

describe('grade heads', () => {
  it('sends an array even when every head is removed', async () => {
    renderPage()
    await generate()
    step('人员')
    fireEvent.click(await screen.findByRole('button', { name: '移除 四年级 年级组长 赵组长' }))
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    expect(lastPreviewBody().grade_heads).toEqual([
      { grade_name: '四年级', user_ids: [] },
      { grade_name: '三年级', user_ids: [] },
    ])
  })

  it('adds a picked head', async () => {
    renderPage()
    await generate()
    step('人员')
    fireEvent.click(screen.getByRole('button', { name: '三年级 年级组长' }))
    fireEvent.click(await screen.findByRole('button', { name: /王老师/ }))
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    expect(lastPreviewBody().grade_heads).toEqual([
      { grade_name: '四年级', user_ids: ['u9'] },
      { grade_name: '三年级', user_ids: ['u7'] },
    ])
  })

  it('moves heads to the new name when exactly one grade is renamed', async () => {
    renderPage()
    await generate()
    fireEvent.change(screen.getByLabelText('三年一班 新年级名'), { target: { value: '五年级' } })
    step('人员')
    expect(screen.getByRole('button', { name: '五年级 年级组长' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '四年级 年级组长' })).toBeNull()
    expect(await screen.findByText('赵组长')).toBeInTheDocument()
    expect(screen.queryByText('年级名已改,组长未沿用,请重新选择')).toBeNull()
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    expect(lastPreviewBody().grade_heads).toEqual([
      { grade_name: '五年级', user_ids: ['u9'] },
      { grade_name: '三年级', user_ids: [] },
    ])
  })

  it('warns when renamed grades cannot be matched and heads are dropped', async () => {
    renderPage()
    await generate()
    fireEvent.change(screen.getByLabelText('三年一班 新年级名'), { target: { value: '五年级' } })
    fireEvent.change(screen.getByLabelText('二年一班 新年级名'), { target: { value: '六年级' } })
    step('人员')
    expect(screen.getByText('年级名已改,组长未沿用,请重新选择')).toBeInTheDocument()
    expect(screen.queryByText('赵组长')).toBeNull()
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    expect(lastPreviewBody().grade_heads).toEqual([
      { grade_name: '五年级', user_ids: [] },
      { grade_name: '六年级', user_ids: [] },
    ])
  })

  it('trims grade names so classes, new classes and heads agree', async () => {
    renderPage()
    await generate()
    fireEvent.change(screen.getByLabelText('三年一班 新年级名'), { target: { value: '四年级 ' } })
    step('新建班级')
    fireEvent.click(screen.getByRole('button', { name: '新增班级' }))
    fireEvent.change(screen.getByLabelText('新建班1 年级名'), { target: { value: ' 三年级 ' } })
    fireEvent.change(screen.getByLabelText('新建班1 班名'), { target: { value: '二班 ' } })
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    const b = lastPreviewBody()
    expect(b.classes[0].to_grade_name).toBe('四年级')
    expect(b.new_classes[0].grade_name).toBe('三年级')
    expect(b.new_classes[0].name).toBe('二班')
    expect(b.grade_heads).toEqual([
      { grade_name: '四年级', user_ids: ['u9'] },
      { grade_name: '三年级', user_ids: [] },
    ])
  })

  it('keeps null (legacy follow-the-grade rule) when never edited', async () => {
    api.upgradeSuggest.mockResolvedValue({ ...suggested(), grade_heads: null })
    renderPage()
    await generate()
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    expect(lastPreviewBody().grade_heads).toBeNull()
  })
})

describe('student exceptions', () => {
  it('marks repeat to a successor class and leave, and restores', async () => {
    renderPage()
    await generate()
    step('学生例外')
    const repeat = await screen.findByLabelText('周小乐 去向')
    fireEvent.change(repeat, { target: { value: 'repeat' } })
    // 三年一班在三年级:合法目标只有升入三年级的二年一班继任班
    const target = screen.getByLabelText('周小乐 留级目标')
    expect(within(target).getAllByRole('option')).toHaveLength(1)
    expect(target).toHaveValue('s:c3')
    fireEvent.change(screen.getByLabelText('吴小米 去向'), { target: { value: 'leave' } })
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    expect(lastPreviewBody().students).toEqual([
      { enrollment_id: 'e1', name: '周小乐', action: 'repeat', to: { successor_of: 'c3' } },
      { enrollment_id: 'e2', name: '吴小米', action: 'leave', to: null },
    ])
    step('学生例外')
    fireEvent.change(await screen.findByLabelText('吴小米 去向'), { target: { value: 'follow' } })
    step('预览')
    await waitFor(() => expect(lastPreviewBody().students).toHaveLength(1))
  })

  it('can repeat into a new class of the same grade', async () => {
    renderPage()
    await generate()
    step('新建班级')
    fireEvent.click(screen.getByRole('button', { name: '新增班级' }))
    fireEvent.change(screen.getByLabelText('新建班1 年级名'), { target: { value: '三年级' } })
    fireEvent.change(screen.getByLabelText('新建班1 班名'), { target: { value: '二班' } })
    step('学生例外')
    fireEvent.change(await screen.findByLabelText('周小乐 去向'), { target: { value: 'repeat' } })
    const target = screen.getByLabelText('周小乐 留级目标')
    fireEvent.change(target, { target: { value: 'n:0' } })
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    expect(lastPreviewBody().students[0].to).toEqual({ new_class: 0 })
  })

  it('maps a students 400 back to the class and row', async () => {
    renderPage()
    await generate()
    step('学生例外')
    fireEvent.change(await screen.findByLabelText('周小乐 去向'), { target: { value: 'repeat' } })
    api.upgradePreview.mockRejectedValue(
      new ApiError(400, 'UPGRADE_PLAN_INVALID', '周小乐 留级的目标年级不一致', {
        section: 'students',
        index: 0,
        field: 'to',
      }),
    )
    step('预览')
    expect(await screen.findByLabelText('周小乐 留级目标')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('吴小米 去向')).not.toHaveAttribute('aria-invalid')
    expect(screen.getByText('周小乐 留级的目标年级不一致')).toBeInTheDocument()
  })
})

describe('errors from the backend', () => {
  it('jumps to the new class row and marks the field', async () => {
    renderPage()
    await generate()
    step('新建班级')
    fireEvent.click(screen.getByRole('button', { name: '新增班级' }))
    fireEvent.click(screen.getByRole('button', { name: '新增班级' }))
    api.upgradePreview.mockRejectedValue(
      new ApiError(400, 'UPGRADE_PLAN_INVALID', '座位列数必须是每桌人数的整数倍', {
        section: 'new_classes',
        index: 1,
        field: 'seat_cols',
      }),
    )
    step('预览')
    const bad = await screen.findByLabelText('新建班2 列数')
    expect(bad).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('新建班1 列数')).not.toHaveAttribute('aria-invalid')
    expect(screen.getByText('座位列数必须是每桌人数的整数倍')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新建班级/ })).toHaveAttribute('aria-current', 'step')
  })

  it('maps a new_year error to the first step', async () => {
    renderPage()
    await generate()
    api.upgradePreview.mockRejectedValue(
      new ApiError(400, 'UPGRADE_PLAN_INVALID', '学年名 2027-2028学年 已存在', {
        section: 'new_year',
        field: 'name',
      }),
    )
    step('预览')
    expect(await screen.findByLabelText('学年名称')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('开学日期')).not.toHaveAttribute('aria-invalid')
  })

  it('maps a classes error to the class row and field', async () => {
    renderPage()
    await generate()
    api.upgradePreview.mockRejectedValue(
      new ApiError(400, 'UPGRADE_PLAN_INVALID', '新学年 三年级 出现重名班 一班', {
        section: 'classes',
        index: 2,
        field: 'to_name',
      }),
    )
    step('预览')
    expect(await screen.findByLabelText('二年一班 新班名')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('三年一班 新班名')).not.toHaveAttribute('aria-invalid')
    expect(screen.getByText('新学年 三年级 出现重名班 一班')).toBeInTheDocument()
  })

  it('maps a grade_heads error to the people row', async () => {
    renderPage()
    await generate()
    api.upgradePreview.mockRejectedValue(
      new ApiError(400, 'UPGRADE_PLAN_INVALID', '找不到年级组长账号', {
        section: 'grade_heads',
        index: 0,
        field: 'user_ids',
      }),
    )
    step('预览')
    expect(await screen.findByRole('button', { name: '四年级 年级组长' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByRole('button', { name: '三年级 年级组长' })).not.toHaveAttribute(
      'aria-invalid',
    )
  })

  it('shows a regenerate entry on a stale plan and keeps name and dates', async () => {
    renderPage()
    await generate()
    api.upgradePreview.mockRejectedValue(
      new ApiError(409, 'UPGRADE_PLAN_STALE', '方案基于的学年已不是进行中的学年'),
    )
    step('预览')
    expect(await screen.findByText('方案已过期,请重新生成')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    await waitFor(() => expect(api.upgradeSuggest).toHaveBeenCalledTimes(2))
    expect(api.upgradeSuggest).toHaveBeenLastCalledWith({
      name: '2027-2028学年',
      start_date: '2027-09-01',
      end_date: '2028-07-10',
    })
  })

  it('shows other preview errors with their message', async () => {
    renderPage()
    await generate()
    api.upgradePreview.mockRejectedValue(new ApiError(500, 'X', '服务器开小差了'))
    step('预览')
    expect(await screen.findByText('服务器开小差了')).toBeInTheDocument()
  })
})

describe('preview (B-4)', () => {
  it('renders each of the three actions (the type admits no other, L53)', async () => {
    api.upgradePreview.mockResolvedValue(
      preview([
        cp({}),
        cp({
          from_name: '六年一班',
          action: 'graduate',
          to_label: '毕业',
          teacher_name: null,
          follow: 0,
          graduate: 40,
        }),
        cp({
          from_name: '一年二班',
          action: 'new',
          to_label: '一年级 二班',
          follow: 0,
          repeat_out: 0,
          leave: 0,
          repeat_in: 2,
        }),
      ]),
    )
    renderPage()
    await generate()
    step('预览')
    expect(
      await screen.findByText(/三年一班 → 四年级 一班.*班主任:李老师.*随班 38 人/),
    ).toBeInTheDocument()
    expect(screen.getByText(/六年一班 毕业.*毕业 40 人/)).toBeInTheDocument()
    expect(screen.getByText(/新建班 一年级 二班/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '执行升级' })).toBeInTheDocument()
  })

  it('shows warnings', async () => {
    api.upgradePreview.mockResolvedValue({ ...preview([cp({})]), warnings: ['一班 没有班主任'] })
    renderPage()
    await generate()
    step('预览')
    expect(await screen.findByText('警告:一班 没有班主任')).toBeInTheDocument()
  })
})

describe('apply', () => {
  it('confirms, applies, clears the draft and refreshes the latest card', async () => {
    api.upgradeApply.mockResolvedValue({ upgrade_id: 'up1', new_year_id: 'y2' })
    api.upgradeLatest.mockResolvedValueOnce(null).mockResolvedValue(latest)
    renderPage()
    await generate()
    step('预览')
    fireEvent.click(await screen.findByRole('button', { name: '执行升级' }))
    expect(screen.getByText('执行后新学年立即生效')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(await screen.findByText('升级已执行,新学年已生效')).toBeInTheDocument()
    expect(api.upgradeApply).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1, from_year_id: 'y1' }),
    )
    expect(window.localStorage.getItem('ws-upgrade-draft')).toBeNull()
    expect(await screen.findByText(/2026-2027 → 2027-2028,执行于/)).toBeInTheDocument()
    expect(screen.getByLabelText('学年名称')).toHaveValue('')
  })

  it('maps an apply 400 back to the step', async () => {
    api.upgradeApply.mockRejectedValue(
      new ApiError(400, 'UPGRADE_PLAN_INVALID', '学年名 2027-2028学年 已存在', {
        section: 'new_year',
        field: 'name',
      }),
    )
    renderPage()
    await generate()
    step('预览')
    fireEvent.click(await screen.findByRole('button', { name: '执行升级' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(await screen.findByText('学年名 2027-2028学年 已存在')).toBeInTheDocument()
    expect(screen.getByLabelText('学年名称')).toHaveAttribute('aria-invalid', 'true')
    expect(window.localStorage.getItem('ws-upgrade-draft')).not.toBeNull()
  })
})

describe('latest upgrade and rollback', () => {
  it('lists Chinese items when rollback is blocked by data', async () => {
    api.upgradeLatest.mockResolvedValue(latest)
    api.upgradeRollback.mockRejectedValue(
      new ApiError(409, 'UPGRADE_HAS_DATA', '新学年已经产生数据,不能回滚', {
        class_boards: 3,
        seats: 2,
        class_roles: 1,
        transfers: 4,
        grade_exams: 2,
        attendances: 5,
        new_students: 6,
        new_grades: 1,
        new_classes: 2,
        new_assignments: 3,
        new_bindings: 4,
        mystery: 7,
      }),
    )
    renderPage()
    expect(await screen.findByText(/2026-2027 → 2027-2028,执行于/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '回滚' }))
    expect(
      screen.getByText('回滚会删除新学年的班级与注册记录,往年数据不受影响'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认回滚' }))
    expect(await screen.findByText('年级联考 2 场')).toBeInTheDocument()
    for (const t of [
      '看板改动 3 处',
      '座位调整 2 个班',
      '班干部变动 1 人',
      '学生转出 4 人',
      '考勤记录 5 条',
      '新增学生 6 人',
      '手动新建的年级 1 个',
      '手动新建的班级 2 个',
      '手动添加的任职 3 条',
      '手动添加的管理岗任命 4 条',
      'mystery: 7',
    ])
      expect(screen.getByText(t)).toBeInTheDocument()
  })

  it('refreshes the card after a successful rollback', async () => {
    api.upgradeLatest
      .mockResolvedValueOnce(latest)
      .mockResolvedValue({ ...latest, rolled_back: true })
    api.upgradeRollback.mockResolvedValue({ ok: true })
    renderPage()
    await screen.findByText(/2026-2027 → 2027-2028,执行于/)
    fireEvent.click(screen.getByRole('button', { name: '回滚' }))
    fireEvent.click(screen.getByRole('button', { name: '确认回滚' }))
    await waitFor(() => expect(api.upgradeLatest).toHaveBeenCalledTimes(2))
    expect(api.upgradeRollback).toHaveBeenCalledWith('up1')
    await waitFor(() => expect(screen.getByRole('button', { name: '回滚' })).toBeDisabled())
    expect(screen.getByText('已回滚')).toBeInTheDocument()
  })

  it('invalidates year-scoped caches (history, grade exams, reports, people) after a rollback', async () => {
    api.upgradeLatest.mockResolvedValue(latest)
    api.upgradeRollback.mockResolvedValue({ ok: true })
    renderPage()
    await screen.findByText(/2026-2027 → 2027-2028,执行于/)
    const keys = [
      ['history', 'years'],
      ['grade-exams', null],
      ['report', 'scores', 'e1'],
      ['report', 'attendance', '2026-10', null],
      ['admin', 'org', 'people', ''],
    ]
    keys.forEach((k) => qc.setQueryData(k, []))
    fireEvent.click(screen.getByRole('button', { name: '回滚' }))
    fireEvent.click(screen.getByRole('button', { name: '确认回滚' }))
    await waitFor(() =>
      keys.forEach((k) => expect(qc.getQueryState(k)?.isInvalidated, JSON.stringify(k)).toBe(true)),
    )
  })

  it('disables rollback when already rolled back', async () => {
    api.upgradeLatest.mockResolvedValue({ ...latest, rolled_back: true })
    renderPage()
    await screen.findByText(/2026-2027 → 2027-2028,执行于/)
    expect(screen.getByRole('button', { name: '回滚' })).toBeDisabled()
  })
})

const DRAFT = 'ws-upgrade-draft'
const asUser = (id: string) => useAuthStore.setState({ user: { id } as User })

describe('review: year edits follow into the plan', () => {
  it('sends the renamed year after a new_year 400', async () => {
    renderPage()
    await generate()
    api.upgradePreview.mockRejectedValueOnce(
      new ApiError(400, 'UPGRADE_PLAN_INVALID', '学年名 2027-2028学年 已存在', {
        section: 'new_year',
        field: 'name',
      }),
    )
    step('预览')
    const name = await screen.findByLabelText('学年名称')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(name, { target: { value: '2027-2028学年(新)' } })
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2028-07-20' } })
    expect(screen.getByLabelText('学年名称')).not.toHaveAttribute('aria-invalid')
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalledTimes(2))
    expect(lastPreviewBody().new_year).toEqual({
      name: '2027-2028学年(新)',
      start_date: '2027-09-01',
      end_date: '2028-07-20',
    })
  })
})

describe('review: draft isolation and staleness', () => {
  it("discards another user's draft", async () => {
    asUser('u-me')
    const first = renderPage()
    await generate()
    first.unmount()
    renderPage()
    expect(await screen.findByLabelText('三年一班 新班名')).toBeInTheDocument()
    cleanup()
    asUser('u-other')
    renderPage()
    expect(await screen.findByLabelText('学年名称')).toHaveValue('')
    expect(window.localStorage.getItem(DRAFT)).toBeNull()
  })

  it.each([
    ['corrupt JSON', 'not json{'],
    [
      'an old structure without version',
      JSON.stringify({
        step: 'classes',
        year: { name: 'x', start_date: '', end_date: '' },
        plan: suggested(),
      }),
    ],
    [
      'a plan without classes',
      JSON.stringify({ v: 2, owner: null, step: 'classes', year: {}, plan: { version: 1 } }),
    ],
  ])('discards %s', async (_n, raw) => {
    window.localStorage.setItem(DRAFT, raw)
    renderPage()
    expect(await screen.findByLabelText('学年名称')).toHaveValue('')
    expect(window.localStorage.getItem(DRAFT)).toBeNull()
  })

  it('tells the user when the draft is based on an old year and keeps name and dates', async () => {
    const first = renderPage()
    await generate()
    first.unmount()
    api.years.mockResolvedValue([activeYear('y2')])
    renderPage()
    expect(await screen.findByText('草稿基于旧学年,请重新生成')).toBeInTheDocument()
    expect(window.localStorage.getItem(DRAFT)).not.toBeNull()
    api.upgradeSuggest.mockResolvedValue({ ...suggested(), from_year_id: 'y2' })
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    await waitFor(() => expect(api.upgradeSuggest).toHaveBeenCalledTimes(2))
    expect(api.upgradeSuggest).toHaveBeenLastCalledWith({
      name: '2027-2028学年',
      start_date: '2027-09-01',
      end_date: '2028-07-10',
    })
    await waitFor(() => expect(screen.queryByText('草稿基于旧学年,请重新生成')).toBeNull())
  })

  it('shows no old-year notice when the draft matches the active year', async () => {
    const first = renderPage()
    await generate()
    first.unmount()
    renderPage()
    await screen.findByLabelText('三年一班 新班名')
    await waitFor(() => expect(api.years).toHaveBeenCalled())
    expect(screen.queryByText('草稿基于旧学年,请重新生成')).toBeNull()
  })

  it('enables discarding as soon as anything was typed', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: '放弃草稿' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('开学日期'), { target: { value: '2027-09-01' } })
    expect(screen.getByRole('button', { name: '放弃草稿' })).toBeEnabled()
  })
})

describe('review: orphan exception rows', () => {
  const withOrphans = () => ({
    ...suggested(),
    students: [
      { enrollment_id: 'ex-12345678-aaaa', name: '退学生', action: 'leave' as const, to: null },
      { enrollment_id: 'zz-87654321-bbbb', action: 'leave' as const, to: null },
    ],
  })

  it('lists exceptions missing from the student list and lets the user remove them', async () => {
    api.upgradeSuggest.mockResolvedValue(withOrphans())
    renderPage()
    await generate()
    step('学生例外')
    await screen.findByLabelText('周小乐 去向')
    expect(screen.getByText('退学生')).toBeInTheDocument()
    expect(screen.getByText('zz-87654')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '移除 退学生' }))
    expect(screen.queryByText('退学生')).toBeNull()
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    expect(lastPreviewBody().students.map((x) => x.enrollment_id)).toEqual(['zz-87654321-bbbb'])
  })

  it('marks an orphan row a students 400 points at', async () => {
    api.upgradeSuggest.mockResolvedValue(withOrphans())
    renderPage()
    await generate()
    api.upgradePreview.mockRejectedValue(
      new ApiError(400, 'UPGRADE_PLAN_INVALID', '退学生 不在旧学年进行中班级的在籍名单里', {
        section: 'students',
        index: 0,
        field: 'enrollment_id',
      }),
    )
    step('预览')
    const row = (await screen.findByText('退学生')).closest('li')!
    expect(row).toHaveAttribute('data-invalid', 'true')
    expect(screen.getByText('zz-87654').closest('li')).not.toHaveAttribute('data-invalid')
  })

  it('flags a repeat target that no longer fits after a grade rename', async () => {
    renderPage()
    await generate()
    step('学生例外')
    fireEvent.change(await screen.findByLabelText('周小乐 去向'), { target: { value: 'repeat' } })
    expect(screen.getByLabelText('周小乐 留级目标')).toHaveValue('s:c3')
    step('班级去向')
    fireEvent.change(screen.getByLabelText('二年一班 新年级名'), { target: { value: '五年级' } })
    step('学生例外')
    const target = await screen.findByLabelText('周小乐 留级目标')
    expect(target).toHaveValue('s:c3')
    expect(within(target).getByText('目标已失效,请重新选择')).toBeInTheDocument()
    expect(target).toHaveAttribute('aria-invalid', 'true')
  })

  it('jumps back to the right class for a students 400 on another class', async () => {
    students.listInClass.mockImplementation(async (id) => ({
      items: id === 'c3' ? [seat('e3', '郑小花')] : [seat('e1', '周小乐'), seat('e2', '吴小米')],
    }))
    renderPage()
    await generate()
    step('学生例外')
    fireEvent.change(await screen.findByLabelText('周小乐 去向'), { target: { value: 'leave' } })
    fireEvent.change(screen.getByLabelText('选择班级'), { target: { value: 'c3' } })
    fireEvent.change(await screen.findByLabelText('郑小花 去向'), { target: { value: 'leave' } })
    fireEvent.change(screen.getByLabelText('选择班级'), { target: { value: 'c1' } })
    await screen.findByLabelText('周小乐 去向')
    api.upgradePreview.mockRejectedValue(
      new ApiError(400, 'UPGRADE_PLAN_INVALID', '郑小花 有问题', {
        section: 'students',
        index: 1,
        field: 'enrollment_id',
      }),
    )
    step('预览')
    expect(await screen.findByLabelText('郑小花 去向')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('选择班级')).toHaveValue('c3')
  })
})

describe('review: error banner and rows', () => {
  it('always shows the message in the top banner, even without a matching row', async () => {
    renderPage()
    await generate()
    api.upgradePreview.mockRejectedValue(
      new ApiError(400, 'UPGRADE_PLAN_INVALID', '新建班序号越界', {
        section: 'new_classes',
        index: 5,
        field: 'name',
      }),
    )
    step('预览')
    await screen.findByRole('button', { name: '新增班级' })
    expect(screen.getByRole('alert')).toHaveTextContent('新建班序号越界')
  })

  it('announces a row problem once', async () => {
    renderPage()
    await generate()
    step('新建班级')
    fireEvent.click(screen.getByRole('button', { name: '新增班级' }))
    api.upgradePreview.mockRejectedValue(
      new ApiError(400, 'UPGRADE_PLAN_INVALID', '座位列数不对', {
        section: 'new_classes',
        index: 0,
        field: 'seat_cols',
      }),
    )
    step('预览')
    await screen.findByText('座位列数不对')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})

describe('review: preview resilience', () => {
  it('survives a response missing lists and counts', async () => {
    api.upgradePreview.mockResolvedValue({ new_year: '2027-2028学年' } as unknown as UpgradePreview)
    renderPage()
    await generate()
    step('预览')
    expect(await screen.findByRole('button', { name: '执行升级' })).toBeInTheDocument()
  })

  it('renders classes with missing counts as zero and duplicate warnings', async () => {
    api.upgradePreview.mockResolvedValue({
      ...preview([
        {
          from_name: '甲班',
          action: 'promote',
          to_label: '乙',
          teacher_name: null,
        } as unknown as ClassPreview,
      ]),
      warnings: ['重复', '重复'],
    })
    renderPage()
    await generate()
    step('预览')
    expect(
      await screen.findByText(/随班 0 · 留级转入 0 · 留级转出 0 · 离校 0 · 毕业 0/),
    ).toBeInTheDocument()
    expect(screen.getAllByText('警告:重复')).toHaveLength(2)
  })
})

describe('review: rollback with nothing to roll back', () => {
  it('reloads the latest card', async () => {
    api.upgradeLatest
      .mockResolvedValueOnce(latest)
      .mockResolvedValue({ ...latest, rolled_back: true })
    api.upgradeRollback.mockRejectedValue(
      new ApiError(409, 'UPGRADE_NOTHING_TO_ROLLBACK', '没有可以回滚的学年升级'),
    )
    renderPage()
    await screen.findByText(/2026-2027 → 2027-2028,执行于/)
    fireEvent.click(screen.getByRole('button', { name: '回滚' }))
    fireEvent.click(screen.getByRole('button', { name: '确认回滚' }))
    expect(await screen.findByText('没有可以回滚的学年升级')).toBeInTheDocument()
    await waitFor(() => expect(api.upgradeLatest).toHaveBeenCalledTimes(2))
  })
})

describe('rollback of a stale card', () => {
  it('reloads the latest card when the upgrade is no longer the latest', async () => {
    api.upgradeLatest.mockResolvedValueOnce(latest).mockResolvedValue({ ...latest, id: 'up2' })
    api.upgradeRollback.mockRejectedValue(
      new ApiError(409, 'UPGRADE_NOT_LATEST', '只能回滚最近一次升级', { latest_id: 'up2' }),
    )
    renderPage()
    await screen.findByText(/2026-2027 → 2027-2028,执行于/)
    fireEvent.click(screen.getByRole('button', { name: '回滚' }))
    fireEvent.click(screen.getByRole('button', { name: '确认回滚' }))
    await waitFor(() => expect(api.upgradeLatest).toHaveBeenCalledTimes(2))
    expect(api.upgradeRollback).toHaveBeenCalledWith('up1')
    expect(await screen.findByText('只能回滚最近一次升级')).toBeInTheDocument() // toast 显示后端的 message
  })
})

describe('review: new class rows', () => {
  it('deletes a new class from the UI and renumbers the rest', async () => {
    renderPage()
    await generate()
    step('新建班级')
    fireEvent.click(screen.getByRole('button', { name: '新增班级' }))
    fireEvent.click(screen.getByRole('button', { name: '新增班级' }))
    fireEvent.change(screen.getByLabelText('新建班1 班名'), { target: { value: '甲' } })
    fireEvent.change(screen.getByLabelText('新建班2 班名'), { target: { value: '乙' } })
    fireEvent.click(screen.getByRole('button', { name: '删除新建班1' }))
    expect(screen.queryByLabelText('新建班2 班名')).toBeNull()
    expect(screen.getByLabelText('新建班1 班名')).toHaveValue('乙')
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    expect(lastPreviewBody().new_classes.map((n) => n.name)).toEqual(['乙'])
  })

  it('lets a number field be empty while editing and normalizes it afterwards', async () => {
    renderPage()
    await generate()
    step('新建班级')
    fireEvent.click(screen.getByRole('button', { name: '新增班级' }))
    const cols = screen.getByLabelText('新建班1 列数')
    fireEvent.change(cols, { target: { value: '' } })
    expect(cols).toHaveValue(null)
    fireEvent.blur(cols)
    expect(cols).toHaveValue(4)
    fireEvent.change(cols, { target: { value: '6' } })
    expect(cols).toHaveValue(6)
    fireEvent.change(cols, { target: { value: '' } })
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    expect(lastPreviewBody().new_classes[0].seat_cols).toBe(6)
  })
})

describe('final review polish', () => {
  it('reuses the class-students query key and has no preview query', async () => {
    renderPage()
    await generate()
    step('学生例外')
    await screen.findByLabelText('周小乐 去向')
    expect(qc.getQueryData(['class-students', 'c1'])).toBeDefined()
    expect(qc.getQueryCache().findAll({ queryKey: ['upgrade', 'students'] })).toHaveLength(0)
    step('预览')
    await screen.findByRole('button', { name: '执行升级' })
    expect(qc.getQueryCache().findAll({ queryKey: ['upgrade', 'preview'] })).toHaveLength(0)
  })

  it('requests the preview again on every entry and after a plan change', async () => {
    renderPage()
    await generate()
    step('预览')
    await screen.findByRole('button', { name: '执行升级' })
    expect(api.upgradePreview).toHaveBeenCalledTimes(1)
    step('班级去向')
    fireEvent.change(screen.getByLabelText('三年一班 新班名'), { target: { value: '三班' } })
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalledTimes(2))
    expect(lastPreviewBody().classes[0].to_name).toBe('三班')
  })

  it('hints, without changing the value, when seat_cols does not fit the desk size', async () => {
    renderPage()
    await generate()
    step('新建班级')
    fireEvent.click(screen.getByRole('button', { name: '新增班级' }))
    expect(screen.queryByText(/每排座位数需为/)).toBeNull()
    expect(screen.getByLabelText('新建班1 列数')).toHaveAttribute('min', '2')
    fireEvent.change(screen.getByLabelText('新建班1 每桌人数'), { target: { value: '3' } })
    expect(screen.getByText('每排座位数需为 3 到 12 之间 3 的倍数')).toBeInTheDocument()
    expect(screen.getByLabelText('新建班1 列数')).toHaveValue(4)
    fireEvent.change(screen.getByLabelText('新建班1 列数'), { target: { value: '6' } })
    expect(screen.queryByText(/每排座位数需为/)).toBeNull()
    fireEvent.change(screen.getByLabelText('新建班1 每桌人数'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('新建班1 列数'), { target: { value: '5' } })
    expect(screen.getByText('每排座位数需为 2 到 12 之间的偶数')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('新建班1 每桌人数'), { target: { value: '1' } })
    expect(screen.queryByText(/每排座位数需为/)).toBeNull()
  })

  it('hides the done banner after discarding a new draft', async () => {
    api.upgradeApply.mockResolvedValue({ upgrade_id: 'up1', new_year_id: 'y2' })
    renderPage()
    await generate()
    step('预览')
    fireEvent.click(await screen.findByRole('button', { name: '执行升级' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    await screen.findByText('升级已执行,新学年已生效')
    fireEvent.change(screen.getByLabelText('开学日期'), { target: { value: '2028-09-01' } })
    fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }))
    fireEvent.click(screen.getByRole('button', { name: '确认放弃' }))
    await waitFor(() => expect(screen.queryByText('升级已执行,新学年已生效')).toBeNull())
  })

  it('hides the done banner after a successful rollback', async () => {
    api.upgradeApply.mockResolvedValue({ upgrade_id: 'up1', new_year_id: 'y2' })
    api.upgradeLatest.mockResolvedValue(latest)
    api.upgradeRollback.mockResolvedValue({ ok: true })
    renderPage()
    await generate()
    step('预览')
    fireEvent.click(await screen.findByRole('button', { name: '执行升级' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    await screen.findByText('升级已执行,新学年已生效')
    fireEvent.click(await screen.findByRole('button', { name: '回滚' }))
    fireEvent.click(screen.getByRole('button', { name: '确认回滚' }))
    await waitFor(() => expect(screen.queryByText('升级已执行,新学年已生效')).toBeNull())
  })

  it('disables apply when the draft is based on an old year', async () => {
    const first = renderPage()
    await generate()
    step('预览')
    await screen.findByRole('button', { name: '执行升级' })
    first.unmount()
    api.years.mockResolvedValue([activeYear('y2')])
    renderPage()
    await screen.findByText('草稿基于旧学年,请重新生成')
    expect(await screen.findByRole('button', { name: '执行升级' })).toBeDisabled()
  })

  it('disables apply after a stale answer', async () => {
    api.upgradeApply.mockRejectedValue(new ApiError(409, 'UPGRADE_PLAN_STALE', '过期'))
    renderPage()
    await generate()
    step('预览')
    fireEvent.click(await screen.findByRole('button', { name: '执行升级' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    await screen.findByText('方案已过期,请重新生成')
    expect(screen.getByRole('button', { name: '执行升级' })).toBeDisabled()
  })

  it('says how many repeat marks were removed with a deleted new class', async () => {
    renderPage()
    await generate()
    step('新建班级')
    fireEvent.click(screen.getByRole('button', { name: '新增班级' }))
    fireEvent.change(screen.getByLabelText('新建班1 年级名'), { target: { value: '三年级' } })
    fireEvent.change(screen.getByLabelText('新建班1 班名'), { target: { value: '二班' } })
    step('学生例外')
    fireEvent.change(await screen.findByLabelText('周小乐 去向'), { target: { value: 'repeat' } })
    fireEvent.change(screen.getByLabelText('周小乐 留级目标'), { target: { value: 'n:0' } })
    step('新建班级')
    expect(screen.queryByText(/留级标记已一并移除/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '删除新建班1' }))
    expect(screen.getByRole('status')).toHaveTextContent('1 名学生的留级标记已一并移除')
    step('预览')
    await waitFor(() => expect(api.upgradePreview).toHaveBeenCalled())
    expect(lastPreviewBody().students).toEqual([])
  })
})
