import type { QueryClient } from '@tanstack/react-query'
import { examKeys } from '@/shared/api/examKeys'
import type { GradeExamClass } from '@/shared/types/admin'

/**
 * 联考的新建 / 编辑 / 删除 / 补建都会改各班的考试,新建与补建还会按目录合并班级科目表。
 * 兼任老师的领导在同一会话里切到教师端时,这些查询要重新取(L41):
 * 考试列表、成绩册、班级科目表,以及该班对应考试的成绩单
 * ——键取自 shared/api/examKeys.ts(L273),与 roles/teacher 下各页的 useQuery 同一张表,按受影响的班逐个失效。
 */
export function invalidateTeacherExamCaches(
  qc: QueryClient,
  classes: Iterable<Pick<GradeExamClass, 'class_id' | 'exam_id'>>,
): void {
  const seen = new Set<string>()
  for (const { class_id, exam_id } of classes) {
    if (!seen.has(class_id)) {
      seen.add(class_id)
      void qc.invalidateQueries({ queryKey: examKeys.list(class_id) })
      void qc.invalidateQueries({ queryKey: examKeys.gradebook(class_id) })
      void qc.invalidateQueries({ queryKey: examKeys.subjects(class_id) })
    }
    void qc.invalidateQueries({ queryKey: examKeys.sheet(class_id, exam_id) })
  }
}
