import type { ListResponse } from '@/shared/types/api'
import type { Todo } from '@/shared/types/todo'
import { api } from './client'

export const todosApi = {
  list: () => api<ListResponse<Todo>>('GET', '/me/todos'),
  create: (content: string) => api<Todo>('POST', '/me/todos', { content }),
  update: (id: string, patch: { content?: string; done?: boolean }) =>
    api<Todo>('PATCH', `/me/todos/${encodeURIComponent(id)}`, patch),
  remove: (id: string) => api<void>('DELETE', `/me/todos/${encodeURIComponent(id)}`),
}
