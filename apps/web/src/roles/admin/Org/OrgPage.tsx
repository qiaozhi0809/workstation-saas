import AdminRolesCard from './AdminRolesCard'
import GradesPanel from './GradesPanel'
import SchoolCard from './SchoolCard'
import YearCard from './YearCard'

export default function OrgPage() {
  return (
    <div className="grid gap-4 p-4 md:p-6">
      <h1 className="text-lg font-semibold">组织架构</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <SchoolCard />
        <YearCard />
      </div>
      <GradesPanel />
      <AdminRolesCard />
    </div>
  )
}
