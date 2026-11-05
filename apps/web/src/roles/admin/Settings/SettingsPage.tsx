import SwitchesCard from './SwitchesCard'
import SystemCard from './SystemCard'
import TagPoolCard from './TagPoolCard'

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
      <h1 className="text-lg font-semibold">学校设置</h1>
      <TagPoolCard />
      <SwitchesCard />
      <SystemCard />
    </div>
  )
}
