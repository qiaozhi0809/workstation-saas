import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from '@/shared/components/Toast'
import { readAiLink } from '@/shared/lib/aiLink'
import type { AiTemplate, AiValue } from '@/shared/types/ai'

const LINK_PARAMS = ['tpl', 'stu', 'exam', 'vs']

/**
 * 首页加载模板后读一次 ?tpl=&stu=&exam=&vs=,按字段类型预填并打开表单,随后从地址里去掉这四个参数。
 * 隐藏模板也能由入口打开;不可用的模板只提示原因。
 */
export function useTemplateEntry(
  templates: AiTemplate[] | undefined,
  open: (t: AiTemplate, initial: Record<string, AiValue>) => void,
) {
  const { search } = useLocation()
  const navigate = useNavigate()
  const done = useRef(false)

  useEffect(() => {
    if (!templates || done.current) return
    done.current = true
    const link = readAiLink(search)
    if (!link.tpl) return
    const t = templates.find((x) => x.id === link.tpl)
    const q = new URLSearchParams(search)
    LINK_PARAMS.forEach((k) => q.delete(k))
    const rest = q.toString()
    navigate({ search: rest ? `?${rest}` : '' }, { replace: true })
    if (!t) return
    if (!t.available) {
      if (t.unavailable_reason) toast(t.unavailable_reason)
      return
    }
    const initial: Record<string, AiValue> = {}
    const first = (type: string) => t.fields.find((f) => f.type === type)
    if (link.stu) {
      const one = first('student')
      if (one) initial[one.key] = link.stu
      const many = first('students')
      if (many) initial[many.key] = [link.stu]
    }
    const exam = first('exam')
    if (link.exam && exam) initial[exam.key] = link.exam
    const vs = first('exam0')
    if (link.vs && vs) initial[vs.key] = link.vs
    open(t, initial)
  }, [templates, search, navigate, open])
}
