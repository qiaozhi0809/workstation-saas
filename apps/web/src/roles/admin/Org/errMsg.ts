import { ApiError } from '@/shared/api/client'

/** 后端错误取其 message,其他错误给通用提示 */
export const errMsg = (e: unknown): string => (e instanceof ApiError ? e.message : '操作失败,请重试')
