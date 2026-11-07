/**
 * 老师端考试相关的查询键(L273):成绩页 / 导入 / 自动保存按它取和失效,
 * 联考改动后的老师端缓存失效(roles/admin/GradeExams/teacherCache.ts)也用同一张表,不再靠人工对齐字面量。
 * 单独成文件、不放在 exams.ts 里:很多测试 `vi.mock('@/shared/api/exams')` 自动 mock 整个模块,
 * 放在那里键函数会被 mock 成返回 undefined。
 */
export const examKeys = {
  /** 考试列表 */
  list: (classId: string) => ['exams', classId] as const,
  /** 成绩册(分析页、教室成绩模式、侧边面板共用) */
  gradebook: (classId: string) => ['gradebook', classId] as const,
  /** 班级科目表 */
  subjects: (classId: string) => ['class-subjects', classId] as const,
  /** 某场考试的成绩单 */
  sheet: (classId: string, examId: string) => ['score-sheet', classId, examId] as const,
}
