/**
 * 审计记录 object_type 的中文名(审计页"对象类型"筛选用,L59)。
 * 后端只在查询参数上支持 object_type,没有列出全部类型的接口,这里按 server/app 里审计写入点
 * 用到过的类型列出;后端新增类型要同步加到这里才会出现在下拉里。
 */
export const OBJECT_TYPE_LABELS: Readonly<Record<string, string>> = {
  student: '学生',
  enrollment: '学籍',
  class: '班级',
  grade: '年级',
  academic_year: '学年',
  user: '用户',
  teacher_assignment: '教师任职',
  role_binding: '管理岗位',
  exam: '考试',
  grade_exam: '年级联考',
  review: '点评',
  review_op: '点评操作',
  comment: '评语',
  growth_record: '成长记录',
  notice: '通知',
  school: '学校',
  school_setting: '学校设置',
  camera: '摄像头',
  ai_chat: 'AI 对话',
}
