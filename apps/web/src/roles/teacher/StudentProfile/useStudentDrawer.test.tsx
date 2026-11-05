import { useEffect } from 'react'
import { act, render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation, useSearchParams } from 'react-router-dom'
import { useStudentDrawer } from './useStudentDrawer'

function setup(entry: string) {
  const results: { drawer: ReturnType<typeof useStudentDrawer>; search: string }[] = []
  function Probe() {
    const drawer = useStudentDrawer()
    results.push({ drawer, search: useLocation().search })
    return null
  }
  const router = createMemoryRouter([{ path: '/teacher/classroom', element: <Probe /> }], {
    initialEntries: [entry],
  })
  render(<RouterProvider router={router} />)
  return { router, last: () => results[results.length - 1] }
}

describe('useStudentDrawer stability', () => {
  it('keeps open/close identity across re-renders and search-param changes', () => {
    const { router, last } = setup('/teacher/classroom?mode=seat')
    const first = last().drawer
    act(() => {
      void router.navigate('/teacher/classroom?mode=seat&x=1', { replace: true })
    })
    expect(last().drawer.open).toBe(first.open)
    act(() => {
      first.open('s1')
    })
    expect(router.state.location.search).toBe('?mode=seat&x=1&student=s1')
    expect(last().drawer.studentId).toBe('s1')
    expect(last().drawer.open).toBe(first.open)
    expect(last().drawer.close).toBe(first.close)
    act(() => {
      last().drawer.close()
    })
    expect(router.state.location.search).toBe('?mode=seat&x=1')
  })

  it('returns the same object while studentId and tab are unchanged', () => {
    const { router, last } = setup('/teacher/classroom?student=s1')
    const a = last().drawer
    act(() => {
      void router.navigate('/teacher/classroom?student=s1&x=1', { replace: true })
    })
    expect(last().drawer).toBe(a)
  })

  it('drops the ? when the search becomes empty and keeps the pathname', () => {
    const { router, last } = setup('/teacher/classroom?student=s1&tab=成绩')
    act(() => {
      last().drawer.close()
    })
    expect(router.state.location.search).toBe('')
    expect(router.state.location.pathname).toBe('/teacher/classroom')
  })
})

describe('useStudentDrawer in child effects', () => {
  it('uses the latest search when a child effect calls close() in the same commit as a navigation', () => {
    function Child({ exam, close }: { exam: string | null; close: () => void }) {
      useEffect(() => {
        if (exam === 'B') close()
      }, [exam, close])
      return null
    }
    function Parent() {
      const { close } = useStudentDrawer()
      const [params] = useSearchParams()
      return <Child exam={params.get('exam')} close={close} />
    }
    const router = createMemoryRouter([{ path: '/teacher/classroom', element: <Parent /> }], {
      initialEntries: ['/teacher/classroom?exam=A&student=s'],
    })
    render(<RouterProvider router={router} />)
    act(() => {
      void router.navigate('/teacher/classroom?exam=B&student=s')
    })
    expect(router.state.location.search).toBe('?exam=B')
  })
})
