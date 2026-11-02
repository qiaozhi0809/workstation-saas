import type { QueryClient } from '@tanstack/react-query'

/** 名单变动(添加 / 编辑 / 删除 / 导入)后,前缀失效所有依赖名单的查询。 */
export function invalidateRosterQueries(qc: QueryClient): Promise<unknown> {
  return Promise.all(
    ['student-records', 'class-students', 'classroom', 'gradebook', 'student', 'exams', 'score-sheet'].map((k) => qc.invalidateQueries({ queryKey: [k] })),
  )
}
