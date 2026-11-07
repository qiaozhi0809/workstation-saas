import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { classesApi } from '@/shared/api/classes'
import { ApiError } from '@/shared/api/client'
import { preferencesApi, type PreferencesWithOnboarded } from '@/shared/api/preferences'
import CrDefs from '@/shared/components/ClassroomMap/art/CrDefs'
import Podium from '@/shared/components/ClassroomMap/art/Podium'
import { ROOM } from '@/shared/components/ClassroomMap/art/palette'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'
import { useAuthStore } from '@/shared/stores/auth'
import type { Preferences } from '@/shared/types/preferences'

type Figure = Preferences['teacher_figure']

const FIGURES: readonly [Figure, string][] = [
  ['female', '女老师'],
  ['male', '男老师'],
]

const INTRO = [
  '教室:点名、点评、排座',
  '成绩与 AI:录成绩、看分析,让 AI 帮你备课、写评语',
  '家长与通知:发班级公告,家长在手机上就能看到孩子的出勤、点评和成绩',
]

// 讲台场景的画布:人物站在讲桌后(头顶到地台下沿),与教室里的画法完全一致
const VIEW = { w: 200, h: 190 }
const STAGE = { x: 8, y: 56, w: 184, h: 140 }

function FigurePreview({ figure, label }: { figure: Figure; label: string }) {
  // 两张卡各自一份 <defs>:滤镜 id 由 useId 派生,彼此不同,也不占用同页教室 svg 的 crShadow(L241)
  const shadowId = `crShadow-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  return (
    <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className="h-auto w-full" aria-hidden="true">
      <CrDefs id={shadowId} />
      <rect width={VIEW.w} height={VIEW.h} rx={12} fill={ROOM.floor} />
      <Podium rect={STAGE} teacher={{ figure, label }} action="idle" shadowId={shadowId} />
    </svg>
  )
}

/** 只取偏好本身:不把 GET 回来的 onboarded 原样发回去(R7:键必须是自己拥有的语境) */
const bodyOf = (p: Preferences): Preferences => ({
  teacher_figure: p.teacher_figure,
  idle_animation: p.idle_animation,
  review_reasons: p.review_reasons,
})

const failText = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback

/**
 * 老师首次进入的欢迎页:选形象 + 三行介绍。状态存后端 preferences.onboarded.teacher(Review Focus #3),
 * 偏好没加载成功或后端还没有 onboarded 字段时一律不弹;关掉和点「开始」都算完成。
 */
export default function WelcomeDialog() {
  const queryClient = useQueryClient()
  const name = useAuthStore((s) => s.user?.display_name) ?? ''
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: preferencesApi.get })
  // 与 TeacherLayout / ClassGate 同一个 key,共用缓存;只用来决定结尾那句话(L242)
  const classes = useQuery({ queryKey: ['my-classes'], queryFn: classesApi.mine })
  const [dismissed, setDismissed] = useState(false)
  const [picked, setPicked] = useState<Figure | null>(null)

  // 没加载成功 / 旧后端没有 onboarded / 已完成:都不弹
  const data = prefs.data
  if (dismissed || !data?.onboarded || data.onboarded.teacher) return null
  const figure = picked ?? data.teacher_figure
  // 老师一个班都没有时(ClassGate 会显示"没有可查看的班级"),"班级已经配置好"不成立
  const noClass = classes.data?.items.length === 0

  const pick = (value: Figure) => {
    // 再点已选中的形象:什么也不发(L243)
    if (value === figure) return
    setPicked(value)
    preferencesApi
      .save({ ...bodyOf(data), teacher_figure: value })
      .then((saved) =>
        // 只换形象,不覆盖可能已经写进缓存的 onboarded(两次保存先后到达时不回退)
        queryClient.setQueryData<PreferencesWithOnboarded>(['preferences'], (old) => ({
          ...(old ?? saved),
          teacher_figure: saved.teacher_figure,
        })),
      )
      .catch((err: unknown) => toast(failText(err, '形象没保存上,可以在「我的偏好」里再改')))
  }

  const finish = () => {
    setDismissed(true)
    preferencesApi
      .save({
        ...bodyOf(data),
        teacher_figure: figure,
        onboarded: { teacher: new Date().toISOString() },
      })
      .then((saved) => queryClient.setQueryData(['preferences'], saved))
      .catch((err: unknown) => toast(failText(err, '没记住你已看过欢迎页,下次进入会再显示一次')))
  }

  return (
    <Modal
      open
      onClose={finish}
      title={name ? `你好,${name}` : '你好'}
      description="先选一个你的形象,它会站在教室讲台上"
      className="max-w-xl"
    >
      <div className="grid grid-cols-2 gap-3">
        {FIGURES.map(([value, label]) => {
          const selected = figure === value
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              onClick={() => pick(value)}
              className={cn(
                'flex min-w-0 flex-col items-center gap-2 rounded-xl border-2 p-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                selected
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <FigurePreview figure={value} label={name} />
              {label}
            </button>
          )
        })}
      </div>
      <ul className="space-y-1.5 text-sm leading-relaxed text-foreground">
        {INTRO.map((line) => (
          <li key={line} className="flex gap-2">
            <span
              aria-hidden="true"
              className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
            />
            <span className="min-w-0">{line}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        {noClass
          ? '学校还没有给你分配班级,进入后会看到提示'
          : '你的班级已经由学校配置好,点「开始」进入教室'}
      </p>
      <div className="flex justify-end">
        <Button type="button" className="w-full sm:w-auto" onClick={finish}>
          开始
        </Button>
      </div>
    </Modal>
  )
}
