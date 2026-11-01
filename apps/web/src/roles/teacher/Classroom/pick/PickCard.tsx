import Avatar from '@/shared/components/ClassroomMap/art/Avatar'
import { genderOf } from '@/shared/components/ClassroomMap/art/identity'
import { groupColor } from '@/shared/components/ClassroomMap/art/palette'
import { groupOf } from '@/shared/components/ClassroomMap/layout'
import { useEscapeLayer } from '@/shared/hooks/useEscapeLayer'
import type { StudentSeat } from '@/shared/types/student'

const btn =
  'rounded-lg border border-line-2 px-3 py-1 text-sm hover:bg-fill disabled:cursor-not-allowed disabled:opacity-50'

/** 点名结果卡:屏幕上方居中浮层。seat 为空表示今天没有可点名的同学。 */
export default function PickCard({ seat, canReward, rewarding, onReward, onAgain, onClose }: {
  seat: StudentSeat | null
  canReward: boolean
  rewarding: boolean
  onReward(): void
  onAgain(): void
  onClose(): void
}) {
  useEscapeLayer(true, onClose)
  return (
    <div role="dialog" aria-label="随机点名"
      className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 flex-col items-center gap-3 rounded-2xl border border-line bg-panel px-6 py-4 shadow-lg">
      {seat ? (
        <>
          <div className="flex items-center gap-3">
            <Avatar gender={genderOf(seat.gender)} seed={seat.avatar_seed ?? seat.student_id}
              color={groupColor(groupOf(seat.seat_col ?? 1))} size={56} title={seat.name} />
            <div className="flex flex-col leading-6">
              <span className="text-xl font-semibold">{seat.name}</span>
              {seat.student_no && <span className="text-sm text-ink-2">{`学号 ${seat.student_no}`}</span>}
              {seat.class_role && <span className="text-sm text-ink-2">{seat.class_role}</span>}
            </div>
          </div>
          <div className="flex gap-2">
            {canReward && <button type="button" className={btn} disabled={rewarding} onClick={onReward}>回答得好 +1</button>}
            <button type="button" className={btn} disabled={rewarding} onClick={onAgain}>再抽一个</button>
            <button type="button" className={btn} onClick={onClose}>关闭</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm">今天没有可点名的同学</p>
          <button type="button" className={btn} onClick={onClose}>关闭</button>
        </>
      )}
    </div>
  )
}
