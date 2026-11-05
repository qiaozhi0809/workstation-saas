import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { newOpId } from '@/shared/api/opId'
import { reviewsApi } from '@/shared/api/reviews'
import { toast } from '@/shared/components/Toast'
import type { ClassPerm } from '@/shared/types/classroom'
import type { Review, ReviewCreate } from '@/shared/types/review'

/** 页面级"当前科目":点评弹层、全班 +1、点名的"回答得好 +1"共用,换弹层也记住。 */
export interface ReviewSubject {
  /** 弹层里可选的科目;不到两科时为空(不显示选择框) */
  subjects: string[]
  /** 只任课的老师在本班教多科:必须指定科目,没有"不指定" */
  required: boolean
  /** 当前选中的科目;'' 表示不指定 */
  value: string
  set(subject: string): void
}

/**
 * 科目规则(契约"点评的科目"):本班只教一科或不任课 → 不传 subject(服务端自动取);
 * 多科的班主任 / 副班主任可以不指定;多科的纯任课老师(没有 attendance.write)必须指定,默认第一科。
 */
export function useReviewSubject(perms: readonly ClassPerm[], mySubjects: string[]): ReviewSubject {
  const [chosen, setChosen] = useState<string | null>(null)
  const many = mySubjects.length > 1
  const required = many && !perms.includes('attendance.write')
  let value = ''
  if (many) {
    const valid = chosen !== null && (chosen === '' ? !required : mySubjects.includes(chosen))
    value = valid ? chosen : required ? mySubjects[0] : ''
  }
  return { subjects: many ? mySubjects : [], required, value, set: setChosen }
}

type Body = Omit<ReviewCreate, 'op_id' | 'subject'>
interface Handlers {
  onSuccess?(items: Review[], opId: string): void
}

/**
 * 发一次点评(一次用户操作 = 一个 op_id)。同步守卫挡住重渲染前的连点;
 * 结果不明的失败(网络 / 5xx)后同样的请求重试沿用同一个 op_id,服务端幂等,不会重复记分;成功后清除。
 */
export function useReviewSubmit(classId: string, subject: string) {
  const qc = useQueryClient()
  const inflight = useRef(false)
  const retry = useRef<{ key: string; opId: string } | null>(null)
  const post = useMutation({ mutationFn: (body: ReviewCreate) => reviewsApi.create(classId, body) })

  const submit = (b: Body, h: Handlers = {}) => {
    if (inflight.current) return
    const body = { ...b, ...(subject ? { subject } : {}) }
    const key = JSON.stringify(body)
    // 先生成 op_id 再上锁:生成失败时不会把按钮永久锁住
    const op_id = retry.current?.key === key ? retry.current.opId : newOpId()
    inflight.current = true
    retry.current = null
    post.mutate(
      { op_id, ...body },
      {
        onSuccess: (res) => {
          retry.current = null
          void qc.invalidateQueries({ queryKey: ['review-summary', classId] })
          void qc.invalidateQueries({ queryKey: ['reviews', classId] })
          void qc.invalidateQueries({ queryKey: ['student-reviews', classId] })
          h.onSuccess?.(res.items, op_id)
        },
        onError: (err) => {
          if (!(err instanceof ApiError) || err.status >= 500) retry.current = { key, opId: op_id }
          toast(
            err instanceof ApiError && err.code === 'NO_TARGETS' ? '今天全班都请假了' : err.message,
          )
        },
        onSettled: () => {
          inflight.current = false
        },
      },
    )
  }

  return { submit, pending: post.isPending }
}
