import { defineConfig } from '@playwright/test'

// classroom / grades / students / ai / profile / desks / admin / m3b / m4a / m4b / m5b / m5c 十二个 spec 会改共享种子数据(考勤、点评、座位、考试成绩、学生名单、AI 对话、评语、成长记录、桌椅排列、账号 / 任职 / 学校设置开关、家长绑定、学年升级、通知与家长账号、账号安全设置、监控开关 / 摄像头 / 作息与课表),
// 其余 spec 在同一个班级上只读断言。改数据的 project 串成一条链(mutating → grades → students → ai → profile → desks → admin → m3b → m4a → m4b → m5b → m5c),
// 各自单独跑完、互不交叠(都改座位、名单,并行会互相踩);只读 project 最后再并行,避免读到改到一半的数据。
// 上游 project 失败会让下游 project 全部跳过(不会显示为失败),排查时先看最早失败的 project。
// 不用 retries:干扰要靠隔离消除,不是靠重跑掩盖。
const MUTATING = 'classroom.spec.ts'
const GRADES = 'grades.spec.ts'
const STUDENTS = 'students.spec.ts'
const AI = 'ai.spec.ts'
const PROFILE = 'profile.spec.ts'
const DESKS = 'desks.spec.ts'
const ADMIN = 'admin.spec.ts'
const M3B = 'm3b.spec.ts'
const M4A = 'm4a.spec.ts'
const M4B = 'm4b.spec.ts'
const M5B = 'm5b.spec.ts'
const M5C = 'm5c.spec.ts'
const WALKTHROUGH = 'walkthrough.spec.ts'

// m5c 的真流用例要浏览器能解 H.264,Playwright 自带的 Chromium 没有专有解码器。WS_CHROME=1 时 m5c project 用系统里的
// Google Chrome(channel: 'chrome';GitHub ubuntu runner 预装,CI 探测到它才设这个变量);没设就退回 Chromium,
// m5c.spec 里的真流用例按同一个变量 skip,其余用例(权限、开关、H.265 提示)照跑
const USE_CHROME = process.env.WS_CHROME === '1'

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  // 刷新后整张教室地图要重新取数渲染;CI 小核数 / 负载高时默认 5s 不够(负载下复现过),放宽断言等待而非重试
  expect: { timeout: 10_000 },
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173' },
  // 注意:只跑单个只读 spec(如 npx playwright test e2e/short.spec.ts)也会先跑整条改数据链;加 --no-deps 可跳过
  projects: [
    { name: 'mutating', testMatch: MUTATING },
    { name: 'grades', testMatch: GRADES, dependencies: ['mutating'] },
    { name: 'students', testMatch: STUDENTS, dependencies: ['grades'] },
    { name: 'ai', testMatch: AI, dependencies: ['students'] },
    { name: 'profile', testMatch: PROFILE, dependencies: ['ai'] },
    { name: 'desks', testMatch: DESKS, dependencies: ['profile'] },
    { name: 'admin', testMatch: ADMIN, dependencies: ['desks'] },
    // m3b 含学年升级用例(结束时回滚)、联考(结束时删除)、通知(只撤回,不删),放在 admin 之后、只读 project 之前
    { name: 'm3b', testMatch: M3B, dependencies: ['admin'] },
    // m4a 建家长绑定(结束时解绑)、建考试(结束时删除)、改家长可见排名开关(结束时还原),学年升级用例放最后并回滚
    { name: 'm4a', testMatch: M4A, dependencies: ['m3b'] },
    // m4b 发班级公告 / 年级家长 / 全校老师通知(结束时全部撤回)、建家长账号(结束时解绑,账号归档留库),不改其他共享数据
    { name: 'm4b', testMatch: M4B, dependencies: ['m4a'] },
    // m5b 建虚构老师账号(结束时冻结留库),临时改学校安全设置(每个用例前后还原为默认),不改种子账号
    { name: 'm5b', testMatch: M5B, dependencies: ['m4b'] },
    // m5c 开学校"监控"开关、登记假摄像头(rtsp://127.0.0.1:8554/cam1、cam2,CI 的 camera profile)、
    // 建作息与三年二班课表;每个用例结束还原(关开关、删摄像头、清课表与作息),失败也由 afterEach 按快照兜底。
    // 浏览器见上面 USE_CHROME 的说明;其余 project 不受影响
    {
      name: 'm5c',
      testMatch: M5C,
      dependencies: ['m5b'],
      use: USE_CHROME ? { channel: 'chrome' } : {},
    },
    {
      name: 'readonly',
      testIgnore: [
        MUTATING,
        GRADES,
        STUDENTS,
        AI,
        PROFILE,
        DESKS,
        ADMIN,
        M3B,
        M4A,
        M4B,
        M5B,
        M5C,
        WALKTHROUGH,
      ],
      dependencies: ['m5c'],
    },
    // 走查截图(M5d R14):只读,把各端主要页面按视口 × 主题截成整页 PNG 到 apps/web/walkthrough/,CI 作为 artifact 上传。
    // 排在整条链末尾、独占浏览器,不与只读 project 里量布局的用例抢 CPU;文件内 10 个用例声明为并行。
    // CI 把它拆成单独一步:先 `--project readonly`(连带整条依赖链,不含本 project),再 `--project walkthrough --no-deps`
    // 且 continue-on-error——截图失败不拦 job;本机 `npm run e2e` 仍按依赖在链末尾跑它。
    // 一个用例要截上百张图(约 2–3 分钟),单测超时放宽到 5 分钟;单张图的等待仍受 expect 10 秒约束,卡住时快速失败
    // 只有本 project 用 --lang=zh-CN 启动浏览器:Playwright 的 locale 选项改不了 date / time 控件的显示,只有启动参数能改;
    // 其余 project 不带这个参数,行为不变
    {
      name: 'walkthrough',
      testMatch: WALKTHROUGH,
      dependencies: ['readonly'],
      timeout: 5 * 60_000,
      use: { launchOptions: { args: ['--lang=zh-CN'] } },
    },
  ],
})
