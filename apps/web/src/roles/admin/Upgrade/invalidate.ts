import type { QueryClient } from '@tanstack/react-query'

/** 升级或回滚后,学年 / 班级 / 看板这类 admin 缓存和往年班级(history)、联考与报表(按当前学年取数)、选人候选(带学年标签)缓存都要重取 */
export function refreshYearData(qc: QueryClient): Promise<unknown> {
  const keys = [
    ['upgrade', 'latest'],
    ['admin', 'years'],
    ['admin', 'classes'],
    ['admin', 'class'],
    ['admin', 'grades'],
    ['admin', 'board'],
    ['admin', 'today'],
    ['admin', 'roles'],
    ['class-students'],
    ['history'],
    ['grade-exams'],
    ['report'],
    ['admin', 'org', 'people'],
  ]
  return Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })))
}
