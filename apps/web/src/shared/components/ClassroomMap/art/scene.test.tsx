import { render, screen } from '@testing-library/react'
import { computeLayout } from '../layout'
import { deskProps } from './Desk'
import FrontWall, { clockAngles } from './FrontWall'
import Room from './Room'
import Zones from './Zones'

const board = {
  leftTitle: '今日课程', leftLines: ['1 语文', '2 数学', '3 英语', '4 科学', '5 音乐'],
  rightTitle: '今日事项', rightLines: [],
  screenTitle: '三年二班 · 11月2日 星期一',
  countdown: { label: '期末考试', days: 74 },
  stars: [{ name: '王小一', points: 5 }], birthdays: [],
}

it('draws windows and lockers sized by the layout', () => {
  const L = computeLayout(6, 4)
  const { container } = render(<svg><Room layout={L} rows={6} /></svg>)
  expect(container.querySelectorAll('.cr-window')).toHaveLength(5)
  expect(container.querySelectorAll('.cr-locker')).toHaveLength(Math.floor(L.grid.w / 70))
})

it('labels only the zones that fit', () => {
  render(<svg><Zones zones={computeLayout(2, 4).zones} /></svg>)
  for (const t of ['阅读角', '荣誉墙', '作业架', '自然角']) expect(screen.getByText(t)).toBeInTheDocument()
  expect(screen.queryByText('谈心角')).toBeNull()
})

it('caps board lines, shows countdown and empty boards', () => {
  const rect = computeLayout(6, 4).frontWall!
  render(<svg><FrontWall rect={rect} board={board} now={new Date(2026, 10, 2, 9, 0)} /></svg>)
  expect(screen.getByText('4 科学')).toBeInTheDocument()
  expect(screen.queryByText('5 音乐')).toBeNull()
  expect(screen.getByText('距期末考试')).toBeInTheDocument()
  expect(screen.getByText('74')).toBeInTheDocument()
  expect(screen.getByText('王小一')).toBeInTheDocument()
  expect(screen.getAllByText('暂无')).toHaveLength(1)
})

it('computes clock hand angles', () => {
  expect(clockAngles(new Date(2026, 10, 2, 15, 30))).toEqual({ hour: 105, minute: 180 })
})

it('places the same desk props for the same seed', () => {
  expect(deskProps('e1')).toEqual(deskProps('e1'))
  expect(deskProps('e1').length).toBeGreaterThanOrEqual(1)
  expect(deskProps('e1').length).toBeLessThanOrEqual(3)
})
