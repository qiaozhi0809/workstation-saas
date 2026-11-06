import { ApiError } from '@/shared/api/client'

/** 报表接口的 403(没有 school.view,或联考 / 班级超出可见年级):显示"没有权限"而不是可重试的通用错误(L41) */
export const isForbidden = (e: unknown): boolean => e instanceof ApiError && e.status === 403

export const NO_PERM_SCORES = '没有权限查看成绩汇总'
export const NO_PERM_ATTENDANCE = '没有权限查看考勤报告'
