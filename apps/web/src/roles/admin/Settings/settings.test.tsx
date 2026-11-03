import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { schoolApi } from '@/shared/api/school'
import { toast } from '@/shared/components/Toast'
import type { Switches } from '@/shared/types/admin'
import SettingsPage from './SettingsPage'

vi.mock('@/shared/api/admin', () => ({ adminApi: { saveTagPool: vi.fn(), switches: vi.fn(), saveSwitches: vi.fn() } }))
vi.mock('@/shared/api/school', () => ({ schoolApi: { tagPool: vi.fn() } }))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))

const SW: Switches = {
  parent_rank: false, parent_negative_review: false, teacher_review_frequency: false,
  monitor: false, parent_monitor: false, ai_review_before_send: true, star_of_week: true, birthdays: true,
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(schoolApi.tagPool).mockResolvedValue({ tags: ['重点关注', '住校', '近视', '偏科'] })
  vi.mocked(adminApi.switches).mockResolvedValue(SW)
})
afterEach(cleanup)

let client: QueryClient
const renderPage = async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><SettingsPage /></QueryClientProvider>)
  await screen.findByRole('button', { name: '改名 近视' })
}
const list = () => screen.getByRole('list', { name: '标签池' })
const names = () => within(list()).getAllByRole('listitem').map((li) => li.getAttribute('data-tag'))

it('renames a tag including existing students by default and submits the rename', async () => {
  vi.mocked(adminApi.saveTagPool).mockResolvedValue({ tags: ['重点关注', '住校', '视力', '偏科'] })
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: '改名 近视' }))
  const dlg = await screen.findByRole('dialog')
  expect(within(dlg).getByLabelText('同时修改已有学生的这个标签')).toBeChecked()
  fireEvent.change(within(dlg).getByLabelText('新名称'), { target: { value: ' 视力 ' } })
  fireEvent.click(within(dlg).getByRole('button', { name: '确定' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(names()).toEqual(['重点关注', '住校', '视力', '偏科'])
  fireEvent.click(screen.getByRole('button', { name: '保存标签池' }))
  await waitFor(() => expect(adminApi.saveTagPool).toHaveBeenCalledWith({
    tags: ['重点关注', '住校', '视力', '偏科'], renames: [{ from: '近视', to: '视力' }],
  }))
  expect(toast).toHaveBeenCalledWith('已保存')
})

it('does not send a rename when the students checkbox is cleared', async () => {
  vi.mocked(adminApi.saveTagPool).mockResolvedValue({ tags: [] })
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: '改名 近视' }))
  const dlg = await screen.findByRole('dialog')
  fireEvent.click(within(dlg).getByLabelText('同时修改已有学生的这个标签'))
  fireEvent.change(within(dlg).getByLabelText('新名称'), { target: { value: '视力' } })
  fireEvent.click(within(dlg).getByRole('button', { name: '确定' }))
  fireEvent.click(screen.getByRole('button', { name: '保存标签池' }))
  await waitFor(() => expect(adminApi.saveTagPool).toHaveBeenCalledWith({ tags: ['重点关注', '住校', '视力', '偏科'], renames: [] }))
})

it('collapses a chain of renames to the original name', async () => {
  vi.mocked(adminApi.saveTagPool).mockResolvedValue({ tags: [] })
  await renderPage()
  for (const [from, to] of [['近视', '视力'], ['视力', '眼睛']]) {
    fireEvent.click(screen.getByRole('button', { name: `改名 ${from}` }))
    const dlg = await screen.findByRole('dialog')
    fireEvent.change(within(dlg).getByLabelText('新名称'), { target: { value: to } })
    fireEvent.click(within(dlg).getByRole('button', { name: '确定' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  }
  fireEvent.click(screen.getByRole('button', { name: '保存标签池' }))
  await waitFor(() => expect(adminApi.saveTagPool).toHaveBeenCalledWith(expect.objectContaining({ renames: [{ from: '近视', to: '眼睛' }] })))
})

it('gives protected tags neither rename nor delete, and explains why', async () => {
  await renderPage()
  for (const t of ['重点关注', '住校']) {
    expect(screen.queryByRole('button', { name: `改名 ${t}` })).toBeNull()
    expect(screen.queryByRole('button', { name: `删除 ${t}` })).toBeNull()
    expect(within(list().querySelector(`[data-tag="${t}"]`) as HTMLElement).getByTitle('这个标签有特殊用途')).toBeInTheDocument()
  }
  expect(screen.getByRole('button', { name: '删除 近视' })).toBeInTheDocument()
})

it('deletes a tag after telling that students keep it', async () => {
  vi.mocked(adminApi.saveTagPool).mockResolvedValue({ tags: [] })
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: '删除 偏科' }))
  const dlg = await screen.findByRole('dialog')
  expect(dlg).toHaveTextContent('已有学生身上的这个标签会保留')
  fireEvent.click(within(dlg).getByRole('button', { name: '删除' }))
  await waitFor(() => expect(names()).toEqual(['重点关注', '住校', '近视']))
  fireEvent.click(screen.getByRole('button', { name: '保存标签池' }))
  await waitFor(() => expect(adminApi.saveTagPool).toHaveBeenCalledWith({ tags: ['重点关注', '住校', '近视'], renames: [] }))
})

it('adds and reorders tags', async () => {
  vi.mocked(adminApi.saveTagPool).mockResolvedValue({ tags: [] })
  await renderPage()
  fireEvent.change(screen.getByLabelText('新标签'), { target: { value: '过敏' } })
  fireEvent.click(screen.getByRole('button', { name: '添加' }))
  expect(names()).toEqual(['重点关注', '住校', '近视', '偏科', '过敏'])
  fireEvent.click(screen.getByRole('button', { name: '上移 过敏' }))
  expect(names()).toEqual(['重点关注', '住校', '近视', '过敏', '偏科'])
  fireEvent.click(screen.getByRole('button', { name: '下移 重点关注' }))
  expect(names()).toEqual(['住校', '重点关注', '近视', '过敏', '偏科'])
  expect(screen.getByRole('button', { name: '上移 住校' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('新标签'), { target: { value: '近视' } })
  fireEvent.click(screen.getByRole('button', { name: '添加' }))
  expect(screen.getByText('池里已经有这个标签')).toBeInTheDocument()
  expect(names()).toHaveLength(5)
})

it('shows the backend message when saving the pool fails', async () => {
  vi.mocked(adminApi.saveTagPool).mockRejectedValue(new ApiError(400, 'TAG_PROTECTED', '受保护的标签不能改名(后端)'))
  await renderPage()
  fireEvent.click(screen.getByRole('button', { name: '删除 偏科' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除' }))
  fireEvent.click(screen.getByRole('button', { name: '保存标签池' }))
  expect(await screen.findByText('受保护的标签不能改名(后端)')).toBeInTheDocument()
})

it('lays out the eight switches in three groups with their notes', async () => {
  await renderPage()
  const groups: Record<string, string[]> = {
    教室: ['本周之星', '本月寿星', '教师可见互相的点评频率'],
    家长端: ['家长可见排名', '家长收到负向点评', 'AI 内容需审核后下发'],
    监控: ['监控模块总开关', '家长可看监控'],
  }
  for (const [g, labels] of Object.entries(groups)) {
    const region = await screen.findByRole('group', { name: g })
    expect(within(region).getAllByRole('switch').map((s) => s.getAttribute('aria-label') ?? s.closest('label')?.textContent)).toEqual(labels)
  }
  expect(screen.getAllByText('家长端上线后生效')).toHaveLength(3)
  expect(screen.getAllByText('监控上线后生效')).toHaveLength(1)
  expect(screen.getByRole('switch', { name: '家长可看监控' })).toBeDisabled()
  expect(screen.getByText('v1 不开放')).toBeInTheDocument()
})

it('saves the switches and says 已保存', async () => {
  vi.mocked(adminApi.saveSwitches).mockResolvedValue({ ...SW, star_of_week: false, parent_rank: true })
  await renderPage()
  fireEvent.click(await screen.findByRole('switch', { name: '本周之星' }))
  fireEvent.click(screen.getByRole('switch', { name: '家长可见排名' }))
  fireEvent.click(screen.getByRole('button', { name: '保存开关' }))
  await waitFor(() => expect(adminApi.saveSwitches).toHaveBeenCalledWith({ ...SW, star_of_week: false, parent_rank: true }))
  expect(toast).toHaveBeenCalledWith('已保存')
})

it('shows the backend message when saving the switches fails', async () => {
  vi.mocked(adminApi.saveSwitches).mockRejectedValue(new ApiError(400, 'BAD_REQUEST', '保存开关失败(后端)'))
  await renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '保存开关' }))
  expect(await screen.findByText('保存开关失败(后端)')).toBeInTheDocument()
})

const rename = async (from: string, to: string) => {
  fireEvent.click(screen.getByRole('button', { name: `改名 ${from}` }))
  const dlg = await screen.findByRole('dialog')
  fireEvent.change(within(dlg).getByLabelText('新名称'), { target: { value: to } })
  fireEvent.click(within(dlg).getByRole('button', { name: '确定' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}

it('keeps both renames when a merged tag is renamed again', async () => {
  vi.mocked(schoolApi.tagPool).mockResolvedValue({ tags: ['重点关注', '住校', '近视', '视力'] })
  vi.mocked(adminApi.saveTagPool).mockResolvedValue({ tags: [] })
  await renderPage()
  await rename('视力', '近视') // 视力 合并进 近视
  await rename('近视', '眼睛')
  fireEvent.click(screen.getByRole('button', { name: '保存标签池' }))
  await waitFor(() => expect(adminApi.saveTagPool).toHaveBeenCalled())
  const { tags, renames } = vi.mocked(adminApi.saveTagPool).mock.calls[0][0]
  expect(tags).toEqual(['重点关注', '住校', '眼睛'])
  expect(renames).toHaveLength(2)
  expect(renames).toEqual(expect.arrayContaining([{ from: '视力', to: '眼睛' }, { from: '近视', to: '眼睛' }]))
})

it('drops renames that point at a tag deleted afterwards', async () => {
  vi.mocked(adminApi.saveTagPool).mockResolvedValue({ tags: [] })
  await renderPage()
  await rename('近视', '视力')
  fireEvent.click(screen.getByRole('button', { name: '删除 视力' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除' }))
  fireEvent.click(screen.getByRole('button', { name: '保存标签池' }))
  await waitFor(() => expect(adminApi.saveTagPool).toHaveBeenCalledWith({ tags: ['重点关注', '住校', '偏科'], renames: [] }))
})

it('invalidates student caches after saving the pool', async () => {
  vi.mocked(adminApi.saveTagPool).mockResolvedValue({ tags: ['重点关注', '住校'] })
  await renderPage()
  const spy = vi.spyOn(client, 'invalidateQueries')
  fireEvent.click(screen.getByRole('button', { name: '删除 偏科' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除' }))
  fireEvent.click(screen.getByRole('button', { name: '保存标签池' }))
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['student-records'] }))
  expect(spy).toHaveBeenCalledWith({ queryKey: ['class-students'] })
})
