import { describe, expect, it } from 'vitest'
import { computeLayout } from './layout'

describe('computeLayout', () => {
  it('places seats row-major on a grid', () => {
    const r = computeLayout({ rows: 6, cols: 4, container: { w: 800, h: 500 } })
    expect(r.seatPositions).toHaveLength(24)
    expect(r.seatPositions[0]).toMatchObject({ row: 1, col: 1 })
    expect(r.seatPositions[0].x).toBeLessThan(r.seatPositions[3].x)
    expect(r.seatPositions[20].y).toBeGreaterThan(r.seatPositions[0].y)
  })

  it('leaves room for the podium at the top', () => {
    const r = computeLayout({ rows: 4, cols: 4, container: { w: 600, h: 400 } })
    expect(r.seatPositions[0].y).toBeGreaterThan(120)
  })
})
