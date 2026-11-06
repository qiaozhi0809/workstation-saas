import { beforeEach, describe, expect, it, vi } from 'vitest'

const startAuthSync = vi.fn()
const render = vi.fn()

vi.mock('./shared/stores/authSync', () => ({ startAuthSync }))
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render }) }))
vi.mock('./App', () => ({ default: () => null }))
vi.mock('./theme/index.css', () => ({}))

describe('main entry', () => {
  beforeEach(() => {
    vi.resetModules()
    startAuthSync.mockClear()
    render.mockClear()
    document.body.innerHTML = '<div id="root"></div>'
  })

  it('starts the cross-tab auth sync before rendering the app (D-6)', async () => {
    await import('./main')
    expect(startAuthSync).toHaveBeenCalledTimes(1)
    expect(render).toHaveBeenCalledTimes(1)
    expect(startAuthSync.mock.invocationCallOrder[0]).toBeLessThan(
      render.mock.invocationCallOrder[0],
    )
  })
})
