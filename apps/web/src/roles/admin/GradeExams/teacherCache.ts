import type { QueryClient } from '@tanstack/react-query'

/**
 * 联考的新建 / 编辑 / 删除 / 补建都会改各班的考试,新建与补建还会按目录合并班级科目表。
 * 兼任老师的领导在同一会话里切到教师端时,这些查询要重新取(L41):
 * 考试列表 ['exams', classId]、成绩册 ['gradebook', classId]、班级科目表 ['class-subjects', classId]
 * ——键名与 roles/teacher 下各页的 useQuery 写法一致,按受影响的班逐个失效。
 */
export function invalidateTeacherExamCaches(qc: QueryClient, classIds: Iterable<string>): void {
  for (const id of new Set(classIds)) {
    void qc.invalidateQueries({ queryKey: ['exams', id] })
    void qc.invalidateQueries({ queryKey: ['gradebook', id] })
    void qc.invalidateQueries({ queryKey: ['class-subjects', id] })
  }
}
