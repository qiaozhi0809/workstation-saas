import { PageContainer, PageHeader } from '@/shared/components/ui/page'
import AdminRolesCard from './AdminRolesCard'
import GradesPanel from './GradesPanel'
import SchoolCard from './SchoolCard'
import YearCard from './YearCard'

export default function OrgPage() {
  return (
    <PageContainer width="default">
      <PageHeader title="组织架构" />
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <SchoolCard />
        <YearCard />
      </div>
      <GradesPanel />
      <AdminRolesCard />
    </PageContainer>
  )
}
