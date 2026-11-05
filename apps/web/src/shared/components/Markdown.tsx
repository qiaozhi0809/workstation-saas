import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/shared/lib/utils'

/** 标题一律只用 h3 / h4 两档(同原版"最多到 h3") */
const components: Components = {
  h1: ({ children }) => (
    <h3 className="mb-2 mt-4 text-base font-semibold text-foreground">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mb-2 mt-4 text-base font-semibold text-foreground">{children}</h3>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-4 text-base font-semibold text-foreground">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1 mt-3 text-sm font-semibold text-foreground">{children}</h4>
  ),
  h5: ({ children }) => (
    <h4 className="mb-1 mt-3 text-sm font-semibold text-foreground">{children}</h4>
  ),
  h6: ({ children }) => (
    <h4 className="mb-1 mt-3 text-sm font-semibold text-foreground">{children}</h4>
  ),
  p: ({ children }) => <p className="my-2 leading-relaxed text-foreground">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc pl-5 text-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-5 text-foreground">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 text-[0.9em] text-foreground">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded bg-muted p-3 text-sm text-foreground [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  // 绝不渲染 <img>:AI 输出里的远程图片 URL 可能带着还原后的真实学生姓名,浏览器一加载就泄露
  img: ({ alt }) => (alt ? <span className="text-muted-foreground">[图片:{alt}]</span> : null),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted px-2 py-1 text-left font-medium text-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 text-foreground">{children}</td>
  ),
  hr: () => <hr className="my-3 border-border" />,
}

/** 渲染 AI 返回的 Markdown:忽略原始 HTML,链接新窗口打开,不使用 dangerouslySetInnerHTML */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('text-sm', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
