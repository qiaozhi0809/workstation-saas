import * as React from 'react'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { Field, useFormErrors } from './field'
import { Input } from './input'
import { Button } from './button'

describe('Field', () => {
  it('wires label, description and error', () => {
    render(
      <Field label="标题" description="不超过 20 字" error="请填写标题">
        <Input />
      </Field>,
    )
    const input = screen.getByLabelText('标题')
    expect(input.tagName).toBe('INPUT')
    const describedBy = input.getAttribute('aria-describedby') ?? ''
    expect(describedBy.split(' ')).toHaveLength(2)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('请填写标题')
    expect(describedBy).toContain(alert.id)
    expect(describedBy).toContain(screen.getByText('不超过 20 字').id)
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('has no alert or aria-invalid without an error', () => {
    render(
      <Field label="标题">
        <Input />
      </Field>,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('标题')).not.toHaveAttribute('aria-invalid')
  })

  it('required sets aria-required, not native required', () => {
    render(
      <Field label="标题" required>
        <Input />
      </Field>,
    )
    const input = screen.getByLabelText('标题')
    expect(input).toHaveAttribute('aria-required', 'true')
    expect(input).not.toBeRequired()
  })

  it('keeps an explicit id on the control', () => {
    render(
      <Field label="标题">
        <Input id="mine" />
      </Field>,
    )
    expect(screen.getByLabelText('标题')).toHaveAttribute('id', 'mine')
  })
})

describe('useFormErrors', () => {
  function Harness() {
    const form = useFormErrors(['title', 'body'])
    return (
      <div>
        <Field label="正文" error={form.errors.body}>
          <Input ref={form.fieldRef('body')} />
        </Field>
        <Field label="标题" error={form.errors.title}>
          <Input ref={form.fieldRef('title')} />
        </Field>
        <button onClick={() => form.report({ body: '必填', title: '必填' })}>报告</button>
        <button onClick={() => form.clear('title')}>清除标题</button>
      </div>
    )
  }

  it('report focuses the first error in order, not DOM order', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '报告' }))
    expect(document.activeElement).toBe(screen.getByLabelText('标题'))
    expect(screen.getAllByRole('alert')).toHaveLength(2)
  })

  it('report returns false with errors and true without', () => {
    const { result } = renderHook(() => useFormErrors(['a', 'b']))
    let ok = true
    act(() => {
      ok = result.current.report({ b: '错' })
    })
    expect(ok).toBe(false)
    act(() => {
      ok = result.current.report({})
    })
    expect(ok).toBe(true)
    expect(result.current.errors).toEqual({})
  })

  it('report with a key outside order still returns false', () => {
    const { result } = renderHook(() => useFormErrors(['a']))
    let ok = true
    act(() => {
      ok = result.current.report({ zzz: '错' } as never)
    })
    expect(ok).toBe(false)
  })

  it('clear removes one error', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '报告' }))
    fireEvent.click(screen.getByRole('button', { name: '清除标题' }))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByLabelText('标题')).not.toHaveAttribute('aria-invalid')
  })
})

describe('submit pattern', () => {
  function Form() {
    const form = useFormErrors(['title'])
    const [title, setTitle] = React.useState('')
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.report(title.trim() ? {} : { title: '请填写标题' })
        }}
      >
        <Field label="标题" required error={form.errors.title}>
          <Input
            ref={form.fieldRef('title')}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              form.clear('title')
            }}
          />
        </Field>
        <Button type="submit">发送</Button>
      </form>
    )
  }

  it('submit button is not disabled for empty required fields', () => {
    render(<Form />)
    const send = screen.getByRole('button', { name: '发送' })
    expect(send).not.toBeDisabled()
    fireEvent.click(send)
    expect(screen.getByText('请填写标题')).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByLabelText('标题'))
  })
})
