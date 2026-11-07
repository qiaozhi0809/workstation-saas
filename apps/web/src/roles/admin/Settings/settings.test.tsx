import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { schoolApi } from '@/shared/api/school'
import { toast } from '@/shared/components/Toast'
import { downloadBlob } from '@/shared/lib/download'
import { useAuthStore } from '@/shared/stores/auth'
import type { Switches, SystemInfo } from '@/shared/types/admin'
import type { SubjectCatalog } from '@/shared/types/school'
import SettingsPage from './SettingsPage'

vi.mock('@/shared/api/admin', () => ({
  adminApi: {
    saveTagPool: vi.fn(),
    switches: vi.fn(),
    saveSwitches: vi.fn(),
    systemInfo: vi.fn(),
    downloadDiagnostics: vi.fn(),
    securitySettings: vi.fn(),
    saveSecuritySettings: vi.fn(),
  },
}))
vi.mock('@/shared/api/school', () => ({
  schoolApi: {
    tagPool: vi.fn(),
    grading: vi.fn(),
    saveGrading: vi.fn(),
    subjectCatalog: vi.fn(),
    saveSubjectCatalog: vi.fn(),
  },
}))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))
vi.mock('@/shared/lib/download', () => ({ downloadBlob: vi.fn() }))

const CATALOG: SubjectCatalog = {
  primary: [
    { name: '语文', full: 100 },
    { name: '数学', full: 100 },
  ],
  junior: [{ name: '语文', full: 120 }],
  senior: [{ name: '语文', full: 150 }],
}

const SW: Switches = {
  parent_rank: false,
  parent_negative_review: false,
  teacher_review_frequency: false,
  monitor: false,
  parent_monitor: false,
  ai_review_before_send: true,
  star_of_week: true,
  birthdays: true,
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(schoolApi.tagPool).mockResolvedValue({ tags: ['重点关注', '住校', '近视', '偏科'] })
  vi.mocked(adminApi.switches).mockResolvedValue(SW)
  vi.mocked(adminApi.securitySettings).mockResolvedValue({
    totp_allowed: false,
    password_min_length: 8,
    password_max_age_days: 0,
  })
  vi.mocked(schoolApi.grading).mockResolvedValue({ pass_ratio: 0.6, good_ratio: 0.85 })
  vi.mocked(schoolApi.subjectCatalog).mockResolvedValue(CATALOG)
})
afterEach(() => {
  cleanup()
  // asAdmin 写进 store 的权限不能漏到下一个用例:否则系统卡在没 mock systemInfo 的用例里也会去请求
  useAuthStore.setState({ user: null })
})

let client: QueryClient
const renderPage = async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  )
  await screen.findByRole('button', { name: '改名 近视' })
}
const list = () => screen.getByRole('list', { name: '标签池' })
const names = () =>
  within(list())
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('data-tag'))

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
  await waitFor(() =>
    expect(adminApi.saveTagPool).toHaveBeenCalledWith({
      tags: ['重点关注', '住校', '视力', '偏科'],
      renames: [{ from: '近视', to: '视力' }],
    }),
  )
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
  await waitFor(() =>
    expect(adminApi.saveTagPool).toHaveBeenCalledWith({
      tags: ['重点关注', '住校', '视力', '偏科'],
      renames: [],
    }),
  )
})

it('collapses a chain of renames to the original name', async () => {
  vi.mocked(adminApi.saveTagPool).mockResolvedValue({ tags: [] })
  await renderPage()
  for (const [from, to] of [
    ['近视', '视力'],
    ['视力', '眼睛'],
  ]) {
    fireEvent.click(screen.getByRole('button', { name: `改名 ${from}` }))
    const dlg = await screen.findByRole('dialog')
    fireEvent.change(within(dlg).getByLabelText('新名称'), { target: { value: to } })
    fireEvent.click(within(dlg).getByRole('button', { name: '确定' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  }
  fireEvent.click(screen.getByRole('button', { name: '保存标签池' }))
  await waitFor(() =>
    expect(adminApi.saveTagPool).toHaveBeenCalledWith(
      expect.objectContaining({ renames: [{ from: '近视', to: '眼睛' }] }),
    ),
  )
})

it('gives protected tags neither rename nor delete, and explains why', async () => {
  await renderPage()
  for (const t of ['重点关注', '住校']) {
    expect(screen.queryByRole('button', { name: `改名 ${t}` })).toBeNull()
    expect(screen.queryByRole('button', { name: `删除 ${t}` })).toBeNull()
    expect(
      within(list().querySelector(`[data-tag="${t}"]`) as HTMLElement).getByTitle(
        '这个标签有特殊用途',
      ),
    ).toBeInTheDocument()
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
  await waitFor(() =>
    expect(adminApi.saveTagPool).toHaveBeenCalledWith({
      tags: ['重点关注', '住校', '近视'],
      renames: [],
    }),
  )
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
  vi.mocked(adminApi.saveTagPool).mockRejectedValue(
    new ApiError(400, 'TAG_PROTECTED', '受保护的标签不能改名(后端)'),
  )
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
    expect(
      within(region)
        .getAllByRole('switch')
        .map((s) => s.getAttribute('aria-label') ?? s.closest('label')?.textContent),
    ).toEqual(labels)
  }
  expect(screen.getAllByText('家长端下次刷新即生效')).toHaveLength(2)
  expect(screen.getByText('对之后 AI 生成的评语生效')).toBeInTheDocument()
  expect(
    screen.getByText('关掉后摄像头管理与课上画面都不可用,下一次请求即生效'),
  ).toBeInTheDocument()
  expect(screen.getByRole('switch', { name: '家长可看监控' })).toBeDisabled()
  expect(screen.getByText('v1 不开放')).toBeInTheDocument()
})

it('saves the switches and says 已保存', async () => {
  vi.mocked(adminApi.saveSwitches).mockResolvedValue({
    ...SW,
    star_of_week: false,
    parent_rank: true,
  })
  await renderPage()
  const spy = vi.spyOn(client, 'invalidateQueries')
  fireEvent.click(await screen.findByRole('switch', { name: '本周之星' }))
  fireEvent.click(screen.getByRole('switch', { name: '家长可见排名' }))
  fireEvent.click(screen.getByRole('button', { name: '保存开关' }))
  await waitFor(() =>
    expect(adminApi.saveSwitches).toHaveBeenCalledWith({
      ...SW,
      star_of_week: false,
      parent_rank: true,
    }),
  )
  expect(toast).toHaveBeenCalledWith('已保存')
  expect(spy).toHaveBeenCalledWith({ queryKey: ['classroom'] })
})

it('shows the backend message when saving the switches fails', async () => {
  vi.mocked(adminApi.saveSwitches).mockRejectedValue(
    new ApiError(400, 'BAD_REQUEST', '保存开关失败(后端)'),
  )
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
  expect(renames).toEqual(
    expect.arrayContaining([
      { from: '视力', to: '眼睛' },
      { from: '近视', to: '眼睛' },
    ]),
  )
})

it('drops renames that point at a tag deleted afterwards', async () => {
  vi.mocked(adminApi.saveTagPool).mockResolvedValue({ tags: [] })
  await renderPage()
  await rename('近视', '视力')
  fireEvent.click(screen.getByRole('button', { name: '删除 视力' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除' }))
  fireEvent.click(screen.getByRole('button', { name: '保存标签池' }))
  await waitFor(() =>
    expect(adminApi.saveTagPool).toHaveBeenCalledWith({
      tags: ['重点关注', '住校', '偏科'],
      renames: [],
    }),
  )
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

const asAdmin = (perms: string[]) =>
  useAuthStore.setState({ user: { admin_perms: perms } as never })
const INFO: SystemInfo = {
  version: '0.7.0',
  migration: '0010',
  started_at: '2026-11-05T01:00:00Z',
  db_size_bytes: 5 * 1024 * 1024,
  last_backup: { at: new Date().toISOString(), file: 'ws-backup-x.tar.gz', size_bytes: 1024 },
}

it('shows system card for settings.manage', async () => {
  asAdmin(['settings.manage'])
  vi.mocked(adminApi.systemInfo).mockResolvedValue(INFO)
  await renderPage()
  expect(await screen.findByText('0.7.0')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull() // 新备份不警告
  expect(screen.getByText('0010')).toBeInTheDocument()
  expect(screen.getByText('5.0 MB')).toBeInTheDocument()
  expect(screen.getByText('诊断包不含学生、成绩等业务数据,可以发给技术支持')).toBeInTheDocument()
})

it('hides system card without settings.manage', async () => {
  asAdmin(['account.manage'])
  await renderPage()
  expect(screen.queryByText('导出诊断信息')).toBeNull()
  expect(adminApi.systemInfo).not.toHaveBeenCalled()
})

// L184:备份超过 48 小时或从未备份都要醒目告警(定时器失败只进 journal,这里是管理员唯一能看到的地方)
it('alerts loudly when there has never been a backup', async () => {
  asAdmin(['settings.manage'])
  vi.mocked(adminApi.systemInfo).mockResolvedValue({ ...INFO, last_backup: null })
  await renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('从未备份,请检查定时任务')
  expect(alert).toHaveClass('border-destructive')
})

it('alerts when the last backup is older than 48 hours, with the age in days', async () => {
  asAdmin(['settings.manage'])
  const at = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString()
  vi.mocked(adminApi.systemInfo).mockResolvedValue({
    ...INFO,
    last_backup: { at, file: 'f', size_bytes: 1 },
  })
  await renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('上次备份是 5 天前,请检查定时任务')
  expect(alert).toHaveClass('border-destructive')
})

it('does not alert at 30 hours, alerts just past 48 hours', async () => {
  asAdmin(['settings.manage'])
  const ago = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString()
  vi.mocked(adminApi.systemInfo).mockResolvedValue({
    ...INFO,
    last_backup: { at: ago(30), file: 'f', size_bytes: 1 },
  })
  await renderPage()
  await screen.findByText('0.7.0')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByText(/请检查定时任务/)).toBeNull()
  cleanup()
  vi.mocked(adminApi.systemInfo).mockResolvedValue({
    ...INFO,
    last_backup: { at: ago(49), file: 'f', size_bytes: 1 },
  })
  await renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('上次备份是 2 天前,请检查定时任务')
})

// 审查 Minor 5:备份时间解析不了时不能显示"NaN 天前"
it('shows a neutral notice when the last backup time cannot be parsed', async () => {
  asAdmin(['settings.manage'])
  vi.mocked(adminApi.systemInfo).mockResolvedValue({
    ...INFO,
    last_backup: { at: 'not-a-date', file: 'f', size_bytes: 1 },
  })
  await renderPage()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('上次备份时间无法识别,请检查备份记录')
  expect(alert).not.toHaveTextContent('NaN')
})

it('downloads diagnostics through downloadBlob, disabled while running', async () => {
  asAdmin(['settings.manage'])
  vi.mocked(adminApi.systemInfo).mockResolvedValue(INFO)
  let done!: (v: { blob: Blob; filename: string }) => void
  vi.mocked(adminApi.downloadDiagnostics).mockReturnValue(new Promise((r) => (done = r)))
  await renderPage()
  const btn = await screen.findByRole('button', { name: '导出诊断信息' })
  fireEvent.click(btn)
  await waitFor(() => expect(btn).toBeDisabled())
  const blob = new Blob(['z'])
  done({ blob, filename: 'ws-diagnostics-20261105-100000.zip' })
  await waitFor(() =>
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'ws-diagnostics-20261105-100000.zip'),
  )
  await waitFor(() => expect(btn).toBeEnabled())
})

it('toasts when diagnostics export fails', async () => {
  asAdmin(['settings.manage'])
  vi.mocked(adminApi.systemInfo).mockResolvedValue(INFO)
  vi.mocked(adminApi.downloadDiagnostics).mockRejectedValue(
    new ApiError(403, 'forbidden', '没有权限'),
  )
  await renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '导出诊断信息' }))
  await waitFor(() => expect(toast).toHaveBeenCalledWith('没有权限'))
})

it('saves security settings', async () => {
  vi.mocked(adminApi.saveSecuritySettings).mockResolvedValue({
    totp_allowed: true,
    password_min_length: 12,
    password_max_age_days: 90,
  })
  await renderPage()
  const invSpy = vi.spyOn(client, 'invalidateQueries')
  const card = await screen.findByRole('group', { name: '账号安全' })
  expect(within(card).queryByText('已有密码不受影响,下次修改时生效')).toBeNull()
  fireEvent.click(within(card).getByRole('switch', { name: '允许账号开启两步验证' }))
  fireEvent.change(within(card).getByLabelText('密码最短长度'), { target: { value: '12' } })
  expect(within(card).getByText('已有密码不受影响,下次修改时生效')).toBeInTheDocument()
  fireEvent.change(within(card).getByLabelText('密码有效期'), { target: { value: '90' } })
  fireEvent.click(within(card).getByRole('button', { name: '保存安全设置' }))
  await waitFor(() =>
    expect(adminApi.saveSecuritySettings).toHaveBeenCalledWith({
      totp_allowed: true,
      password_min_length: 12,
      password_max_age_days: 90,
    }),
  )
  expect(toast).toHaveBeenCalledWith('已保存')
  expect(invSpy).toHaveBeenCalledWith({ queryKey: ['auth', 'password-policy'] })
  expect(client.getQueryData(['admin', 'security-settings'])).toEqual({
    totp_allowed: true,
    password_min_length: 12,
    password_max_age_days: 90,
  })
})

// ---------- 及格线 ----------
const gradingCard = async () => screen.findByRole('group', { name: '及格线与优秀线' })

it('grading card validates', async () => {
  vi.mocked(schoolApi.saveGrading).mockResolvedValue({ pass_ratio: 0.7, good_ratio: 0.9 })
  await renderPage()
  const card = within(await gradingCard())
  expect(card.getByLabelText('及格线(%)')).toHaveValue(60)
  expect(card.getByLabelText('优秀线(%)')).toHaveValue(85)
  expect(
    card.getByText('按各科满分的比例计算,老师端分析、AI 统计、成绩汇总一起生效'),
  ).toBeInTheDocument()
  const save = card.getByRole('button', { name: '保存及格线' })
  expect(save).toBeDisabled() // 没改过

  // 优秀线不高于及格线
  fireEvent.change(card.getByLabelText('及格线(%)'), { target: { value: '85' } })
  expect(card.getByRole('alert')).toHaveTextContent('优秀线要高于及格线')
  expect(save).toBeDisabled()
  // 越界
  fireEvent.change(card.getByLabelText('及格线(%)'), { target: { value: '20' } })
  expect(card.getByRole('alert')).toHaveTextContent('及格线要在 30%–95% 之间的整数')
  fireEvent.change(card.getByLabelText('及格线(%)'), { target: { value: '70' } })
  fireEvent.change(card.getByLabelText('优秀线(%)'), { target: { value: '101' } })
  expect(card.getByRole('alert')).toHaveTextContent('优秀线要在 40%–100% 之间的整数')
  fireEvent.change(card.getByLabelText('优秀线(%)'), { target: { value: '90.5' } })
  expect(card.getByRole('alert')).toHaveTextContent('优秀线要在 40%–100% 之间的整数')
  expect(save).toBeDisabled()
  expect(schoolApi.saveGrading).not.toHaveBeenCalled()

  // 合法:发两位小数的比例,保存后 PUT 的返回值直接进 ['school','grading'] 缓存
  fireEvent.change(card.getByLabelText('优秀线(%)'), { target: { value: '90' } })
  expect(card.queryByRole('alert')).toBeNull()
  fireEvent.click(save)
  await waitFor(() =>
    expect(schoolApi.saveGrading).toHaveBeenCalledWith({ pass_ratio: 0.7, good_ratio: 0.9 }),
  )
  expect(toast).toHaveBeenCalledWith('已保存')
  expect(client.getQueryData(['school', 'grading'])).toEqual({ pass_ratio: 0.7, good_ratio: 0.9 })
})

// L238:保存后用 PUT 的返回值写缓存即可,不再 invalidate → 不会紧接着多发一次 GET /school/grading
it('save issues no extra GET', async () => {
  vi.mocked(schoolApi.saveGrading).mockResolvedValue({ pass_ratio: 0.7, good_ratio: 0.9 })
  await renderPage()
  const card = within(await gradingCard())
  expect(schoolApi.grading).toHaveBeenCalledTimes(1)
  fireEvent.change(card.getByLabelText('及格线(%)'), { target: { value: '70' } })
  fireEvent.change(card.getByLabelText('优秀线(%)'), { target: { value: '90' } })
  fireEvent.click(card.getByRole('button', { name: '保存及格线' }))
  await waitFor(() => expect(toast).toHaveBeenCalledWith('已保存'))
  await waitFor(() => expect(card.getByRole('button', { name: '保存及格线' })).toBeDisabled())
  expect(client.getQueryData(['school', 'grading'])).toEqual({ pass_ratio: 0.7, good_ratio: 0.9 })
  expect(client.getQueryState(['school', 'grading'])?.isInvalidated).toBe(false)
  expect(schoolApi.grading).toHaveBeenCalledTimes(1)
  expect(card.getByLabelText('及格线(%)')).toHaveValue(70)
  expect(card.getByLabelText('优秀线(%)')).toHaveValue(90)
})

it('shows the backend message when saving the grading fails', async () => {
  vi.mocked(schoolApi.saveGrading).mockRejectedValue(
    new ApiError(400, 'BAD_REQUEST', '优秀比例必须大于及格比例(后端)'),
  )
  await renderPage()
  const card = within(await gradingCard())
  fireEvent.change(card.getByLabelText('及格线(%)'), { target: { value: '70' } })
  fireEvent.click(card.getByRole('button', { name: '保存及格线' }))
  expect(await card.findByText('优秀比例必须大于及格比例(后端)')).toBeInTheDocument()
})

// ---------- 科目目录 ----------
const catalogCard = async () => screen.findByRole('group', { name: '科目目录' })
const subjectNames = (card: ReturnType<typeof within>) =>
  card
    .queryAllByRole('listitem')
    .map((li: HTMLElement) => li.getAttribute('data-subject'))
    .filter((s: string | null): s is string => s !== null)

it('catalog card edits stage list', async () => {
  vi.mocked(schoolApi.saveSubjectCatalog).mockImplementation(async (c) => c)
  await renderPage()
  const card = within(await catalogCard())
  expect(card.getByText('只影响之后新建的班级和联考可选科目')).toBeInTheDocument()
  expect(card.getByRole('tab', { name: '小学' })).toHaveAttribute('aria-selected', 'true')
  expect(subjectNames(card)).toEqual(['语文', '数学'])
  expect(card.getByLabelText('数学 满分')).toHaveValue(100)
  const save = card.getByRole('button', { name: '保存科目目录' })
  expect(save).toBeDisabled()

  // 小学:加"科学"、上移、改满分、删"语文"
  fireEvent.change(card.getByLabelText('新科目名称'), { target: { value: ' 科学 ' } })
  fireEvent.change(card.getByLabelText('新科目满分'), { target: { value: '80' } })
  fireEvent.click(card.getByRole('button', { name: '添加科目' }))
  expect(subjectNames(card)).toEqual(['语文', '数学', '科学'])
  expect(card.getByLabelText('科学 满分')).toHaveValue(80)
  fireEvent.click(card.getByRole('button', { name: '上移 科学' }))
  expect(subjectNames(card)).toEqual(['语文', '科学', '数学'])
  expect(card.getByRole('button', { name: '上移 语文' })).toBeDisabled()
  expect(card.getByRole('button', { name: '下移 数学' })).toBeDisabled()
  fireEvent.change(card.getByLabelText('数学 满分'), { target: { value: '120' } })
  fireEvent.click(card.getByRole('button', { name: '删除 语文' }))
  expect(subjectNames(card)).toEqual(['科学', '数学'])
  // 重名与空名
  fireEvent.change(card.getByLabelText('新科目名称'), { target: { value: '数学' } })
  fireEvent.click(card.getByRole('button', { name: '添加科目' }))
  expect(card.getByText('这个学段已经有这门科目')).toBeInTheDocument()
  expect(subjectNames(card)).toHaveLength(2)

  // 切到初中:列表独立;删到空不能保存
  fireEvent.click(card.getByRole('tab', { name: '初中' }))
  expect(subjectNames(card)).toEqual(['语文'])
  expect(card.getByLabelText('语文 满分')).toHaveValue(120)
  fireEvent.click(card.getByRole('button', { name: '删除 语文' }))
  expect(subjectNames(card)).toEqual([])
  fireEvent.click(save)
  expect(card.getByRole('alert')).toHaveTextContent('初中至少要有 1 门科目')
  expect(schoolApi.saveSubjectCatalog).not.toHaveBeenCalled()
  fireEvent.change(card.getByLabelText('新科目名称'), { target: { value: '物理' } })
  fireEvent.click(card.getByRole('button', { name: '添加科目' }))
  expect(card.getByLabelText('物理 满分')).toHaveValue(100)

  // 保存:三个学段一起发,保存后失效 ['school','subject-catalog']
  const invSpy = vi.spyOn(client, 'invalidateQueries')
  fireEvent.click(save)
  await waitFor(() =>
    expect(schoolApi.saveSubjectCatalog).toHaveBeenCalledWith({
      primary: [
        { name: '科学', full: 80 },
        { name: '数学', full: 120 },
      ],
      junior: [{ name: '物理', full: 100 }],
      senior: [{ name: '语文', full: 150 }],
    }),
  )
  expect(toast).toHaveBeenCalledWith('已保存')
  expect(invSpy).toHaveBeenCalledWith({ queryKey: ['school', 'subject-catalog'] })
  await waitFor(() => expect(save).toBeDisabled())
})

it('rejects a bad full mark in the catalog before saving', async () => {
  await renderPage()
  const card = within(await catalogCard())
  fireEvent.change(card.getByLabelText('数学 满分'), { target: { value: '0' } })
  fireEvent.click(card.getByRole('button', { name: '保存科目目录' }))
  expect(card.getByRole('alert')).toHaveTextContent('小学「数学」的满分须为 1–1000 的整数')
  expect(schoolApi.saveSubjectCatalog).not.toHaveBeenCalled()
  fireEvent.change(card.getByLabelText('新科目名称'), {
    target: { value: '很长很长很长很长很长的名' },
  })
  fireEvent.click(card.getByRole('button', { name: '添加科目' }))
  expect(card.getByText('科目名要在 1–10 个字')).toBeInTheDocument()
})

it('shows the backend message when saving the catalog fails', async () => {
  vi.mocked(schoolApi.saveSubjectCatalog).mockRejectedValue(
    new ApiError(400, 'BAD_REQUEST', '科目名重复(后端)'),
  )
  await renderPage()
  const card = within(await catalogCard())
  fireEvent.click(card.getByRole('button', { name: '删除 数学' }))
  fireEvent.click(card.getByRole('button', { name: '保存科目目录' }))
  expect(await card.findByText('科目名重复(后端)')).toBeInTheDocument()
})
