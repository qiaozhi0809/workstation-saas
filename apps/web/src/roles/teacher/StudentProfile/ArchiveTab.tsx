import type { StudentProfile } from '@/shared/types/student'
import { Separator } from '@/shared/components/ui/separator'
import Field from './Field'

export default function ArchiveTab({ student }: { student: StudentProfile }) {
  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-1 text-sm font-medium">基本信息</h3>
        <dl>
          <Field label="姓名" value={student.name} />
          <Field label="性别" value={student.gender} />
          <Field label="学号" value={student.student_no} />
        </dl>
      </section>
      <Separator />
      <section>
        <h3 className="mb-1 text-sm font-medium">家庭情况</h3>
        <dl><Field label="家庭结构" value={student.family_structure} /></dl>
      </section>
      <Separator />
      <section>
        <h3 className="mb-1 text-sm font-medium">学习与性格</h3>
        <dl>
          <Field label="学习情况" value={student.learning_summary} />
          <Field label="性格特长" value={student.personality} />
        </dl>
      </section>
      <Separator />
      <section>
        <h3 className="mb-1 text-sm font-medium">健康情况</h3>
        <dl><Field label="健康备注" value={student.health_notes} /></dl>
      </section>
    </div>
  )
}
