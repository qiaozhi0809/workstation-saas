import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { preferencesApi } from '@/shared/api/preferences'
import { reviewsApi } from '@/shared/api/reviews'
import { studentsApi } from '@/shared/api/students'
import ClassroomMap from '@/shared/components/ClassroomMap'
import type {
  ClassroomEffects, ClassroomMapProps, ClassroomViewportHandle, SeatView,
} from '@/shared/components/ClassroomMap/types'
import { useAuthStore } from '@/shared/stores/auth'
import { confirmLeaveSeating, useTeacherStore } from '@/shared/stores/teacher'
import type { ClassView } from '@/shared/types/class'
import type { ClassPerm } from '@/shared/types/classroom'
import type { StudentSeat } from '@/shared/types/student'
import { pickPool } from './pick/pickLogic'
import PickCard from './pick/PickCard'
import { usePick, usePickReward } from './pick/usePick'
import { attendanceApi } from '@/shared/api/attendance'
import { useAttendanceMode } from './attendance/useAttendanceMode'
import { useReviewMode } from './review/useReviewMode'
import { useReviewSubject } from './review/useReviewSubmit'
import BoardEditor from './BoardEditor'
import SeatingBar from './seating/SeatingBar'
import UnseatedTray from './seating/UnseatedTray'
import { useSeatingMode } from './seating/useSeatingMode'
import { buildBoard } from './buildBoard'
import { useIdleActions } from './idle/useIdleActions'
import OverviewRail from './rail/OverviewRail'
import ModeBar, { modesFor, type ClassroomUiMode } from './ModeBar'
import Toolbar, { toolButton } from './Toolbar'
import { useAttendanceDate } from './useAttendanceDate'
import { useFullscreen } from './useFullscreen'

const NO_PERMS: ClassPerm[] = []
const NO_SUBJECTS: string[] = []
const RAIL_MIN_WIDTH = 1100
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => !!window.matchMedia?.(REDUCED_MOTION).matches)
  useEffect(() => {
    const mql = window.matchMedia?.(REDUCED_MOTION)
    if (!mql) return
    const on = () => setReduced(mql.matches)
    mql.addEventListener?.('change', on)
    return () => mql.removeEventListener?.('change', on)
  }, [])
  return reduced
}

// 讲台姓名牌上的身份:有排座权的是班主任,能记考勤的是副班主任,其余是任课老师
const roleLabel = (perms: readonly ClassPerm[]) =>
  perms.includes('seating.write') ? '班主任' : perms.includes('attendance.write') ? '副班主任' : '任课老师'

/** 每个模式往地图和工具栏里接的东西;没有给出的项按地图默认处理(例如不传 onSeatClick 座位就不可点)。 */
interface ModeSlot {
  seats?: StudentSeat[]
  /** 覆盖班级行列(排座草稿可改行列) */
  rows?: number
  cols?: number
  views?: Record<string, SeatView>
  effects?: ClassroomEffects
  onSeatClick?: ClassroomMapProps['onSeatClick']
  onEmptySeatClick?: ClassroomMapProps['onEmptySeatClick']
  onSeatDrop?: ClassroomMapProps['onSeatDrop']
  /** 工具栏里的模式附加按钮 */
  toolbar?: ReactNode
  /** 工具栏下方、地图上方的模式操作条 */
  bar?: ReactNode
}

export default function ClassroomPage() {
  const classId = useTeacherStore((s) => s.classId)
  const classes = useQuery({ queryKey: ['my-classes'], queryFn: classesApi.mine })

  if (classes.isLoading) return <div className="p-6">加载中…</div>
  if (classes.isError) return <div className="p-6">班级加载失败</div>
  const items = classes.data?.items ?? []
  if (items.length === 0) return <div className="p-6">没有可查看的班级</div>
  const cls = classId ? items.find((c) => c.id === classId) : undefined
  if (!cls) return <div className="p-6">加载中…</div>

  // 换班级时整页重建:模式、考勤日期、概况栏开关等按班级重新开始
  return <ClassroomView key={cls.id} cls={cls} />
}

function ClassroomView({ cls }: { cls: ClassView }) {
  const classId = cls.id
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const displayName = useAuthStore((s) => s.user?.display_name)

  const rootRef = useRef<HTMLDivElement>(null)
  const viewport = useRef<ClassroomViewportHandle>(null)
  const { active: presenting, toggle: togglePresent } = useFullscreen(rootRef)
  const [editingBoard, setEditingBoard] = useState(false)
  const [railOpen, setRailOpen] = useState(() => window.innerWidth >= RAIL_MIN_WIDTH)

  const roster = useQuery({
    queryKey: ['class-students', classId],
    queryFn: () => studentsApi.listInClass(classId),
  })
  // 概况带着学校"今天":每分钟和回到窗口时刷新,过了零点黑板、考勤日期随之换天
  const summary = useQuery({
    queryKey: ['classroom', classId],
    queryFn: () => classroomApi.summary(classId),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
  const preferences = useQuery({ queryKey: ['preferences'], queryFn: preferencesApi.get })
  const perms = summary.data?.my_perms ?? NO_PERMS
  const reviewSummary = useQuery({
    queryKey: ['review-summary', classId],
    queryFn: () => reviewsApi.summary(classId),
    enabled: perms.includes('review.read'),
  })

  const requested = params.get('mode')
  const mode: ClassroomUiMode = modesFor(perms).find((m) => m === requested) ?? 'daily'

  const today = summary.data?.today
  const board = useMemo(
    () => (summary.data && today && roster.data
      ? buildBoard({ className: cls.name, today, summary: summary.data, roster: roster.data.items, reviewSummary: reviewSummary.data })
      : undefined),
    [cls.name, today, summary.data, roster.data, reviewSummary.data],
  )
  const figure = preferences.data?.teacher_figure ?? 'female'
  const label = summary.data
    ? [displayName, roleLabel(perms)].filter(Boolean).join(' · ')
    : displayName ?? ''
  const teacher = useMemo(() => ({ figure, label }), [figure, label])

  const openProfile = useCallback<NonNullable<ModeSlot['onSeatClick']>>(
    (s) => navigate('/teacher/students/' + s.student_id),
    [navigate],
  )
  // 投屏时只展示姓名:档案抽屉在全屏根元素之外,不能在投屏中打开(退出全屏时会把档案亮在投影上)
  // 考勤日期跟随服务端的学校"今天",不用浏览器时钟;日常/考勤/点评叠加当天考勤外观,排座不叠加
  const attDate = useAttendanceDate(today)
  const attendance = useAttendanceMode({
    classId,
    className: cls.name,
    date: attDate.date,
    canWrite: perms.includes('attendance.write'),
    enabled: mode !== 'seating',
    today,
    yearStart: summary.data?.year.start_date,
    timezone: summary.data?.timezone,
    roster: roster.data?.items ?? [],
    onPickDate: attDate.pick,
    onFollowToday: attDate.followToday,
  })
  const stageRef = useRef<HTMLDivElement>(null)
  // 当前科目在页面级:点评弹层、全班 +1、点名"回答得好 +1"共用
  const subject = useReviewSubject(perms, summary.data?.my_subjects ?? NO_SUBJECTS)
  const review = useReviewMode({
    classId,
    className: cls.name,
    enabled: mode === 'review',
    canRead: perms.includes('review.read'),
    canWrite: perms.includes('review.write'),
    reasons: preferences.data?.review_reasons,
    subject,
    roster: roster.data?.items ?? [],
    timezone: summary.data?.timezone,
    summary: reviewSummary.data,
    overlay: attendance.views,
    stageRef,
  })
  // 点名候选池固定用学校"今天"的考勤(与考勤模式正在看的日期无关,缓存键相同所以共用),且只含已排座的同学
  const todayAttendance = useQuery({
    queryKey: ['attendance', classId, today],
    queryFn: () => attendanceApi.day(classId, today!),
    enabled: !!today,
  })
  const pool = useMemo(() => {
    const status = new Map((todayAttendance.data?.items ?? []).map((i) => [i.enrollment_id, i.status]))
    return pickPool(roster.data?.items ?? [], (id) => status.get(id))
  }, [todayAttendance.data, roster.data])
  const pick = usePick({ pool })
  const seating = useSeatingMode({
    classId,
    className: cls.name,
    enabled: mode === 'seating',
  })
  // 离开排座前确认未保存的修改;进入排座时收起点名(聚光灯 / 指向不落在排座地图上)
  const setMode = (next: ClassroomUiMode) => {
    if (mode === 'seating' && !confirmLeaveSeating()) return
    if (next === 'seating') pick.close()
    setParams(next === 'daily' ? {} : { mode: next }, { replace: true })
  }
  const pickReward = usePickReward(classId, subject.value, pick.close)
  const pickedSeat = roster.data?.items.find((s) => s.enrollment_id === pick.pickedId) ?? null
  const cardOpen = pick.state === 'picked' || pick.state === 'empty'
  // 点名进行中(转动或结果卡打开):Task 21 据此暂停空闲动画
  const picking = pick.state === 'spinning' || cardOpen
  const canPick = mode !== 'seating' && todayAttendance.isSuccess && !!roster.data
  const overlay = mode === 'seating' ? undefined : attendance.views
  let slot: ModeSlot = {}
  if (mode === 'daily') slot = { views: overlay, onSeatClick: presenting ? undefined : openProfile }
  else if (mode === 'attendance') slot = { views: overlay, onSeatClick: attendance.onSeatClick, bar: attendance.bar }
  else if (mode === 'review') {
    slot = {
      views: review.views, effects: { floats: review.floats }, toolbar: review.toolbar,
      onSeatClick: presenting ? undefined : review.onSeatClick,
    }
  } else if (mode === 'seating' && seating.ready) {
    slot = {
      seats: seating.seats, rows: seating.rows, cols: seating.cols, views: seating.views,
      onSeatClick: seating.onSeatClick, onEmptySeatClick: seating.onEmptySeatClick, onSeatDrop: seating.onSeatDrop,
      bar: <><SeatingBar {...seating.bar} /><UnseatedTray {...seating.tray} /></>,
    }
  } else if (mode === 'seating') {
    // 草稿就绪前地图只读
    slot = {
      bar: seating.failed ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-red">
          座位表加载失败
          <button type="button" className={toolButton} onClick={seating.retry}>重新加载</button>
        </div>
      ) : <p className="text-sm text-ink-2">座位表加载中…</p>,
    }
  }

  const reducedMotion = usePrefersReducedMotion()
  const seatedIds = useMemo(
    () => (roster.data?.items ?? []).filter((s) => s.seat_row != null && s.seat_col != null).map((s) => s.enrollment_id),
    [roster.data],
  )
  const { idle, teacher: idleTeacher } = useIdleActions({
    ids: seatedIds,
    enabled: !!preferences.data?.idle_animation && !reducedMotion && mode !== 'seating',
    paused: picking,
  })
  const pickEffects: ClassroomEffects = {
    ...slot.effects,
    idle,
    spotlightId: pick.spotlightId,
    pickedId: pick.pickedId,
    teacher: pick.pickedId ? 'point' : slot.effects?.teacher ?? idleTeacher,
  }

  let stage: ReactNode
  if (roster.isError) stage = <div className="p-6">名单加载失败</div>
  else if (!roster.data || summary.isPending) stage = <div className="p-6">加载中…</div>
  else {
    stage = (
      <ClassroomMap
        rows={slot.rows ?? cls.seat_rows}
        cols={slot.cols ?? cls.seat_cols}
        seats={slot.seats ?? roster.data.items}
        mode={mode}
        teacher={teacher}
        board={board}
        views={slot.views}
        effects={pickEffects}
        presenting={presenting}
        onSeatClick={slot.onSeatClick}
        onEmptySeatClick={slot.onEmptySeatClick}
        onSeatDrop={slot.onSeatDrop}
        viewportRef={viewport}
      />
    )
  }

  return (
    <div ref={rootRef} className="flex h-full min-h-[640px] gap-4 bg-[#f5f5f4] p-4">
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        {!presenting && (
          <header>
            <h2 className="text-xl font-semibold">{cls.name}</h2>
            {summary.data ? (
              <p className="text-sm text-ink-2">{`${cls.grade_name} · ${summary.data.year.name} 第 ${summary.data.week_no} 周`}</p>
            ) : summary.isError ? (
              <p role="alert" className="text-sm text-red">班级概况加载失败</p>
            ) : (
              <p className="text-sm text-ink-2">{cls.grade_name}</p>
            )}
          </header>
        )}
        <Toolbar
          onPick={canPick ? pick.start : undefined}
          picking={picking}
          viewport={viewport}
          presenting={presenting}
          onTogglePresent={togglePresent}
          railOpen={railOpen}
          onToggleRail={() => setRailOpen((o) => !o)}
          extra={<>
            {perms.includes('board.write') && !presenting && summary.data && (
              <button type="button" className={toolButton} onClick={() => setEditingBoard(true)}>编辑黑板</button>
            )}
            {slot.toolbar}
          </>}
        />
        {slot.bar}
        {/* 弹层锚点是点击瞬间的快照:在舞台上按下或滚轮平移 / 缩放时先关掉弹层 */}
        <div
          ref={stageRef}
          className="relative min-h-[480px] flex-1 overflow-hidden rounded-2xl border border-line bg-panel"
          onPointerDownCapture={(e) => {
            if (!(e.target instanceof Element && e.target.closest('[role="dialog"]'))) review.closePopover()
          }}
          onWheel={review.closePopover}
        >
          {stage}
          {review.popover}
          {cardOpen && (
            <PickCard
              seat={pick.state === 'picked' ? pickedSeat : null}
              canReward={perms.includes('review.write')}
              rewarding={pickReward.pending}
              onReward={() => pick.pickedId && pickReward.reward(pick.pickedId)}
              onAgain={pick.start}
              onClose={pick.close}
            />
          )}
        </div>
        {review.leaderboard}
        <ModeBar mode={mode} perms={perms} onChange={setMode} />
      </section>
      {editingBoard && summary.data && (
        <BoardEditor classId={classId} board={summary.data.board} onClose={() => setEditingBoard(false)} />
      )}
      {railOpen && !presenting && summary.data && roster.data && (
        <OverviewRail
          classId={classId}
          summary={summary.data}
          roster={roster.data?.items ?? []}
          perms={perms}
          todayAttendance={todayAttendance.data}
          onRollCall={() => { if (mode !== 'attendance') setMode('attendance') }}
        />
      )}
    </div>
  )
}
