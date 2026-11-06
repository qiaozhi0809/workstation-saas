import GradingCard from './GradingCard'
import SecurityCard from './SecurityCard'
import SubjectCatalogCard from './SubjectCatalogCard'
import SwitchesCard from './SwitchesCard'
import SystemCard from './SystemCard'
import TagPoolCard from './TagPoolCard'

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
      <h1 className="text-lg font-semibold">学校设置</h1>
      <TagPoolCard />
      <GradingCard />
      <SubjectCatalogCard />
      <SwitchesCard />
      <SecurityCard />
      <SystemCard />
    </div>
  )
}
