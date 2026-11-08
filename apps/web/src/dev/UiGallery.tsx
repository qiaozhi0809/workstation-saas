import { Badge } from '@/shared/components/arc/badge/badge'
import { Button as ArcButton } from '@/shared/components/arc/button/button'
import { Skeleton } from '@/shared/components/arc/skeleton/skeleton'
import { Tooltip } from '@/shared/components/arc/tooltip/tooltip'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

const VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const
const SIZES = ['sm', 'md', 'lg'] as const
const TONES = ['neutral', 'success', 'info', 'warning', 'danger'] as const

/** /dev/ui:Arc 件与项目现有件并排陈列(仅开发环境注册),给 e2e 量尺寸、给人眼对照。 */
export default function UiGallery() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-medium">界面件陈列</h1>

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
                data-testid={variant === 'primary' ? `arc-button-${size}` : undefined}
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
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>卡片</CardTitle>
          </CardHeader>
          <CardContent>项目现有 Card,用来对照面板表面。</CardContent>
        </Card>
      </section>
    </main>
  )
}
