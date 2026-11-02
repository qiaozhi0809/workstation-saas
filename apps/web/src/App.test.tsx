import { render, screen } from '@testing-library/react'
import App from './App'

describe('App routing', () => {
  it('redirects / to the login page', () => {
    window.history.pushState({}, '', '/')
    render(<App />)
    expect(screen.getByRole('heading', { name: '班级工作台' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
  })

  it('shows a not-found page with a way home', () => {
    window.history.pushState({}, '', '/nope')
    render(<App />)
    expect(screen.getByRole('heading', { name: '页面不存在' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '回到首页' })).toHaveAttribute('href', '/')
  })
})
