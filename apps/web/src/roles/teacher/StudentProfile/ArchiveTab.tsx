import { useQuery } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { classesApi } from '@/shared/api/classes'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import type { StudentProfile } from '@/shared/types/student'
import { Separator } from '@/shared/components/ui/separator'
import Field from './Field'
import NotesSection from './NotesSection'

async function copyPhone(phone: string) {
  try {
    await navigator.clipboard.writeText(phone)
    toast('已复制电话')
  } catch {
    toast('复制失败,请手动复制')
  }
}

export default function ArchiveTab({ student }: { student: StudentProfile }) {
  const classes = useQuery({ queryKey: ['my-classes'], queryFn: () => classesApi.mine() })
  // 笔记权限只给班主任,且不在 my_perms 里,所以按班级角色判断
  const isHomeroom =
    classes.data?.items.find((c) => c.id === student.class_id)?.role === 'homeroom_teacher'
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
        <dl>
          <Field label="家庭结构" value={student.family_structure} />
          {student.boarding !== undefined && (
            <Field label="住校" value={student.boarding ? '是' : '否'} />
          )}
          <Field label="家庭备注" value={student.family_note} />
        </dl>
      </section>
      {(student.contacts?.length ?? 0) > 0 && (
        <>
          <Separator />
          <section>
            <h3 className="mb-1 text-sm font-medium">家庭与联系人</h3>
            <ul className="space-y-2">
              {student.contacts!.map((c, i) => (
                <li key={i} className="rounded-md border p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{c.name}</span>{' '}
                      <span className="text-muted-foreground">{c.relation}</span>
                    </span>
                    {c.phone && (
                      <span className="flex items-center gap-1">
                        <span>{c.phone}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="复制电话"
                          onClick={() => void copyPhone(c.phone)}
                        >
                          <Copy className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </span>
                    )}
                  </div>
                  {c.job && <div className="text-muted-foreground">{c.job}</div>}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
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
        <dl>
          <Field label="健康备注" value={student.health_notes} />
        </dl>
      </section>
      <Separator />
      <section>
        <h3 className="mb-1 text-sm font-medium">其他备注</h3>
        <dl>
          <Field label="备注" value={student.note} />
        </dl>
      </section>
      {isHomeroom && (
        <>
          <Separator />
          <NotesSection key={student.id} studentId={student.id} note={student.teacher_notes} />
        </>
      )}
    </div>
  )
}
