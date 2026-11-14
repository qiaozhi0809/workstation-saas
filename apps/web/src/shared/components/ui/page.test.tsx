import { render, screen } from '@testing-library/react'
import { PageContainer, PageHeader } from './page'

describe('PageHeader', () => {
  it('renders exactly one h1', () => {
    render(
      <PageContainer>
        <PageHeader title="学生管理" description="维护班级学生" />
      </PageContainer>,
    )
    const h1 = screen.getAllByRole('heading', { level: 1 })
    expect(h1).toHaveLength(1)
    expect(h1[0]).toHaveTextContent('学生管理')
    expect(screen.getByText('维护班级学生')).toBeInTheDocument()
  })

  it('actions come after the title in DOM order', () => {
    render(<PageHeader title="学生管理" actions={<button>新增</button>} meta={<span>期中</span>} />)
    const title = screen.getByRole('heading', { level: 1 })
    const action = screen.getByRole('button', { name: '新增' })
    expect(title.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('期中')).toBeInTheDocument()
  })

  it('title is 24px on phones and 30px from 640 wide, weight 500', () => {
    render(<PageHeader title="学生管理" />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveClass('text-2xl', 'sm:text-3xl', 'font-medium')
  })
})

describe('PageContainer', () => {
  it('widths', () => {
    const { container, rerender } = render(
      <PageContainer width="default">
        <PageHeader title="标题" />
        <p>正文</p>
      </PageContainer>,
    )
    const root = () => container.querySelector('[data-page-container]') as HTMLElement
    expect(root()).toHaveClass('max-w-[1320px]')
    expect(root().className).not.toContain('max-w-3xl')

    rerender(
      <PageContainer width="narrow">
        <PageHeader title="标题" />
        <p>正文</p>
      </PageContainer>,
    )
    // 外框仍是 1320,标题区贴 default 的左缘;正文(除标题区外的直接子节点)限 max-w-3xl
    expect(root()).toHaveClass('max-w-[1320px]')
    expect(root().className).toContain('max-w-3xl')
    expect(root().className).toContain(':not([data-page-header])')
    expect(screen.getByRole('heading', { level: 1 }).closest('[data-page-header]')).toBeTruthy()
    expect(
      (screen.getByRole('heading', { level: 1 }).closest('[data-page-header]') as HTMLElement)
        .className,
    ).not.toContain('max-w-')

    rerender(
      <PageContainer width="full">
        <p>正文</p>
      </PageContainer>,
    )
    expect(root().className).not.toContain('max-w-')
  })

  it('paddings', () => {
    const { container } = render(
      <PageContainer>
        <p>正文</p>
      </PageContainer>,
    )
    expect(container.querySelector('[data-page-container]')).toHaveClass('px-4', 'lg:px-8', 'py-6')
  })

  it('test hook', () => {
    const { container } = render(
      <PageContainer className="extra">
        <p>正文</p>
      </PageContainer>,
    )
    const root = container.querySelector('[data-page-container]')
    expect(root).not.toBeNull()
    expect(root).toHaveClass('extra')
  })
})
