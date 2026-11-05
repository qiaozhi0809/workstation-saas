import { beforeEach, expect, it, vi } from 'vitest'
import {
  confirmLeave,
  SCORES_LEAVE_CONFIRM,
  SEATING_LEAVE_CONFIRM,
  useTeacherStore,
} from './teacher'

beforeEach(() => {
  useTeacherStore.setState({ classId: null, unsaved: { seating: false, scores: false } })
})

it('confirmLeave returns true without prompting when nothing is dirty', () => {
  const spy = vi.spyOn(window, 'confirm')
  expect(confirmLeave()).toBe(true)
  expect(spy).not.toHaveBeenCalled()
  spy.mockRestore()
})

it('confirmLeave prompts with the dirty source message', () => {
  const spy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  useTeacherStore.getState().setUnsaved('scores', true)
  confirmLeave()
  expect(spy).toHaveBeenCalledWith(SCORES_LEAVE_CONFIRM)
  expect(SCORES_LEAVE_CONFIRM).toBe('还有成绩没保存,确定离开?')
  useTeacherStore.getState().setUnsaved('seating', true)
  spy.mockClear()
  confirmLeave(['seating'])
  expect(spy).toHaveBeenCalledWith(SEATING_LEAVE_CONFIRM)
  expect(SEATING_LEAVE_CONFIRM).toBe('有未保存的座位修改,确定离开吗?')
  spy.mockRestore()
})

it('cancel returns false and keeps the flags', () => {
  const spy = vi.spyOn(window, 'confirm').mockReturnValue(false)
  useTeacherStore.getState().setUnsaved('scores', true)
  expect(confirmLeave()).toBe(false)
  expect(useTeacherStore.getState().unsaved.scores).toBe(true)
  spy.mockRestore()
})

it('confirming returns true and clears the dirty flags it covered', () => {
  const spy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  useTeacherStore.getState().setUnsaved('scores', true)
  useTeacherStore.getState().setUnsaved('seating', true)
  expect(confirmLeave()).toBe(true)
  expect(useTeacherStore.getState().unsaved).toEqual({ seating: false, scores: false })
  spy.mockRestore()
})

it('only looks at the given keys', () => {
  const spy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  useTeacherStore.getState().setUnsaved('scores', true)
  expect(confirmLeave(['seating'])).toBe(true)
  expect(spy).not.toHaveBeenCalled()
  expect(useTeacherStore.getState().unsaved.scores).toBe(true)
  confirmLeave(['scores'])
  expect(useTeacherStore.getState().unsaved.scores).toBe(false)
  spy.mockRestore()
})
