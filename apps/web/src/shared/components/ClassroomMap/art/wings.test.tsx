import { render } from '@testing-library/react'
import { SCENE_ASPECT, computeLayout } from '../layout'
import Wings from './Wings'

it('paints both wing walls inside clip paths and nothing when the room is not widened', () => {
  const L = computeLayout(6, 4, { aspect: SCENE_ASPECT })
  const { container } = render(<svg><Wings layout={L} /></svg>)
  expect(container.querySelector('.cr-wings')).toHaveAttribute('aria-hidden', 'true')
  for (const side of ['left', 'right']) {
    const g = container.querySelector(`[data-wing="${side}"]`)!
    expect(g.querySelector('[clip-path]')).not.toBeNull()
  }
  const { container: none } = render(<svg><Wings layout={computeLayout(6, 4)} /></svg>)
  expect(none.querySelector('.cr-wings')).toBeNull()
})
