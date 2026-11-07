import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { camerasApi } from '@/shared/api/cameras'
import { ApiError } from '@/shared/api/client'
import { toast } from '@/shared/components/Toast'
import { useAuthStore } from '@/shared/stores/auth'
import type { AdminPerm, ClassAdmin, Switches } from '@/shared/types/admin'
import type { CameraOut, CameraTestResult, StreamProbe } from '@/shared/types/camera'
import AdminNav from '../AdminNav'
import { ADMIN_PAGES } from '../pages'
import CamerasPage from './CamerasPage'

vi.mock('@/shared/api/admin', () => ({ adminApi: { switches: vi.fn(), classes: vi.fn() } }))
vi.mock('@/shared/api/cameras', () => ({
  camerasApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    test: vi.fn(),
    health: vi.fn(),
  },
}))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))

const cam = (over: Partial<CameraOut> = {}): CameraOut => ({
  id: 'cam1',
  name: '三年二班教室',
  class_id: 'c1',
  class_name: '三年二班',
  location: '教室',
  enabled: true,
  transcode: false,
  rtsp_url: 'rtsp://192.168.1.10:554/stream1',
  has_credentials: true,
  status: 'idle',
  last_error: null,
  ...over,
})
const HALL = cam({
  id: 'cam2',
  name: '一楼走廊',
  class_id: null,
  class_name: null,
  location: '走廊',
  has_credentials: false,
  status: 'error',
  last_error: '连接超时',
  rtsp_url: 'rtsp://192.168.1.11/live',
})
const SW: Switches = {
  parent_rank: false,
  parent_negative_review: false,
  teacher_review_frequency: false,
  monitor: true,
  parent_monitor: false,
  ai_review_before_send: true,
  star_of_week: true,
  birthdays: true,
}
const CLS: ClassAdmin = {
  id: 'c1',
  name: '三年二班',
  grade_id: 'g3',
  grade_name: '三年级',
  room: '301',
  student_count: 40,
  homeroom: null,
  assistants: [],
  subjects: [],
  desk_size: 2,
  seat_layout: 'auto',
  seat_rows: 6,
  seat_cols: 4,
  podium_left: 0,
  podium_right: 0,
}
const probe = (over: Partial<StreamProbe> = {}): StreamProbe => ({
  video_codec: 'h264',
  width: 1920,
  height: 1080,
  fps: 25,
  bitrate_kbps: 2048,
  audio_codec: null,
  browser_playable: true,
  hint: null,
  ...over,
})
const ok = (over: Partial<CameraTestResult> = {}): CameraTestResult => ({
  ok: true,
  message: '连接成功',
  preview_jpeg_base64: null,
  probe: null,
  ...over,
})

let client: QueryClient
const renderPage = () =>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/cameras']}>
        <CamerasPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
const row = (name: RegExp) => screen.getByRole('row', { name })

beforeEach(() => {
  vi.resetAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.mocked(adminApi.switches).mockResolvedValue(SW)
  vi.mocked(adminApi.classes).mockResolvedValue([CLS])
  vi.mocked(camerasApi.list).mockResolvedValue([cam(), HALL])
  vi.mocked(camerasApi.health).mockResolvedValue({ public_hosts: [] })
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().logout()
})

it('lists cameras with class, location, status and enabled switch', async () => {
  renderPage()
  expect(await screen.findByText('一楼走廊')).toBeInTheDocument()
  expect(screen.getByTestId('cameras-page')).toBeInTheDocument()
  expect(screen.getByTestId('camera-list')).toBeInTheDocument()
  const r1 = row(/三年二班教室/)
  expect(r1).toHaveTextContent('三年二班')
  expect(r1).toHaveTextContent('教室')
  expect(r1).toHaveTextContent('空闲')
  expect(within(r1).getByRole('switch', { name: '启用 三年二班教室' })).toBeChecked()
  const r2 = row(/一楼走廊/)
  expect(r2).toHaveTextContent('公共区域')
  expect(r2).toHaveTextContent('异常')
  expect(r2).toHaveTextContent('连接超时')
  expect(screen.queryByTestId('camera-public-host-warning')).toBeNull()
  expect(screen.queryByTestId('camera-monitor-off-notice')).toBeNull()
})

it('password blank keeps existing', async () => {
  vi.mocked(camerasApi.update).mockResolvedValue(cam({ name: '三年二班后门' }))
  renderPage()
  await screen.findByText('一楼走廊')
  fireEvent.click(within(row(/三年二班教室/)).getByRole('button', { name: '编辑' }))
  const dlg = await screen.findByRole('dialog', { name: '编辑摄像头' })
  expect(within(dlg).getByLabelText('密码')).toHaveValue('')
  expect(within(dlg).getByLabelText('密码')).toHaveAttribute('placeholder', '留空表示不修改')
  expect(dlg).toHaveTextContent('已保存用户名和密码')
  fireEvent.change(within(dlg).getByLabelText('名称'), { target: { value: '三年二班后门' } })
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  await waitFor(() => expect(camerasApi.update).toHaveBeenCalledTimes(1))
  const [id, body] = vi.mocked(camerasApi.update).mock.calls[0]
  expect(id).toBe('cam1')
  expect(body).toEqual({
    name: '三年二班后门',
    class_id: 'c1',
    location: '教室',
    rtsp_url: 'rtsp://192.168.1.10:554/stream1',
    enabled: true,
    transcode: false,
  })
  expect('username' in body).toBe(false)
  expect('password' in body).toBe(false)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(toast).toHaveBeenCalledWith('已保存三年二班后门')
})

it('clears credentials explicitly and sends a typed password', async () => {
  vi.mocked(camerasApi.update).mockResolvedValue(cam())
  renderPage()
  await screen.findByText('一楼走廊')
  fireEvent.click(within(row(/三年二班教室/)).getByRole('button', { name: '编辑' }))
  const dlg = await screen.findByRole('dialog', { name: '编辑摄像头' })
  fireEvent.click(within(dlg).getByRole('button', { name: '清除凭据' }))
  expect(dlg).toHaveTextContent('保存后将清除已保存的用户名和密码')
  expect(within(dlg).getByLabelText('密码')).toBeDisabled()
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(camerasApi.update).toHaveBeenLastCalledWith(
      'cam1',
      expect.objectContaining({ username: null, password: null }),
    ),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  fireEvent.click(within(row(/三年二班教室/)).getByRole('button', { name: '编辑' }))
  const again = await screen.findByRole('dialog', { name: '编辑摄像头' })
  fireEvent.change(within(again).getByLabelText('用户名'), { target: { value: 'admin' } })
  fireEvent.change(within(again).getByLabelText('密码'), { target: { value: 'S3cret!!' } })
  fireEvent.click(within(again).getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(camerasApi.update).toHaveBeenLastCalledWith(
      'cam1',
      expect.objectContaining({ username: 'admin', password: 'S3cret!!' }),
    ),
  )
})

it('creates a camera, checks the rtsp prefix locally and shows backend url errors under the field', async () => {
  vi.mocked(camerasApi.create)
    .mockRejectedValueOnce(
      new ApiError(400, 'RTSP_URL_NOT_LAN', '摄像头地址不在校园内网(203.0.113.7)'),
    )
    .mockResolvedValueOnce(cam({ id: 'cam3', name: '操场东', has_credentials: false }))
  renderPage()
  await screen.findByText('一楼走廊')
  fireEvent.click(screen.getByRole('button', { name: '新建摄像头' }))
  const dlg = await screen.findByRole('dialog', { name: '新建摄像头' })
  expect(within(dlg).getByTestId('camera-form')).toBeInTheDocument()
  fireEvent.change(within(dlg).getByLabelText('名称'), { target: { value: ' 操场东 ' } })
  fireEvent.change(within(dlg).getByLabelText('位置'), { target: { value: '操场' } })
  fireEvent.change(within(dlg).getByLabelText('RTSP 地址'), { target: { value: 'http://x' } })
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  expect(await within(dlg).findByText('地址需要以 rtsp:// 开头')).toBeInTheDocument()
  expect(camerasApi.create).not.toHaveBeenCalled()

  fireEvent.change(within(dlg).getByLabelText('RTSP 地址'), {
    target: { value: 'rtsp://203.0.113.7/live' },
  })
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  expect(await within(dlg).findByText('摄像头地址不在校园内网(203.0.113.7)')).toBeInTheDocument()
  expect(camerasApi.create).toHaveBeenCalledWith({
    name: '操场东',
    class_id: null,
    location: '操场',
    rtsp_url: 'rtsp://203.0.113.7/live',
    enabled: true,
    transcode: false,
  })

  fireEvent.change(within(dlg).getByLabelText('RTSP 地址'), {
    target: { value: 'rtsp://192.168.1.20/live' },
  })
  fireEvent.click(within(dlg).getByLabelText('转码(摄像头不是 H.264 时勾选,更占 CPU)'))
  fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(camerasApi.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ rtsp_url: 'rtsp://192.168.1.20/live', transcode: true }),
    ),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(toast).toHaveBeenCalledWith('已添加操场东')
})

it('shows public host warning', async () => {
  vi.mocked(camerasApi.health).mockResolvedValue({
    public_hosts: ['203.0.113.7', 'cam.example.com'],
  })
  renderPage()
  const warn = await screen.findByTestId('camera-public-host-warning')
  expect(warn).toHaveAttribute('role', 'alert')
  expect(warn).toHaveTextContent('以下摄像头地址不在校园内网,已拒绝拉流')
  expect(warn).toHaveTextContent('203.0.113.7')
  expect(warn).toHaveTextContent('cam.example.com')
})

// L215 ③:health(内网地址检查)失败不再静默:页顶 role=alert 并可重试,重试成功后恢复正常提示
it('health failure visible', async () => {
  vi.mocked(camerasApi.health)
    .mockRejectedValueOnce(new ApiError(500, 'X', '检查失败(后端)'))
    .mockResolvedValueOnce({ public_hosts: ['203.0.113.7'] })
  renderPage()
  await screen.findByText('一楼走廊')
  const alert = await screen.findByTestId('camera-health-error')
  expect(alert).toHaveAttribute('role', 'alert')
  expect(alert).toHaveTextContent('摄像头地址检查失败')
  expect(screen.queryByTestId('camera-public-host-warning')).toBeNull()
  fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
  expect(await screen.findByTestId('camera-public-host-warning')).toHaveTextContent('203.0.113.7')
  expect(screen.queryByTestId('camera-health-error')).toBeNull()
  expect(camerasApi.health).toHaveBeenCalledTimes(2)
})

it('tells when the monitor switch is off and links to settings', async () => {
  vi.mocked(adminApi.switches).mockResolvedValue({ ...SW, monitor: false })
  renderPage()
  const notice = await screen.findByTestId('camera-monitor-off-notice')
  expect(notice).toHaveTextContent('学校设置里的"监控"开关是关的,老师和校领导看不到画面')
  expect(within(notice).getByRole('link', { name: '去学校设置打开' })).toHaveAttribute(
    'href',
    '/admin/settings',
  )
  // 开关关着时后端对摄像头接口一律 404,不去拉列表
  expect(camerasApi.list).not.toHaveBeenCalled()
  expect(screen.queryByRole('status', { name: '加载中…' })).toBeNull()
})

it('test dialog shows preview', async () => {
  vi.mocked(camerasApi.test).mockResolvedValue(ok({ preview_jpeg_base64: '/9j/4AAQSkZJRg==' }))
  renderPage()
  await screen.findByText('一楼走廊')
  fireEvent.click(within(row(/三年二班教室/)).getByRole('button', { name: '测试连接' }))
  const dlg = await screen.findByTestId('camera-test-dialog')
  await waitFor(() => expect(camerasApi.test).toHaveBeenCalledWith('cam1'))
  const img = await within(dlg).findByRole('img', { name: '摄像头预览' })
  expect(img).toHaveAttribute('src', 'data:image/jpeg;base64,/9j/4AAQSkZJRg==')
  expect(dlg).toHaveTextContent('连接成功')
  expect(within(dlg).queryByRole('alert')).toBeNull()
})

it('test dialog shows the failure message and can retry', async () => {
  vi.mocked(camerasApi.test)
    .mockResolvedValueOnce(ok({ ok: false, message: '连接超时,请检查地址和网络' }))
    .mockResolvedValueOnce(ok())
  renderPage()
  await screen.findByText('一楼走廊')
  fireEvent.click(within(row(/一楼走廊/)).getByRole('button', { name: '测试连接' }))
  const dlg = await screen.findByTestId('camera-test-dialog')
  expect(await within(dlg).findByRole('alert')).toHaveTextContent('连接超时,请检查地址和网络')
  fireEvent.click(within(dlg).getByRole('button', { name: '重试' }))
  await waitFor(() => expect(camerasApi.test).toHaveBeenCalledTimes(2))
  expect(await within(dlg).findByText('连接成功')).toBeInTheDocument()
})

it('shows codec hint', async () => {
  vi.mocked(camerasApi.test).mockResolvedValue(
    ok({
      probe: probe({
        video_codec: 'hevc',
        width: 2560,
        height: 1440,
        fps: 20,
        browser_playable: false,
        hint: '这路是 H.265(HEVC),浏览器放不出来;请在摄像头里改成 H.264,或勾选"转码"',
      }),
    }),
  )
  renderPage()
  await screen.findByText('一楼走廊')
  fireEvent.click(within(row(/三年二班教室/)).getByRole('button', { name: '测试连接' }))
  const dlg = await screen.findByTestId('camera-test-dialog')
  expect(await within(dlg).findByText('编码 H.265(HEVC) · 2560×1440 · 20 fps')).toBeInTheDocument()
  const warn = within(dlg).getByRole('alert')
  expect(warn).toHaveTextContent('测试成功,但浏览器放不出这路画面')
  expect(warn).toHaveTextContent(
    '这路是 H.265(HEVC),浏览器放不出来;请在摄像头里改成 H.264,或勾选"转码"',
  )
})

it('does not re-run the test when the cameras cache is invalidated', async () => {
  vi.mocked(camerasApi.test).mockResolvedValue(ok())
  renderPage()
  await screen.findByText('一楼走廊')
  fireEvent.click(within(row(/三年二班教室/)).getByRole('button', { name: '测试连接' }))
  const dlg = await screen.findByTestId('camera-test-dialog')
  expect(await within(dlg).findByText('连接成功')).toBeInTheDocument()
  expect(camerasApi.test).toHaveBeenCalledTimes(1)
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['cameras'] })
  })
  await waitFor(() => expect(camerasApi.list).toHaveBeenCalledTimes(2))
  expect(camerasApi.test).toHaveBeenCalledTimes(1)
  expect(within(dlg).getByText('连接成功')).toBeInTheDocument()
})

it('shows only the hint, not "测试成功", when the test failed but a probe came back', async () => {
  vi.mocked(camerasApi.test).mockResolvedValue(
    ok({
      ok: false,
      message: '拉流中断',
      probe: probe({ video_codec: 'hevc', browser_playable: false, hint: '编码是 H.265' }),
    }),
  )
  renderPage()
  await screen.findByText('一楼走廊')
  fireEvent.click(within(row(/三年二班教室/)).getByRole('button', { name: '测试连接' }))
  const dlg = await screen.findByTestId('camera-test-dialog')
  expect(await within(dlg).findByText('编码是 H.265')).toBeInTheDocument()
  expect(dlg).toHaveTextContent('拉流中断')
  expect(dlg).not.toHaveTextContent('测试成功')
})

it('shows the probe line without a warning when the stream is playable', async () => {
  vi.mocked(camerasApi.test).mockResolvedValue(ok({ probe: probe({ fps: null }) }))
  renderPage()
  await screen.findByText('一楼走廊')
  fireEvent.click(within(row(/三年二班教室/)).getByRole('button', { name: '测试连接' }))
  const dlg = await screen.findByTestId('camera-test-dialog')
  expect(await within(dlg).findByText('编码 H.264 · 1920×1080')).toBeInTheDocument()
  expect(within(dlg).queryByRole('alert')).toBeNull()
})

it('toggles enabled from the list without touching credentials', async () => {
  vi.mocked(camerasApi.update).mockResolvedValue(cam({ enabled: false }))
  renderPage()
  await screen.findByText('一楼走廊')
  fireEvent.click(screen.getByRole('switch', { name: '启用 三年二班教室' }))
  await waitFor(() => expect(camerasApi.update).toHaveBeenCalledTimes(1))
  const [id, body] = vi.mocked(camerasApi.update).mock.calls[0]
  expect(id).toBe('cam1')
  expect(body).toEqual({
    name: '三年二班教室',
    class_id: 'c1',
    location: '教室',
    rtsp_url: 'rtsp://192.168.1.10:554/stream1',
    enabled: false,
    transcode: false,
  })
  expect('password' in body).toBe(false)
  expect(toast).toHaveBeenCalledWith('已停用三年二班教室')
})

it('deletes after confirmation', async () => {
  vi.mocked(camerasApi.remove).mockResolvedValue(undefined)
  renderPage()
  await screen.findByText('一楼走廊')
  fireEvent.click(within(row(/一楼走廊/)).getByRole('button', { name: '删除' }))
  const dlg = await screen.findByRole('dialog', { name: '删除摄像头' })
  expect(dlg).toHaveTextContent('删除后 一楼走廊 的画面立即不可看')
  expect(camerasApi.remove).not.toHaveBeenCalled()
  fireEvent.click(within(dlg).getByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(camerasApi.remove).toHaveBeenCalledWith('cam2'))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(toast).toHaveBeenCalledWith('已删除一楼走廊')
})

const setPerms = (admin_perms: AdminPerm[]) =>
  useAuthStore.setState({
    accessToken: 'a',
    refreshToken: 'r',
    user: {
      id: 'u',
      display_name: '张主任',
      contexts: ['admin'],
      admin_perms,
      must_change_password: false,
      password_change_reason: null,
    },
  })

it('hidden without camera.manage', () => {
  const page = ADMIN_PAGES.find((p) => p.path === 'cameras')
  expect(page?.perm).toBe('camera.manage')
  expect(page?.group).toBe('system')
  setPerms(['org.manage', 'settings.manage'])
  const { unmount } = render(
    <MemoryRouter initialEntries={['/admin/org']}>
      <AdminNav />
    </MemoryRouter>,
  )
  const nav = screen.getByRole('navigation', { name: '主导航' })
  expect(within(nav).queryByRole('link', { name: '摄像头' })).toBeNull()
  expect(within(nav).queryByRole('button', { name: '系统' })).toBeNull()
  unmount()

  setPerms(['org.manage', 'camera.manage'])
  render(
    <MemoryRouter initialEntries={['/admin/org']}>
      <AdminNav />
    </MemoryRouter>,
  )
  expect(screen.getByRole('link', { name: '摄像头' })).toHaveAttribute('href', '/admin/cameras')
})
