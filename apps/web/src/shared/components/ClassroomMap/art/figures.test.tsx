import { render } from '@testing-library/react'
import Avatar from './Avatar'
import StudentFigure, { genderOf, hairStyleOf, type Pose } from './StudentFigure'
import TeacherFigure, { pointerAngle } from './TeacherFigure'

const fig = (pose: Pose) =>
  render(<svg><StudentFigure x={0} y={0} gender="female" seed="s1" color="#3fb8a9" pose={pose} /></svg>)

it('maps stored gender values', () => {
  expect(['女', 'F', 'female', '男', 'M', 'male', '其他', null].map(genderOf)).toEqual([
    'female', 'female', 'female', 'male', 'male', 'male', null, null,
  ])
})

it('keeps hair styles stable per seed and within the gender set', () => {
  expect(hairStyleOf('female', 'seed-01')).toBe(hairStyleOf('female', 'seed-01'))
  for (let i = 0; i < 30; i++) {
    expect(['braid', 'bob', 'pony']).toContain(hairStyleOf('female', `s${i}`))
    expect(['spiky', 'buzz', 'side']).toContain(hairStyleOf('male', `s${i}`))
  }
  expect(hairStyleOf(null, 'x')).toBe('beanie')
})

it('shows the face only when turned around or standing', () => {
  expect(fig('sit').container.querySelector('.cr-face')).toBeNull()
  expect(fig('turn').container.querySelector('.cr-face')).not.toBeNull()
  expect(fig('stand').container.querySelector('.cr-face')).not.toBeNull()
})

it('renders pose parts', () => {
  expect(fig('raise').container.querySelector('[data-pose="raise"] .cr-arm')).not.toBeNull()
  expect(fig('doze').container.querySelector('.cr-zz')).not.toBeNull()
  expect(fig('stand').container.querySelector('.cr-burst')).not.toBeNull()
  expect(fig('sit').container.querySelector('.cr-arm')).toBeNull()
})

it('points the teacher at a target', () => {
  expect(pointerAngle({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe(0)
  expect(pointerAngle({ x: 0, y: 0 }, { x: 0, y: 100 })).toBe(90)
  const { container } = render(
    <svg><TeacherFigure x={0} y={0} figure="male" action="point" pointAt={{ x: 0, y: 100 }} /></svg>,
  )
  expect(container.querySelector('[data-figure="male"][data-action="point"]')).not.toBeNull()
  expect(container.querySelector('.cr-pointer')?.getAttribute('transform')).toContain('rotate(90')
})

it('renders an accessible avatar', () => {
  const { getByRole } = render(<Avatar gender="male" seed="s" color="#4c9be8" title="王小一" />)
  expect(getByRole('img', { name: '王小一' })).toBeInTheDocument()
})
