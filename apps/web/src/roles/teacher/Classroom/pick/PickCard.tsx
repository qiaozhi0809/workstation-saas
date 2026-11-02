import Avatar from '@/shared/components/ClassroomMap/art/Avatar'
import { genderOf } from '@/shared/components/ClassroomMap/art/identity'
import { groupColor } from '@/shared/components/ClassroomMap/art/palette'
import { groupOf } from '@/shared/components/ClassroomMap/layout'
import { Button } from '@/shared/components/ui/button'
import { useEscapeLayer } from '@/shared/hooks/useEscapeLayer'
import type { StudentSeat } from '@/shared/types/student'

/** 点名结果卡:屏幕上方居中浮层。seat 为空表示今天没有可点名的同学。 */
export default function PickCard({ seat, presenting = false, canReward, rewarding, onReward, onAgain, onClose }: {
  seat: StudentSeat | null
  /** 投屏时只显示姓名(不投学号、职务) */
  presenting?: boolean
  canReward: boolean
  rewarding: boolean
  onReward(): void
  onAgain(): void
  onClose(): void
}) {
  useEscapeLayer(true, onClose)
  return (
    <div role="dialog" aria-label="随机点名"
      className="absolute left-1/2 top-4 z-20 flex w-[min(360px,calc(100%-2rem))] -translate-x-1/2 flex-col items-center gap-3 rounded-xl border bg-popover px-6 py-4 text-popover-foreground shadow-lg">
      {seat ? (
        <>
          <div className="flex items-center gap-3">
            <Avatar gender={genderOf(seat.gender)} seed={seat.avatar_seed ?? seat.student_id}
              color={groupColor(groupOf(seat.seat_col ?? 1))} size={56} title={seat.name} />
            <div className="flex flex-col leading-6">
              <span className="text-xl font-semibold">{seat.name}</span>
              {!presenting && seat.student_no && <span className="text-sm text-muted-foreground">{`学号 ${seat.student_no}`}</span>}
              {!presenting && seat.class_role && <span className="text-sm text-muted-foreground">{seat.class_role}</span>}
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {canReward && <Button type="button" size="sm" disabled={rewarding} onClick={onReward}>回答得好 +1</Button>}
            <Button type="button" variant="outline" size="sm" disabled={rewarding} onClick={onAgain}>再抽一个</Button>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>关闭</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm">今天没有可点名的同学</p>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>关闭</Button>
        </>
      )}
    </div>
  )
}
