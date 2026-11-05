import { defineConfig } from '@playwright/test'

// classroom / grades / students / ai / profile / desks / admin / m3b 九个 spec 会改共享种子数据(考勤、点评、座位、考试成绩、学生名单、AI 对话、评语、成长记录、桌椅排列、账号 / 任职 / 学校设置开关),
// 其余 spec 在同一个班级上只读断言。改数据的 project 串成一条链(mutating → grades → students → ai → profile → desks → admin → m3b → m4a),
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
    { name: 'readonly', testIgnore: [MUTATING, GRADES, STUDENTS, AI, PROFILE, DESKS, ADMIN, M3B, M4A], dependencies: ['m4a'] },
  ],
})
