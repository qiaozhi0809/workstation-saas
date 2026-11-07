import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import {
  adminGet,
  createCamera,
  deleteCamera,
  deleteE2eCameras,
  getSwitches,
  login,
  putPeriods,
  putSwitches,
  putTimetable,
  schoolClock,
  testCamera,
  timetableCellsToInput,
  type CameraRecord,
  type ClassTimetableOut,
  type PeriodInput,
} from './helpers/api'

const API = '/api/v1'
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
// 三年二班(dev_seed.sql):班主任 teacher01 张老师、副班主任 teacher02 王老师、数学任课 teacher03 赵老师
const CLASS_3_2 = '44444444-4444-4444-4444-444444444444'
const CLASS_3_1 = '44444444-4444-4444-4444-444444444441' // 三年一班:九宫格 / 轮播用例的第二个班
const LI_PARENT = '13800000061' // 李家长:王小一(三年二班)的主家长,只有家长身份
// 假摄像头(deploy/docker-compose.dev.yml 的 camera profile;CI 在 e2e job 里起):cam1 H.264、cam2 H.265。
// 地址是回环地址,只有 WS_ENV=dev 的后端 / worker 放行
const RTSP_PORT = process.env.WS_RTSP_PORT ?? '8554'
const CAM1 = `rtsp://127.0.0.1:${RTSP_PORT}/cam1`
const CAM2 = `rtsp://127.0.0.1:${RTSP_PORT}/cam2`
const CAMERA_NAME = 'E2E讲台机位'
/** 首帧:worker 收到"想看"才起 ffmpeg、等关键帧、写出首个片段,后端最多挂 8 秒,hls.js 再拉片段解码 */
const FIRST_FRAME_MS = 30_000
// 真流用例(要在浏览器里放出 H.264 画面)只在 WS_CHROME=1 时跑:playwright.config 据此给本 project 用系统 Chrome;
// 没有 Chrome 时 project 退回 Playwright 自带的 Chromium,它解不了 H.264,这几条跳过而不是红。其余用例不看画面,照跑
const USE_CHROME = process.env.WS_CHROME === '1'
const skipWithoutChrome = () =>
  test.skip(!USE_CHROME, '真流用例要系统 Chrome 解 H.264:设 WS_CHROME=1 才跑,Chromium 下跳过')

// 本文件改的共享数据:学校"监控"开关、摄像头(名字都以 E2E 开头)、学校作息、三年二班课表。
// 每个用例结束在 finally 里还原;beforeEach / afterEach 再按本文件开跑前的快照兜底一次
// (顺序:先开着开关删 E2E 摄像头 → 清课表 → 还原作息 → 还原课表 → 还原开关)。
// 时钟 / 时区假设(用例 2):节次按学校时区的"现在"前 2 分钟到后 20 分钟建,夹在 00:00–23:59 内;
// 学校时区 23:58 以后开跑会跨到第二天(星期几变了)而失败,重跑即可。
// 单个用例要等真流出首帧(最多两次 30 秒)加"测试连接"(最多 10 秒),默认 30 秒的用例超时不够
test.describe.configure({ mode: 'serial', timeout: 120_000 })

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

interface Session {
  ctx: BrowserContext
  page: Page
}

async function newSession(browser: Browser): Promise<Session> {
  const ctx = await browser.newContext({ baseURL: BASE_URL })
  return { ctx, page: await ctx.newPage() }
}

async function signIn(page: Page, name: string, password = 'dev123') {
  await page.goto('/login')
  await page.getByLabel('登录名').fill(name)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: /登录/ }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'))
}

/** 校长把学校"监控"开关拨到 on(其余开关保持当前值)。 */
async function setMonitor(request: APIRequestContext, on: boolean): Promise<void> {
  const principal = await login(request, 'principal01')
  const switches = await getSwitches(request, principal)
  await putSwitches(request, principal, { ...switches, monitor: on })
}

async function addCamera(
  request: APIRequestContext,
  token: string,
  classId: string,
  url = CAM1,
  name = CAMERA_NAME,
): Promise<CameraRecord> {
  return createCamera(request, token, {
    name,
    class_id: classId,
    location: '教室',
    rtsp_url: url,
    enabled: true,
    transcode: false,
  })
}

// ---------- 共享数据快照与还原 ----------

interface Baseline {
  switches: Record<string, boolean>
  periods: PeriodInput[]
  timetable: ClassTimetableOut
}
let baseline: Baseline | undefined

async function snapshot(request: APIRequestContext): Promise<Baseline> {
  const principal = await login(request, 'principal01')
  return {
    switches: await getSwitches(request, principal),
    periods: await adminGet<PeriodInput[]>(request, principal, '/periods'),
    timetable: await adminGet<ClassTimetableOut>(
      request,
      principal,
      `/classes/${CLASS_3_2}/timetable`,
    ),
  }
}

/** 还原到本文件开跑前的快照。摄像头接口在开关关着时 404,所以先把开关打开再删;课表引用着节次,先清课表再换作息。 */
async function restore(request: APIRequestContext): Promise<void> {
  if (!baseline) baseline = await snapshot(request)
  const principal = await login(request, 'principal01')
  const it = await login(request, 'itadmin01')
  await putSwitches(request, principal, { ...baseline.switches, monitor: true })
  await deleteE2eCameras(request, it)
  await putTimetable(request, principal, CLASS_3_2, [])
  await putPeriods(request, principal, baseline.periods)
  await putTimetable(request, principal, CLASS_3_2, timetableCellsToInput(baseline.timetable.cells))
  await putSwitches(request, principal, baseline.switches)
}

test.beforeEach(({ request }) => restore(request))
test.afterEach(({ request }) => restore(request))

// ---------- 页面断言助手 ----------

/**
 * 作用域内的 <video> 真的在放:已解出当前帧(readyState ≥ 2)且时间轴在走。
 * 超时时把播放器盖层上的提示("摄像头连不上" / "视频编码浏览器不支持" …)带进错误信息,CI 日志里一眼能看出卡在哪。
 */
async function expectPlaying(page: Page, scope: string, timeout = FIRST_FRAME_MS) {
  const root = `[data-testid="${scope}"]`
  try {
    await page.waitForFunction(
      (sel) => {
        const v = document.querySelector<HTMLVideoElement>(`${sel} video`)
        return !!v && v.readyState >= 2 && v.currentTime > 0
      },
      root,
      { timeout },
    )
  } catch (err) {
    const overlay = await page
      .locator(`${root} [role="alert"], ${root} [role="status"]`)
      .allInnerTexts()
    throw new Error(
      `${scope} 里的画面 ${timeout / 1000} 秒内没有播起来;播放器提示:${overlay.join(' | ') || '(无)'}`,
      { cause: err },
    )
  }
}

/** 做一个会(重新)加载教室页的动作,等三年二班概况返回,给出概况里"本班可看摄像头数"(入口只在它 > 0 时渲染)。 */
async function classroomCameraCount(page: Page, action: () => Promise<unknown>): Promise<number> {
  const summary = page.waitForResponse(
    (r) => r.url().includes(`/classes/${CLASS_3_2}/classroom`) && r.request().method() === 'GET',
  )
  await action()
  const res = await summary
  expect(res.ok(), await res.text()).toBeTruthy()
  const body = (await res.json()) as { cameras: number }
  await expect(page.getByRole('heading', { name: '三年二班' })).toBeVisible()
  return body.cameras
}

/** 学校时区里的"现在":ISO 星期几(1–7)取自学校的"今天",HH:MM 取同一时区的当前时刻。 */
function schoolNow(clock: { today: string; timezone: string }): { weekday: number; hhmm: string } {
  const day = new Date(`${clock.today}T00:00:00Z`).getUTCDay()
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: clock.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date())
  return { weekday: day === 0 ? 7 : day, hhmm }
}

/** HH:MM 加减分钟,夹在 00:00–23:59 之间(不跨天)。 */
function shiftMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + minutes))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

// ---------- 用例 ----------

test('homeroom teacher watches the own classroom: first frame, watermark, fullscreen, collapse', async ({
  page,
  request,
}) => {
  skipWithoutChrome()
  await setMonitor(request, true)
  const it = await login(request, 'itadmin01')
  const camera = await addCamera(request, it, CLASS_3_2)
  try {
    // 信息中心"测试连接":worker 真的从假摄像头拉到了 H.264 画面
    const result = await testCamera(request, it, camera.id)
    expect(result.ok, result.message).toBe(true)
    expect(result.preview_jpeg_base64 ?? '').not.toBe('')
    expect(result.probe, `连接成功却没有 ffprobe 流信息:${result.message}`).not.toBeNull()
    expect(result.probe!.video_codec).toBe('h264')
    expect(result.probe!.browser_playable).toBe(true)

    // 班主任:操作台上有"看看教室",展开后缩略条里的画面播起来
    expect(await classroomCameraCount(page, () => signIn(page, 'teacher01'))).toBe(1)
    const toggle = page.getByTestId('camera-toggle')
    await expect(toggle).toBeVisible()
    await toggle.click()
    const strip = page.getByTestId('camera-strip')
    await expect(strip).toBeVisible()
    await expectPlaying(page, 'camera-strip')
    await expect(strip.getByRole('alert')).toHaveCount(0)

    // 点缩略进全屏:水印带"正在直播"与观看者姓名,画面继续播;Esc 关闭回到缩略条
    await strip.getByRole('button', { name: `全屏查看 ${CAMERA_NAME}` }).click()
    const full = page.getByTestId('camera-fullscreen')
    await expect(full).toBeVisible()
    await expect(full).toContainText('正在直播')
    await expect(full).toContainText('张老师')
    await expectPlaying(page, 'camera-fullscreen')
    await page.keyboard.press('Escape')
    await expect(full).toBeHidden()
    await expect(strip).toBeVisible()

    await toggle.click()
    await expect(strip).toBeHidden()
  } finally {
    await deleteCamera(request, it, camera.id)
    await restore(request)
  }
})

test('subject teacher sees the camera only in the timetabled period; reassigning the slot revokes it', async ({
  browser,
  request,
}) => {
  skipWithoutChrome()
  await setMonitor(request, true)
  const principal = await login(request, 'principal01')
  const it = await login(request, 'itadmin01')
  const teacher03 = await login(request, 'teacher03')
  const camera = await addCamera(request, it, CLASS_3_2)
  let session: Session | undefined
  try {
    // 用学校时区的"现在"建第 1 节(现在前 2 分钟到后 20 分钟),课表格 = 今天第 1 节数学;
    // 没有"该班该科任课老师 teachers.id"的接口,teacher_id 省略,由后端按在任任职唯一匹配(三年二班数学只有赵老师)
    const { weekday, hhmm } = schoolNow(await schoolClock(request, teacher03, CLASS_3_2))
    await putPeriods(request, principal, [
      { no: 1, starts_at: shiftMinutes(hhmm, -2), ends_at: shiftMinutes(hhmm, 20) },
    ])
    const saved = await putTimetable(request, principal, CLASS_3_2, [
      { weekday, period_no: 1, subject: '数学' },
    ])
    expect(saved.cells).toHaveLength(1)
    expect(saved.cells[0].teacher?.name).toBe('赵老师')

    const mine = await adminGet<{
      reason: string
      period: { no: number } | null
      cameras: unknown[]
    }>(request, teacher03, `/classes/${CLASS_3_2}/cameras`)
    expect(mine.reason).toBe('period')
    expect(mine.period?.no).toBe(1)
    expect(mine.cameras).toHaveLength(1)

    session = await newSession(browser)
    const { page } = session
    expect(await classroomCameraCount(page, () => signIn(page, 'teacher03'))).toBe(1)
    await page.getByTestId('camera-toggle').click()
    await expect(page.getByTestId('camera-strip')).toBeVisible()
    const period = page.getByTestId('camera-strip-period')
    await expect(period).toContainText('第 1 节')
    await expect(period).toContainText('数学')
    await expectPlaying(page, 'camera-strip')

    // 这一格改成语文(自动匹配到班主任张老师):赵老师不再在课上,刷新后入口消失、播放列表 403
    const changed = await putTimetable(request, principal, CLASS_3_2, [
      { weekday, period_no: 1, subject: '语文' },
    ])
    expect(changed.cells[0].teacher?.name).toBe('张老师')
    expect(await classroomCameraCount(page, () => page.reload())).toBe(0)
    await expect(page.getByTestId('camera-toggle')).toHaveCount(0)
    const after = await adminGet<{ cameras: unknown[] }>(
      request,
      teacher03,
      `/classes/${CLASS_3_2}/cameras`,
    )
    expect(after.cameras).toHaveLength(0)
    const playlist = await request.get(`${API}/cameras/${camera.id}/stream.m3u8`, {
      headers: auth(teacher03),
    })
    expect(playlist.status()).toBe(403)
  } finally {
    await session?.ctx.close()
    await deleteCamera(request, it, camera.id)
    await restore(request)
  }
})

test('principal: the camera wall plays a class, auto-rotates to the next class, the grid shows 2–9 feeds', async ({
  page,
  request,
}) => {
  skipWithoutChrome()
  await setMonitor(request, true)
  const it = await login(request, 'itadmin01')
  const first = await addCamera(request, it, CLASS_3_2)
  const second = await addCamera(request, it, CLASS_3_1, CAM1, 'E2E后排机位')
  try {
    await signIn(page, 'principal01')
    await page.goto('/admin/board?rotate=2') // 轮播间隔改成 2 秒,只在开发构建里生效
    const wall = page.getByTestId('camera-wall')
    await expect(wall).toBeVisible()
    const row32 = page.getByTestId(`camera-wall-class-${CLASS_3_2}`)
    await expect(row32).toBeEnabled()
    await row32.click()
    await expect(row32).toHaveAttribute('aria-pressed', 'true')
    await expect(wall.locator('video').first()).toBeVisible()
    await expectPlaying(page, 'camera-wall')

    // 自动切换:2 秒一拍,5 秒内当前班换成三年一班
    const rotate = page.getByTestId('camera-wall-rotate')
    await rotate.check()
    const row31 = page.getByTestId(`camera-wall-class-${CLASS_3_1}`)
    await expect(row31).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 })
    await expect(row32).toHaveAttribute('aria-pressed', 'false')
    await rotate.uncheck()

    // 九宫格:默认选当前年级的机位(两个班各一路),不超过 9 路
    await page.getByRole('button', { name: '九宫格' }).click()
    const grid = page.getByTestId('camera-wall-grid')
    await expect(grid).toBeVisible()
    await expect.poll(() => grid.locator('video').count()).toBeGreaterThanOrEqual(2)
    expect(await grid.locator('video').count()).toBeLessThanOrEqual(9)
    await page.keyboard.press('Escape')
    await expect(grid).toBeHidden()
  } finally {
    await deleteCamera(request, it, first.id)
    await deleteCamera(request, it, second.id)
    await restore(request)
  }
})

test('no entry for the assistant teacher and the parent; playlist and class cameras are forbidden', async ({
  browser,
  request,
}) => {
  await setMonitor(request, true)
  const it = await login(request, 'itadmin01')
  const camera = await addCamera(request, it, CLASS_3_2)
  let assistant: Session | undefined
  let parent: Session | undefined
  try {
    // 副班主任(种子 teacher02,R2 里说要自建的身份种子已有):能进教室页,没有"看看教室",播放列表 403
    assistant = await newSession(browser)
    const a = assistant.page
    expect(await classroomCameraCount(a, () => signIn(a, 'teacher02'))).toBe(0)
    await expect(a.getByTestId('camera-toggle')).toHaveCount(0)
    const teacher02 = await login(request, 'teacher02')
    const forAssistant = await request.get(`${API}/cameras/${camera.id}/stream.m3u8`, {
      headers: auth(teacher02),
    })
    expect(forAssistant.status()).toBe(403)
    const list = await adminGet<{ cameras: unknown[] }>(
      request,
      teacher02,
      `/classes/${CLASS_3_2}/cameras`,
    )
    expect(list.cameras).toHaveLength(0)

    // 家长:页面上没有任何 camera- 开头的元素;班级摄像头与播放列表都 403
    parent = await newSession(browser)
    const p = parent.page
    await signIn(p, LI_PARENT)
    await expect(p).toHaveURL(/\/parent\/today/)
    await expect(p.getByRole('region', { name: '今日出勤' })).toBeVisible()
    expect(await p.locator('[data-testid^="camera-"]').count()).toBe(0)
    const parentToken = await login(request, LI_PARENT)
    const classCameras = await request.get(`${API}/classes/${CLASS_3_2}/cameras`, {
      headers: auth(parentToken),
    })
    expect(classCameras.status()).toBe(403)
    const playlist = await request.get(`${API}/cameras/${camera.id}/stream.m3u8`, {
      headers: auth(parentToken),
    })
    expect(playlist.status()).toBe(403)
  } finally {
    await assistant?.ctx.close()
    await parent?.ctx.close()
    await deleteCamera(request, it, camera.id)
    await restore(request)
  }
})

test('monitor switch off: the entry disappears and camera endpoints answer 404', async ({
  page,
  request,
}) => {
  await setMonitor(request, true)
  const it = await login(request, 'itadmin01')
  const camera = await addCamera(request, it, CLASS_3_2)
  try {
    await setMonitor(request, false)
    expect(await classroomCameraCount(page, () => signIn(page, 'teacher01'))).toBe(0)
    await expect(page.getByTestId('camera-toggle')).toHaveCount(0)
    const teacher01 = await login(request, 'teacher01')
    const admin = await request.get(`${API}/admin/cameras`, { headers: auth(it) })
    expect(admin.status()).toBe(404)
    const classCameras = await request.get(`${API}/classes/${CLASS_3_2}/cameras`, {
      headers: auth(teacher01),
    })
    expect(classCameras.status()).toBe(404)
    const playlist = await request.get(`${API}/cameras/${camera.id}/stream.m3u8`, {
      headers: auth(teacher01),
    })
    expect(playlist.status()).toBe(404)
  } finally {
    await setMonitor(request, true) // 开关关着时删不了摄像头
    await deleteCamera(request, it, camera.id)
    await restore(request)
  }
})

test('H.265 camera: the test reports hevc as not playable with a hint, shown in the test dialog', async ({
  page,
  request,
}) => {
  await setMonitor(request, true)
  const it = await login(request, 'itadmin01')
  const camera = await addCamera(request, it, CLASS_3_2, CAM2, 'E2E高清机位')
  try {
    const result = await testCamera(request, it, camera.id)
    // cam2 的推流镜像可能没有 libx265(CI 第一次跑才知道):只有 worker 明确回"连不上摄像头"才跳过,
    // 由后续段据此决定是否换镜像;"转流服务没有响应"等其它失败是环境坏了,要让用例红
    test.skip(
      result.probe === null && result.message.includes('连不上'),
      `cam2 不可用:${result.message}`,
    )
    expect(result.probe, `连接通了却没有 ffprobe 流信息:${result.message}`).not.toBeNull()
    expect(result.probe!.video_codec).toBe('hevc')
    expect(result.probe!.browser_playable).toBe(false)
    expect(result.probe!.hint ?? '').toContain('H.265')

    // 摄像头管理页的测试对话框把提示显示出来
    await signIn(page, 'itadmin01')
    await page.goto('/admin/cameras')
    await expect(page.getByTestId('cameras-page')).toBeVisible()
    const row = page.getByTestId('camera-list').getByRole('row').filter({ hasText: 'E2E高清机位' })
    await row.getByRole('button', { name: '测试连接' }).click()
    const dialog = page.getByTestId('camera-test-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('alert').filter({ hasText: 'H.265' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(dialog).toContainText('编码 H.265')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  } finally {
    await deleteCamera(request, it, camera.id)
    await restore(request)
  }
})
