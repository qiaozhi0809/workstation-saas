import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PencilLine, School } from 'lucide-react'
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
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Button } from '@/shared/components/ui/button'
import { useWindowWidth } from '@/shared/hooks/useWindowWidth'
import { useReducedMotion } from '@/shared/hooks/useReducedMotion'
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
import SeatHoverCard from './SeatHoverCard'
import SeatingBar from './seating/SeatingBar'
import UnseatedTray from './seating/UnseatedTray'
import { useSeatingMode } from './seating/useSeatingMode'
import { buildBoard } from './buildBoard'
import { useIdleActions } from './idle/useIdleActions'
import OverviewRail from './rail/OverviewRail'
import ModeBar, { modesFor, type ClassroomUiMode } from './ModeBar'
import Toolbar from './Toolbar'
import { useAttendanceDate } from './useAttendanceDate'
import { useFullscreen } from './useFullscreen'

const NO_PERMS: ClassPerm[] = []
const NO_SUBJECTS: string[] = []
const RAIL_MIN_WIDTH = 1100

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

  if (classes.isLoading) return <LoadingState />
  // 只有从没拿到过数据时才显示错误;后台刷新失败时保留已加载的页面(以及排座草稿)
  if (classes.isError && !classes.data) {
    return <ErrorState title="班级加载失败" onRetry={() => void classes.refetch()} retrying={classes.isFetching} />
  }
  const items = classes.data?.items ?? []
  if (items.length === 0) {
    return <EmptyState icon={School} title="没有可查看的班级" description="请联系学校管理员为你分配班级" />
  }
  const cls = classId ? items.find((c) => c.id === classId) : undefined
  if (!cls) return <LoadingState />

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
  const width = useWindowWidth()
  const [railOpen, setRailOpen] = useState(() => window.innerWidth >= RAIL_MIN_WIDTH)
  const railButtonRef = useRef<HTMLButtonElement>(null)
  const overlayRail = width < RAIL_MIN_WIDTH
  const closeRail = () => { setRailOpen(false); railButtonRef.current?.focus() }

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
    // 投屏时不把考勤投到屏幕上
    overlay: presenting ? undefined : attendance.views,
    presenting,
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
  // 悬停卡:今日考勤固定看学校"今天"(与考勤模式正在看的日期无关),本周积分要有 review.read 才有
  const renderHoverCard = useCallback<NonNullable<ClassroomMapProps['renderHoverCard']>>((s) => {
    const status = todayAttendance.data
      ? todayAttendance.data.items.find((i) => i.enrollment_id === s.enrollment_id)?.status ?? 'present'
      : undefined
    const week = reviewSummary.data
      ? reviewSummary.data.items.find((t) => t.enrollment_id === s.enrollment_id)?.week ?? 0
      : undefined
    return <SeatHoverCard seat={s} attendance={status} week={week} />
  }, [todayAttendance.data, reviewSummary.data])
  const seating = useSeatingMode({
    classId,
    className: cls.name,
    enabled: mode === 'seating',
  })
  // 离开排座前确认未保存的修改;进入排座时收起点名(聚光灯 / 指向不落在排座地图上)
  const setMode = (next: ClassroomUiMode) => {
    if (mode === 'seating' && !confirmLeaveSeating()) return
    if (next === 'seating') pick.close()
    // 离开考勤模式时考勤日期回到学校今天,日常 / 点评叠加的是今天的考勤
    if (mode === 'attendance' && next !== 'attendance') attDate.followToday()
    // 同步切换:路由默认在 transition 里更新,渲染较慢时模式条和地图会停在旧模式,点击落到旧模式上
    setParams(next === 'daily' ? {} : { mode: next }, { replace: true, flushSync: true })
  }
  const pickReward = usePickReward(classId, subject.value, pick.close)
  const pickedSeat = roster.data?.items.find((s) => s.enrollment_id === pick.pickedId) ?? null
  const cardOpen = pick.state === 'picked' || pick.state === 'empty'
  // 点名进行中(转动或结果卡打开):Task 21 据此暂停空闲动画
  const picking = pick.state === 'spinning' || cardOpen
  const canPick = mode !== 'seating' && !!todayAttendance.data && !!roster.data
  const overlay = mode === 'seating' ? undefined : attendance.views
  let slot: ModeSlot = {}
  // 日常 / 点评模式投屏时不叠加考勤(请假等不上投影);考勤模式是老师主动进入的,照常显示
  if (mode === 'daily') slot = { views: presenting ? undefined : overlay, onSeatClick: presenting ? undefined : openProfile }
  else if (mode === 'attendance') slot = { views: overlay, onSeatClick: attendance.onSeatClick, bar: attendance.bar }
  else if (mode === 'review') {
    slot = {
      views: review.views, effects: { floats: review.floats }, toolbar: review.toolbar,
      // 投屏时也能点评:飘字本来就是给投影看的
      onSeatClick: review.onSeatClick,
    }
  } else if (mode === 'seating' && seating.ready) {
    slot = {
      seats: seating.seats, rows: seating.rows, cols: seating.cols, views: seating.views,
      onSeatClick: seating.onSeatClick, onEmptySeatClick: seating.onEmptySeatClick, onSeatDrop: seating.onSeatDrop,
      bar: <><SeatingBar {...seating.bar} /><UnseatedTray {...seating.tray} /></>,
    }
  } else if (mode === 'seating' && seating.failed) {
    // 草稿加载失败:地图只读,给出重试
    slot = {
      bar: (
        <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
          座位表加载失败
          <Button variant="outline" size="sm" onClick={seating.retry}>重新加载</Button>
        </div>
      ),
    }
  }
  // 排座草稿加载 / 保存中地图只读:工具栏显示状态,舞台上提示为什么点不动
  const seatingPending = mode === 'seating' && !seating.failed ? seating.pending ?? (seating.ready ? null : 'loading') : null

  const reducedMotion = useReducedMotion()
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
  if (roster.isError && !roster.data) stage = <ErrorState title="名单加载失败" onRetry={() => void roster.refetch()} retrying={roster.isFetching} />
  else if (!roster.data || summary.isPending) stage = <LoadingState />
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
        renderHoverCard={renderHoverCard}
        onSeatClick={slot.onSeatClick}
        onEmptySeatClick={slot.onEmptySeatClick}
        onSeatDrop={slot.onSeatDrop}
        viewportRef={viewport}
      />
    )
  }

  return (
    // 高度跟着窗口走:1024×768 的投影下各模式都不用滚动页面,舞台吃掉剩余高度(排座的操作条多,舞台就矮一些)
    <div ref={rootRef} className="relative flex h-full gap-4 bg-muted/40 p-3 lg:p-4">
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        {!presenting && (
          <header>
            <h2 className="text-xl font-semibold tracking-tight">{cls.name}</h2>
            {summary.data ? (
              <p className="text-sm text-muted-foreground">{`${cls.grade_name} · ${summary.data.year.name} 第 ${summary.data.week_no} 周`}</p>
            ) : summary.isError ? (
              <p role="alert" className="text-sm text-destructive">班级概况加载失败</p>
            ) : (
              <p className="text-sm text-muted-foreground">{cls.grade_name}</p>
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
          railButtonRef={railButtonRef}
          extra={<>
            {perms.includes('board.write') && !presenting && summary.data && (
              <Button variant="outline" size="sm" onClick={() => setEditingBoard(true)}>
                <PencilLine aria-hidden="true" />编辑黑板
              </Button>
            )}
            {slot.toolbar}
          </>}
          status={seatingPending === 'saving' ? '保存中…' : seatingPending === 'loading' ? '加载中…' : undefined}
        />
        {slot.bar}
        {/* 弹层锚点是点击瞬间的快照:在舞台上按下或滚轮平移 / 缩放时先关掉弹层 */}
        <div
          ref={stageRef}
          data-testid="classroom-stage"
          aria-busy={seatingPending ? true : undefined}
          className={`relative min-h-[240px] flex-1 overflow-hidden rounded-xl border bg-card ${
            seatingPending ? 'cursor-progress' : ''}`}
          onPointerDownCapture={(e) => {
            if (!(e.target instanceof Element && e.target.closest('[role="dialog"]'))) review.closePopover()
          }}
          onWheel={review.closePopover}
        >
          {stage}
          {seatingPending && (
            // 工具栏的 status 已经朗读,这里只做可见提示
            <p aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-foreground/80 px-3 py-1 text-sm text-background">
              {seatingPending === 'saving' ? '正在保存,暂时不能调整座位' : '座位表加载中,暂时不能调整座位'}
            </p>
          )}
          {review.popover}
          {cardOpen && (
            <PickCard
              seat={pick.state === 'picked' ? pickedSeat : null}
              presenting={presenting}
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
          variant={overlayRail ? 'overlay' : 'inline'}
          onClose={closeRail}
          onRollCall={() => {
            if (mode !== 'attendance') setMode('attendance')
            // 窄屏浮层会盖住座位图,点名要点座位,所以一并收起
            if (overlayRail) closeRail()
          }}
        />
      )}
    </div>
  )
}
