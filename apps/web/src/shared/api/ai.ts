import type {
  AiChat,
  AiChatSummary,
  AiPrompt,
  AiReplyInput,
  AiRequest,
  AiStatus,
  AiTemplates,
} from '@/shared/types/ai'
import { api } from './client'
import { streamSSE, type SseHandlers } from './sse'

const enc = encodeURIComponent

/** AI 助手接口；reply / runItem 返回 SSE 流的 Promise（流结束或中止时 settle）。 */
export const aiApi = {
  status: () => api<AiStatus>('GET', '/ai/status'),
  templates: (classId: string) => api<AiTemplates>('GET', `/ai/templates?class_id=${enc(classId)}`),
  prompt: (body: AiRequest) => api<AiPrompt>('POST', '/ai/prompt', body),
  chatPrompt: (chatId: string) => api<AiPrompt>('GET', `/ai/chats/${enc(chatId)}/prompt`),
  createChat: (body: AiRequest) => api<AiChat>('POST', '/ai/chats', body),
  listChats: (classId: string) =>
    api<{ items: AiChatSummary[] }>('GET', `/ai/chats?class_id=${enc(classId)}`),
  getChat: (chatId: string) => api<AiChat>('GET', `/ai/chats/${enc(chatId)}`),
  deleteChat: (chatId: string) => api<void>('DELETE', `/ai/chats/${enc(chatId)}`),
  reply: (chatId: string, body: AiReplyInput, h: SseHandlers, signal?: AbortSignal) =>
    streamSSE(`/ai/chats/${enc(chatId)}/reply`, body, h, signal),
  runItem: (chatId: string, itemId: string, h: SseHandlers, signal?: AbortSignal) =>
    streamSSE(`/ai/chats/${enc(chatId)}/items/${enc(itemId)}/run`, {}, h, signal),
}
