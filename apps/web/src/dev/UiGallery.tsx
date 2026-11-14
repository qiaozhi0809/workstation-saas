import { Badge } from '@/shared/components/arc/badge/badge'
import { Button as ArcButton } from '@/shared/components/arc/button/button'
import { Skeleton } from '@/shared/components/arc/skeleton/skeleton'
import { Tooltip } from '@/shared/components/arc/tooltip/tooltip'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Field, useFormErrors } from '@/shared/components/ui/field'
import { IconButton } from '@/shared/components/ui/icon-button'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { PageContainer, PageHeader } from '@/shared/components/ui/page'
import { StatusDot } from '@/shared/components/ui/status-dot'
import { Switch } from '@/shared/components/ui/switch'
import {
  Table,
  TableBody,
  TableFoot,
  TableHead,
  TableRow,
  Td,
  Th,
} from '@/shared/components/ui/table'
import { Bell, Inbox, Pencil } from 'lucide-react'

const VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const
const SIZES = ['sm', 'md', 'lg'] as const
const TONES = ['neutral', 'success', 'info', 'warning', 'danger'] as const

const SCORES = [
  { name: '王小一', no: '01', score: 95.5 },
  { name: '魏小七', no: '02', score: 88 },
  { name: '李小二', no: '03', score: 72.25 },
]

function FieldDemo() {
  const form = useFormErrors(['title', 'body'])
  return (
    <form
      className="flex max-w-sm flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const data = new FormData(e.currentTarget)
        form.report({
          ...(String(data.get('title') ?? '').trim() ? {} : { title: '请填写标题' }),
          ...(String(data.get('body') ?? '').trim() ? {} : { body: '请填写正文' }),
        })
      }}
    >
      <Field label="标题" required description="不超过 20 字" error={form.errors.title}>
        <Input name="title" ref={form.fieldRef('title')} onChange={() => form.clear('title')} />
      </Field>
      <Field label="正文" error={form.errors.body}>
        <Input name="body" ref={form.fieldRef('body')} onChange={() => form.clear('body')} />
      </Field>
      <div>
        <Button type="submit">发送</Button>
      </div>
    </form>
  )
}

/** /dev/ui:Arc 件与项目现有件并排陈列(仅开发环境注册),给 e2e 量尺寸、给人眼对照。 */
export default function UiGallery() {
  return (
    <main>
      <PageContainer>
        <PageHeader
          title="界面件陈列"
          description="Arc 件、项目适配层与骨架件并排陈列,浅色与深色都在这里看。"
          actions={<Button variant="outline">次要操作</Button>}
        />

        <section aria-labelledby="arc-buttons" className="flex flex-col gap-3">
          <h2 id="arc-buttons" className="text-lg font-medium">
            Arc 按钮
          </h2>
          {VARIANTS.map((variant) => (
            <div key={variant} className="flex flex-wrap items-center gap-3">
              {SIZES.map((size) => (
                <ArcButton
                  key={size}
                  variant={variant}
                  size={size}
                  data-testid={
                    variant === 'primary' || (variant === 'secondary' && size === 'md')
                      ? `arc-button-${variant === 'primary' ? '' : 'secondary-'}${size}`
                      : undefined
                  }
                >
                  {variant} {size}
                </ArcButton>
              ))}
              <ArcButton variant={variant} loading>
                加载中
              </ArcButton>
            </div>
          ))}
        </section>

        <section aria-labelledby="arc-badges" className="flex flex-col gap-3">
          <h2 id="arc-badges" className="text-lg font-medium">
            Arc 徽标
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            {TONES.map((tone) => (
              <Badge key={tone} tone={tone} data-testid={`arc-badge-${tone}`}>
                {tone}
              </Badge>
            ))}
            <Badge tone="success" dot>
              带状态点
            </Badge>
          </div>
        </section>

        <section aria-labelledby="arc-tooltip" className="flex flex-col gap-3">
          <h2 id="arc-tooltip" className="text-lg font-medium">
            Arc 提示与骨架
          </h2>
          <div className="flex flex-wrap items-start gap-6">
            <Tooltip content="这是一条提示">
              <ArcButton variant="secondary">悬停看提示</ArcButton>
            </Tooltip>
            <div className="w-64">
              <Skeleton label="加载示例" lines={3} avatar />
            </div>
          </div>
        </section>

        <section aria-labelledby="project-ui" className="flex flex-col gap-3">
          <h2 id="project-ui" className="text-lg font-medium">
            项目现有件(对照)
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button>默认</Button>
            <Button variant="secondary">次要</Button>
            <Button variant="outline">描边</Button>
            <Button variant="ghost">幽灵</Button>
            <Button variant="destructive">删除</Button>
            <Button size="sm">小</Button>
            <Button size="lg">大</Button>
          </div>
          <Card className="max-w-sm" data-testid="card-sample">
            <CardHeader>
              <CardTitle>卡片</CardTitle>
            </CardHeader>
            <CardContent>项目现有 Card,用来对照面板表面。</CardContent>
          </Card>
        </section>

        <section aria-labelledby="skeleton-table" className="flex flex-col gap-3">
          <h2 id="skeleton-table" className="text-lg font-medium">
            表格
          </h2>
          <Table caption="成绩示例" minWidth={480}>
            <TableHead>
              <TableRow>
                <Th>姓名</Th>
                <Th>学号</Th>
                <Th numeric>总分</Th>
                <Th align="end">操作</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {SCORES.map((r) => (
                <TableRow key={r.no}>
                  <Td>{r.name}</Td>
                  <Td>{r.no}</Td>
                  <Td numeric>{r.score}</Td>
                  <Td align="end">
                    <IconButton icon={Pencil} aria-label={`编辑${r.name}`} size="sm" />
                  </Td>
                </TableRow>
              ))}
            </TableBody>
            <TableFoot>
              <TableRow>
                <Td>合计</Td>
                <Td />
                <Td numeric>255.75</Td>
                <Td />
              </TableRow>
            </TableFoot>
          </Table>
          <Table density="compact" caption="紧凑示例">
            <TableHead>
              <TableRow>
                <Th>姓名</Th>
                <Th numeric>总分</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {SCORES.map((r) => (
                <TableRow key={r.no}>
                  <Td>{r.name}</Td>
                  <Td numeric>{r.score}</Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <section aria-labelledby="skeleton-form" className="flex flex-col gap-3">
          <h2 id="skeleton-form" className="text-lg font-medium">
            表单与选择控件
          </h2>
          <FieldDemo />
          <div className="flex flex-wrap items-center gap-3">
            <Input aria-label="默认输入框" placeholder="md 40" className="w-40" />
            <Input aria-label="小输入框" controlSize="sm" placeholder="sm 32" className="w-40" />
            <NativeSelect aria-label="默认选择" className="w-40">
              <option>md 40</option>
            </NativeSelect>
            <NativeSelect aria-label="小选择" controlSize="sm" className="w-40">
              <option>sm 32</option>
            </NativeSelect>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <Switch label="本周之星" description="在首页展示" />
            <Switch aria-label="已开启" defaultChecked />
            <Checkbox label="全选" />
            <Checkbox label="已选" defaultChecked />
            <IconButton icon={Bell} aria-label="通知" size="sm" />
            <IconButton icon={Bell} aria-label="通知(中)" variant="outline" />
            <IconButton icon={Bell} aria-label="通知(触控)" size="touch" />
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <StatusDot tone="neutral">未开始</StatusDot>
            <StatusDot tone="success">正常</StatusDot>
            <StatusDot tone="warning">待处理</StatusDot>
            <StatusDot tone="danger">异常</StatusDot>
            <StatusDot tone="info">进行中</StatusDot>
          </div>
        </section>

        <section aria-labelledby="skeleton-feedback" className="flex flex-col gap-3">
          <h2 id="skeleton-feedback" className="text-lg font-medium">
            加载与空状态
          </h2>
          <LoadingState />
          <LoadingState variant="table" rows={3} label="读取表格" />
          <LoadingState variant="cards" label="读取卡片" />
          <LoadingState variant="form" label="读取表单" />
          <EmptyState icon={Inbox} title="还没有数据" description="先添加一条" />
          <EmptyState align="center" icon={Inbox} title="居中的空状态" />
        </section>

        <section aria-labelledby="class-override" className="flex flex-col gap-3">
          <h2 id="class-override" className="text-lg font-medium">
            className 覆盖
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" className="text-destructive" data-testid="btn-override-color">
              删除
            </Button>
            <Button size="sm" className="min-h-11" data-testid="btn-override-minh">
              触控
            </Button>
            <Button className="h-11" data-testid="btn-override-h">
              高 44
            </Button>
            <Button className="hidden" data-testid="btn-override-hidden">
              隐藏
            </Button>
            <Button variant="ghost" data-testid="btn-ghost-plain">
              普通
            </Button>
            <span className="text-destructive" data-testid="destructive-ref">
              参照色
            </span>
          </div>
        </section>
      </PageContainer>
      <div data-testid="narrow-sample">
        <PageContainer width="narrow">
          <div data-page-header data-testid="narrow-title" className="text-lg font-medium">
            窄页样例标题
          </div>
          <p data-testid="narrow-body" className="text-sm text-muted-foreground">
            窄页的正文最大宽 768,标题仍然左对齐到默认页的左缘。这一段文字故意写得长一些,
            用来在宽屏下撑满正文列,方便量宽度。
          </p>
        </PageContainer>
      </div>
    </main>
  )
}
