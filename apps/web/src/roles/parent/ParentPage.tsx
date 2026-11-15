import type { ReactNode } from 'react'
import { PageContainer } from '@/shared/components/ui/page'

/** 家长端页面容器:例外保持 max-w-2xl(672,含左右内边距),手机 / 平板单列阅读 */
export default function ParentPage({ children }: { children: ReactNode }) {
  return <PageContainer className="max-w-2xl">{children}</PageContainer>
}
