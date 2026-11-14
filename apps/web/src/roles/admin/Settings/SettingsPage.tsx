import { PageContainer, PageHeader } from '@/shared/components/ui/page'
import GradingCard from './GradingCard'
import SecurityCard from './SecurityCard'
import SubjectCatalogCard from './SubjectCatalogCard'
import SwitchesCard from './SwitchesCard'
import SystemCard from './SystemCard'
import TagPoolCard from './TagPoolCard'

export default function SettingsPage() {
  return (
    <PageContainer width="narrow">
      <PageHeader title="学校设置" />
      <TagPoolCard />
      <GradingCard />
      <SubjectCatalogCard />
      <SwitchesCard />
      <SecurityCard />
      <SystemCard />
    </PageContainer>
  )
}
