import type { Comment, CommentBulk, CommentInput } from '@/shared/types/comment'
import { api } from './client'

const enc = encodeURIComponent

export const commentsApi = {
  list: (studentId: string) =>
    api<{ items: Comment[] }>('GET', `/students/${enc(studentId)}/comments`),
  create: (studentId: string, body: CommentInput) =>
    api<Comment>('POST', `/students/${enc(studentId)}/comments`, body),
  bulk: (classId: string, body: CommentBulk) =>
    api<{ created: number }>('POST', `/classes/${enc(classId)}/comments/bulk`, body),
  remove: (id: string) => api<void>('DELETE', `/comments/${enc(id)}`),
}
