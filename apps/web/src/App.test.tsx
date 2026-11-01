import { render, screen } from '@testing-library/react'
import App from './App'

describe('App routing', () => {
  it('redirects / to the login page', () => {
    window.history.pushState({}, '', '/')
    render(<App />)
    expect(screen.getByRole('heading', { name: '班级工作台 · 登录' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
  })
})
