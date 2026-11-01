import { placeCard } from './placeCard'

const card = { w: 200, h: 120 }
const stage = { w: 1000, h: 600 }

it('places the card to the right by default', () => {
  expect(placeCard({ left: 100, top: 200, width: 80, height: 80 }, card, stage)).toEqual({
    left: 192, top: 180, side: 'right',
  })
})

it('flips left at the right edge (rightmost column)', () => {
  const p = placeCard({ left: 900, top: 200, width: 80, height: 80 }, card, stage)
  expect(p).toEqual({ left: 688, top: 180, side: 'left' })
})

it('clamps vertically for the last row', () => {
  expect(placeCard({ left: 100, top: 560, width: 80, height: 80 }, card, stage).top).toBe(472)
})
