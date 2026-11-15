import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Table, TableBody, TableHead, TableRow, Td, Th } from '@/shared/components/ui/table'
import { cn } from '@/shared/lib/utils'

/** 标题一律只用 h3 / h4 两档(同原版"最多到 h3") */
const components: Components = {
  h1: ({ children }) => (
    <h3 className="mb-2 mt-4 text-base font-medium text-foreground">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mb-2 mt-4 text-base font-medium text-foreground">{children}</h3>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-4 text-base font-medium text-foreground">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1 mt-3 text-sm font-medium text-foreground">{children}</h4>
  ),
  h5: ({ children }) => (
    <h4 className="mb-1 mt-3 text-sm font-medium text-foreground">{children}</h4>
  ),
  h6: ({ children }) => (
    <h4 className="mb-1 mt-3 text-sm font-medium text-foreground">{children}</h4>
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
  // Table 自带 overflow-x-auto 的外层容器(横向滚动);嵌在气泡 / 卡片里,所以去掉容器自己的底色和阴影
  table: ({ children }) => (
    <Table
      density="compact"
      className="w-full"
      containerClassName="my-2 rounded-none bg-transparent shadow-none"
    >
      {children}
    </Table>
  ),
  thead: ({ children }) => <TableHead>{children}</TableHead>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children }) => (
    <Th nowrap={false} className="text-foreground">
      {children}
    </Th>
  ),
  td: ({ children }) => (
    <Td nowrap={false} className="text-foreground">
      {children}
    </Td>
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
