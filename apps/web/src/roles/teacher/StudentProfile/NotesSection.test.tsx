import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { studentsApi } from '@/shared/api/students'
import NotesSection from './NotesSection'

vi.mock('@/shared/api/students', () => ({ studentsApi: { saveMyNotes: vi.fn() } }))

const savedAt = new Date(2026, 10, 2, 9, 5)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(studentsApi.saveMyNotes).mockResolvedValue({ text: '爱读书', updated_at: savedAt.toISOString() })
})

function renderSection(note?: { text: string; updated_at: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(<QueryClientProvider client={client}><NotesSection studentId="s1" note={note} /></QueryClientProvider>)
  return { invalidate }
}

it('saves my notes and shows the saved time', async () => {
  const { invalidate } = renderSection()
  expect(screen.getByText('我的笔记')).toBeInTheDocument()
  expect(screen.getByText('只有你自己能看到')).toBeInTheDocument()
  expect(screen.getByText('0/2000')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '爱读书' } })
  expect(screen.getByText('3/2000')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(studentsApi.saveMyNotes).toHaveBeenCalledWith('s1', '爱读书'))
  expect(await screen.findByText('已保存 11月2日 09:05')).toBeInTheDocument()
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['student', 's1'] })
})

it('starts from the existing note and its saved time', () => {
  renderSection({ text: '细心', updated_at: savedAt.toISOString() })
  expect(screen.getByRole('textbox')).toHaveValue('细心')
  expect(screen.getByText('已保存 11月2日 09:05')).toBeInTheDocument()
})

it('limits the note to 2000 characters', () => {
  renderSection()
  expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', '2000')
})
