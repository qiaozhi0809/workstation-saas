import type { StudentProfile } from '@/shared/types/student'
import Field from './Field'

export default function OverviewTab({ student }: { student: StudentProfile }) {
  return (
    <dl>
      <Field label="编号" value={student.mk} />
      <Field label="学号" value={student.student_no} />
      <Field label="性别" value={student.gender} />
    </dl>
  )
}
