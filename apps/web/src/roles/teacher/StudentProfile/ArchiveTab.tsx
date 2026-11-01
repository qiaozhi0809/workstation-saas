import type { StudentProfile } from '@/shared/types/student'
import Field from './Field'

export default function ArchiveTab({ student }: { student: StudentProfile }) {
  return (
    <div className="space-y-4">
      <section>
        <h4 className="font-medium mb-1">基本信息</h4>
        <dl>
          <Field label="姓名" value={student.name} />
          <Field label="性别" value={student.gender} />
          <Field label="学号" value={student.student_no} />
        </dl>
      </section>
      <section>
        <h4 className="font-medium mb-1">家庭情况</h4>
        <dl><Field label="家庭结构" value={student.family_structure} /></dl>
      </section>
      <section>
        <h4 className="font-medium mb-1">学习与性格</h4>
        <dl>
          <Field label="学习情况" value={student.learning_summary} />
          <Field label="性格特长" value={student.personality} />
        </dl>
      </section>
      <section>
        <h4 className="font-medium mb-1">健康情况</h4>
        <dl><Field label="健康备注" value={student.health_notes} /></dl>
      </section>
    </div>
  )
}
