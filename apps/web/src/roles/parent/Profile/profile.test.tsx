import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { parentApi } from '@/shared/api/parent'
import { child, mockWidth, profile, renderParent, setParentUser, today } from '../testkit'

vi.mock('@/shared/api/parent', () => ({
  parentApi: { children: vi.fn(), today: vi.fn(), profile: vi.fn(), saveContacts: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  setParentUser()
  mockWidth(375)
  vi.mocked(parentApi.children).mockResolvedValue([child()])
  vi.mocked(parentApi.today).mockResolvedValue(today())
})

const open = () => renderParent('/parent/profile?child=s1')
const full = () =>
  profile({
    gender: '女',
    student_no: 'S0001',
    birthdate: '2016-05-06',
    class_role: '学习委员',
    family_structure: '双亲家庭',
    boarding: false,
    family_note: '奶奶接送',
    contacts: [{ name: '王妈妈', relation: '母亲', phone: '13800000001', job: '会计' }],
    learning_summary: '数学稳定',
    personality: '开朗',
    health_notes: '无',
    tags: ['爱画画', '足球'],
  })

it('shows the profile in read-only groups', async () => {
  vi.mocked(parentApi.profile).mockResolvedValue({ ...full(), can_edit_contacts: false })
  open()
  for (const h of ['基本信息', '家庭信息', '学习情况', '性格特长与健康', '标签']) {
    expect(await screen.findByRole('heading', { name: h })).toBeInTheDocument()
  }
  expect(screen.getByText('S0001')).toBeInTheDocument()
  expect(screen.getByText('奶奶接送')).toBeInTheDocument()
  expect(screen.getByText('爱画画')).toBeInTheDocument()
  expect(parentApi.profile).toHaveBeenCalledWith('s1')
})

it('copes with null and missing fields from the backend', async () => {
  vi.mocked(parentApi.profile).mockResolvedValue({
    ...profile({ can_edit_contacts: false }),
    gender: null,
    student_no: null,
    birthdate: null,
    family_structure: null,
    family_note: null,
    learning_summary: null,
    personality: null,
    health_notes: null,
    contacts: null,
    tags: null,
    boarding: null,
  } as never)
  open()
  expect(await screen.findByRole('heading', { name: '基本信息' })).toBeInTheDocument()
  expect(screen.getAllByText('暂无').length).toBeGreaterThan(3)
  expect(screen.getByText('还没有联系人')).toBeInTheDocument()
})

it('offers no edit entry to a secondary parent', async () => {
  vi.mocked(parentApi.profile).mockResolvedValue({ ...full(), can_edit_contacts: false })
  open()
  await screen.findByText('王妈妈')
  expect(screen.queryByRole('button', { name: /编辑/ })).toBeNull()
})

it('lets the primary parent edit contacts and saves with a toast', async () => {
  vi.mocked(parentApi.profile).mockResolvedValue(full())
  vi.mocked(parentApi.saveContacts).mockResolvedValue({
    ...full(),
    contacts: [{ name: '王妈妈', relation: '母亲', phone: '13800000009', job: '会计' }],
  })
  open()
  fireEvent.click(await screen.findByRole('button', { name: '编辑联系人' }))
  expect(screen.getAllByRole('textbox', { name: /^联系人\d电话$/ })).toHaveLength(2)
  fireEvent.change(screen.getByRole('textbox', { name: '联系人1电话' }), {
    target: { value: '13800000009' },
  })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(parentApi.saveContacts).toHaveBeenCalledWith('s1', [
      { name: '王妈妈', relation: '母亲', phone: '13800000009', job: '会计' },
    ]),
  )
  expect(await screen.findByText('已保存')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
  expect(screen.getByText('13800000009')).toBeInTheDocument()
})

it('rejects a contact with neither name nor phone and keeps the form open', async () => {
  vi.mocked(parentApi.profile).mockResolvedValue(full())
  open()
  fireEvent.click(await screen.findByRole('button', { name: '编辑联系人' }))
  fireEvent.change(screen.getByRole('textbox', { name: '联系人2关系' }), {
    target: { value: '父亲' },
  })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('联系人姓名和电话至少填一项')
  expect(parentApi.saveContacts).not.toHaveBeenCalled()
})

it('keeps the form and shows the server message when saving fails', async () => {
  vi.mocked(parentApi.profile).mockResolvedValue(full())
  vi.mocked(parentApi.saveContacts).mockRejectedValue(new Error('保存失败了'))
  open()
  fireEvent.click(await screen.findByRole('button', { name: '编辑联系人' }))
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('保存失败了')
  expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
})

it('cancel leaves edit mode without saving', async () => {
  vi.mocked(parentApi.profile).mockResolvedValue(full())
  open()
  fireEvent.click(await screen.findByRole('button', { name: '编辑联系人' }))
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(screen.getByRole('button', { name: '编辑联系人' })).toBeInTheDocument()
  expect(parentApi.saveContacts).not.toHaveBeenCalled()
})

it('titles the page with the child name', async () => {
  vi.mocked(parentApi.profile).mockResolvedValue(full())
  open()
  const main = await screen.findByRole('main')
  expect(await within(main).findByRole('heading', { name: '王小一的档案' })).toBeInTheDocument()
})

it('leaves edit mode and writes nothing to the other child when switching mid-edit', async () => {
  vi.mocked(parentApi.children).mockResolvedValue([
    child(),
    child({ student_id: 's2', name: '王小二' }),
  ])
  vi.mocked(parentApi.profile).mockImplementation(async (sid) => ({
    ...full(),
    id: sid,
    name: sid === 's1' ? '王小一' : '王小二',
  }))
  open()
  fireEvent.click(await screen.findByRole('button', { name: '编辑联系人' }))
  fireEvent.change(screen.getByRole('textbox', { name: '联系人1电话' }), {
    target: { value: '13900000000' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: '切换孩子' }), { target: { value: 's2' } })
  expect(await screen.findByRole('heading', { name: '王小二的档案' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '编辑联系人' }))
  expect(screen.getByRole('textbox', { name: '联系人1电话' })).toHaveValue('13800000001')
  expect(parentApi.saveContacts).not.toHaveBeenCalled()
})
