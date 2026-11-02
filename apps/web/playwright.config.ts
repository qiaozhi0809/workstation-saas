import { defineConfig } from '@playwright/test'

// classroom.spec 会改共享种子数据(考勤、点评、座位),其余 spec 在同一个班级上只读断言。
// 先让改数据的 project 单独跑完,只读 project 再并行,避免读到改到一半的数据。
// 不用 retries:干扰要靠隔离消除,不是靠重跑掩盖。
const MUTATING = 'classroom.spec.ts'

export default defineConfig({
  testDir: './e2e',
  // 刷新后整张教室地图要重新取数渲染;CI 小核数 / 负载高时默认 5s 不够(负载下复现过),放宽断言等待而非重试
  expect: { timeout: 10_000 },
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173' },
  projects: [
    { name: 'mutating', testMatch: MUTATING },
    { name: 'readonly', testIgnore: MUTATING, dependencies: ['mutating'] },
  ],
})
