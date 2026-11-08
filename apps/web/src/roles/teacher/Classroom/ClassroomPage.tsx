import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dices, PencilLine, School } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStudentDrawer } from '../StudentProfile/useStudentDrawer'
import { classesApi } from '@/shared/api/classes'
import { examsApi } from '@/shared/api/exams'
import { classroomApi } from '@/shared/api/classroom'
import { preferencesApi } from '@/shared/api/preferences'
import { reviewsApi } from '@/shared/api/reviews'
import { studentsApi } from '@/shared/api/students'
import ClassroomMap from '@/shared/components/ClassroomMap'
import type {
  AttendanceBoardData,
  ClassroomEffects,
  ClassroomMapProps,
  ClassroomViewportHandle,
  SeatView,
} from '@/shared/components/ClassroomMap/types'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { MenuItem } from '@/shared/components/overlay/Menu'
import { Button } from '@/shared/components/ui/button'
import { examTable, latestExam } from '@/shared/lib/grades'
import { groupOf } from '@/shared/lib/seats'
import { useReducedMotion } from '@/shared/hooks/useReducedMotion'
import { useAuthStore } from '@/shared/stores/auth'
import { confirmLeave, useTeacherStore } from '@/shared/stores/teacher'
import type { ClassView } from '@/shared/types/class'
import type { ClassPerm } from '@/shared/types/classroom'
import type { StudentSeat } from '@/shared/types/student'
import { pickPool } from './pick/pickLogic'
import PickCard from './pick/PickCard'
import { usePick, usePickReward } from './pick/usePick'
import { attendanceApi } from '@/shared/api/attendance'
import { useAttendanceMode } from './attendance/useAttendanceMode'
import { useGradesMode } from './grades/useGradesMode'
import { useReviewMode } from './review/useReviewMode'
import { useReviewSubject } from './review/useReviewSubmit'
import BoardEditor from './BoardEditor'
import SeatHoverCard from './SeatHoverCard'
import SeatingBar, { SeatingMenuItems } from './seating/SeatingBar'
import UnseatedTray from './seating/UnseatedTray'
import { useSeatingMode } from './seating/useSeatingMode'
import ClassSettingsDialog from './settings/ClassSettingsDialog'
import { buildBoard } from './buildBoard'
import { useIdleActions } from './idle/useIdleActions'
import SidePanel from '@/shared/components/overlay/SidePanel'
import TodoSection from './panel/TodoSection'
import FeedSection from './panel/FeedSection'
import ExamSection from './panel/ExamSection'
import { modesFor, type ClassroomUiMode } from './ModeBar'
import CameraStrip from './CameraStrip'
import ClassroomDock from './ClassroomDock'
import { useAttendanceDate } from './useAttendanceDate'
import { useFullscreen } from './useFullscreen'

const NO_PERMS: ClassPerm[] = []
const NO_SUBJECTS: string[] = []
const NO_ROSTER: StudentSeat[] = []

// 讲台姓名牌上的身份:有排座权的是班主任,能记考勤的是副班主任,其余是任课老师
const roleLabel = (perms: readonly ClassPerm[]) =>
  perms.includes('seating.write')
    ? '班主任'
    : perms.includes('attendance.write')
      ? '副班主任'
      : '任课老师'

/** 每个模式往地图和工具栏里接的东西;没有给出的项按地图默认处理(例如不传 onSeatClick 座位就不可点)。 */
interface ModeSlot {
  seats?: StudentSeat[]
  /** 覆盖班级行列(排座草稿可改行列) */
  rows?: number
  cols?: number
  deskSize?: ClassView['desk_size']
  podium?: { left: number; right: number }
  views?: Record<string, SeatView>
  effects?: ClassroomEffects
  onSeatClick?: ClassroomMapProps['onSeatClick']
  onEmptySeatClick?: ClassroomMapProps['onEmptySeatClick']
  onSeatDrop?: ClassroomMapProps['onSeatDrop']
  /** 操作台里的当前模式操作 */
  actions?: ReactNode
  /** 操作台"更多操作"菜单里模式自己的项(在随机点名 / 编辑黑板之前) */
  menu?: ReactNode
  /** 舞台下方、操作台上方的托盘(排座:未入座同学) */
  tray?: ReactNode
}

export default function ClassroomPage() {
  const classId = useTeacherStore((s) => s.classId)
  const classes = useQuery({ queryKey: ['my-classes'], queryFn: classesApi.mine })

  if (classes.isLoading) return <LoadingState />
  // 只有从没拿到过数据时才显示错误;后台刷新失败时保留已加载的页面(以及排座草稿)
  if (classes.isError && !classes.data) {
    return (
      <ErrorState
        title="班级加载失败"
        onRetry={() => void classes.refetch()}
        retrying={classes.isFetching}
      />
    )
  }
  const items = classes.data?.items ?? []
  if (items.length === 0) {
    return (
      <EmptyState
        icon={School}
        title="没有可查看的班级"
        description="请联系学校管理员为你分配班级"
      />
    )
  }
  const cls = classId ? items.find((c) => c.id === classId) : undefined
  if (!cls) return <LoadingState />

  // 换班级时整页重建:模式、考勤日期、抽屉开关等按班级重新开始
  return <ClassroomView key={cls.id} cls={cls} />
}

function ClassroomView({ cls }: { cls: ClassView }) {
  const classId = cls.id
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { open: openDrawer } = useStudentDrawer()
  const displayName = useAuthStore((s) => s.user?.display_name)

  const rootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<ClassroomViewportHandle>(null)
  const { active: presenting, toggle: togglePresent } = useFullscreen(rootRef)
  const [editingBoard, setEditingBoard] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // "看看教室"默认收起;换班时整页按 key 重建,自然收起
  const [camerasOpen, setCamerasOpen] = useState(false)
  const [cameraFullscreen, setCameraFullscreen] = useState(false)

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
    () =>
      summary.data && today && roster.data
        ? buildBoard({
            className: cls.name,
            today,
            summary: summary.data,
            roster: roster.data.items,
            reviewSummary: reviewSummary.data,
          })
        : undefined,
    [cls.name, today, summary.data, roster.data, reviewSummary.data],
  )
  // 小组序号与地图着色一致:随桌型、列数,讲台左边第一组、右边最后一组
  // 接口还没带 desk_size 时(后端晚于前端上线)按双人桌算,避免小组序号成 NaN 让头像取色崩溃
  const seatGroup = useCallback(
    (s: StudentSeat) =>
      groupOf(s.seat_col ?? 1, cls.desk_size ?? 2, cls.seat_cols, s.seat_row ?? 1),
    [cls.desk_size, cls.seat_cols],
  )
  const figure = preferences.data?.teacher_figure ?? 'female'
  const label = summary.data
    ? [displayName, roleLabel(perms)].filter(Boolean).join(' · ')
    : (displayName ?? '')
  const teacher = useMemo(() => ({ figure, label }), [figure, label])

  const openProfile = useCallback<NonNullable<ModeSlot['onSeatClick']>>(
    (s) => openDrawer(s.student_id),
    [openDrawer],
  )
  // 投屏时只展示姓名:档案抽屉在全屏根元素之外,不能在投屏中打开(退出全屏时会把档案亮在投影上)
  // 考勤日期跟随服务端的学校"今天",不用浏览器时钟;日常/考勤/点评叠加当天考勤外观,排座不叠加
  const attDate = useAttendanceDate(today)
  const [boardVisible, setBoardVisible] = useState(false)
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
    boardVisible,
    onPickDate: attDate.pick,
    onFollowToday: attDate.followToday,
  })
  const stageRef = useRef<HTMLDivElement>(null)
  const grades = useGradesMode({
    classId,
    enabled: mode === 'grades',
    presenting,
    roster: roster.data?.items ?? NO_ROSTER,
    onOpenScores: (s) => openDrawer(s.student_id, '成绩'),
  })
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
    groupOf: seatGroup,
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
  // 左翼的出勤小牌:考勤模式是正在查看的日期,其余模式是学校"今天";只有汇总数,没加载好就不画
  const boardDay = mode === 'attendance' ? attendance.day : todayAttendance.data
  const boardDate = mode === 'attendance' ? attDate.date : today
  const attendanceBoard = useMemo<AttendanceBoardData | undefined>(() => {
    if (!boardDay || !roster.data || !boardDate || !today) return undefined
    const n = (s: string) => boardDay.items.filter((i) => i.status === s).length
    const total = roster.data.items.length,
      leave = n('leave'),
      absent = n('absent')
    return {
      title:
        boardDate === today
          ? '今日出勤'
          : `${boardDate.slice(5, 7)}/${boardDate.slice(8, 10)} 出勤`,
      present: total - leave - absent,
      total,
      leave,
      absent,
      late: n('late'),
    }
  }, [boardDay, boardDate, today, roster.data])
  const pool = useMemo(() => {
    const status = new Map(
      (todayAttendance.data?.items ?? []).map((i) => [i.enrollment_id, i.status]),
    )
    return pickPool(roster.data?.items ?? [], (id) => status.get(id))
  }, [todayAttendance.data, roster.data])
  const pick = usePick({ pool })
  // 排座"优带弱"用最近一次考试的名次;与成绩模式、侧边面板共用 ['gradebook', classId]
  const canReadExams = perms.includes('exam.read')
  const gradebook = useQuery({
    queryKey: ['gradebook', classId],
    queryFn: () => examsApi.gradebook(classId),
    enabled: canReadExams,
  })
  const ranks = useMemo(() => {
    const latest = canReadExams && gradebook.data ? latestExam(gradebook.data.exams) : null
    if (!latest || !roster.data) return undefined
    const out = new Map<string, number>()
    for (const r of examTable(
      latest,
      roster.data.items.map((s) => s.enrollment_id),
    )) {
      if (r.rank !== null) out.set(r.id, r.rank)
    }
    return out
  }, [canReadExams, gradebook.data, roster.data])
  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const seating = useSeatingMode({
    classId,
    className: cls.name,
    enabled: mode === 'seating',
    ranks,
    onOpenLayout: openSettings,
  })
  // 悬停卡 / 点名卡的小组号与地图着色一致:排座模式地图画的是草稿(桌型、列数),不是已保存的班级设置,
  // 草稿重建的瞬间两者会不同,所以排座就绪时按草稿算
  const draftDesk = seating.ready ? seating.deskSize : null
  const draftCols = seating.ready ? seating.cols : null
  const mapGroup = useCallback(
    (s: StudentSeat) =>
      draftDesk !== null && draftCols !== null
        ? groupOf(s.seat_col ?? 1, draftDesk, draftCols, s.seat_row ?? 1)
        : seatGroup(s),
    [draftDesk, draftCols, seatGroup],
  )
  // 悬停卡:今日考勤固定看学校"今天"(与考勤模式正在看的日期无关),本周积分要有 review.read 才有
  const renderHoverCard = useCallback<NonNullable<ClassroomMapProps['renderHoverCard']>>(
    (s) => {
      const status = todayAttendance.data
        ? (todayAttendance.data.items.find((i) => i.enrollment_id === s.enrollment_id)?.status ??
          'present')
        : undefined
      const week = reviewSummary.data
        ? (reviewSummary.data.items.find((t) => t.enrollment_id === s.enrollment_id)?.week ?? 0)
        : undefined
      return <SeatHoverCard seat={s} attendance={status} week={week} groupOf={mapGroup} />
    },
    [todayAttendance.data, reviewSummary.data, mapGroup],
  )
  // 离开排座前确认未保存的修改;进入排座时收起点名(聚光灯 / 指向不落在排座地图上)
  const setMode = (next: ClassroomUiMode) => {
    if (mode === 'seating' && !confirmLeave(['seating'])) return
    if (next === 'seating') pick.close()
    // 切换模式时收起教室画面(播放器随之销毁)
    setCamerasOpen(false)
    // 离开考勤模式时考勤日期回到学校今天,日常 / 点评叠加的是今天的考勤
    if (mode === 'attendance' && next !== 'attendance') attDate.followToday()
    // 同步切换:路由默认在 transition 里更新,渲染较慢时模式条和地图会停在旧模式,点击落到旧模式上
    // 只动 mode,?student= / ?tab= 等其他参数原样保留
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev)
        if (next === 'daily') out.delete('mode')
        else out.set('mode', next)
        return out
      },
      { replace: true, flushSync: true },
    )
  }
  const pickReward = usePickReward(classId, subject.value, pick.close)
  const pickedSeat = roster.data?.items.find((s) => s.enrollment_id === pick.pickedId) ?? null
  const cardOpen = pick.state === 'picked' || pick.state === 'empty'
  // 点名进行中(转动或结果卡打开):Task 21 据此暂停空闲动画
  const picking = pick.state === 'spinning' || cardOpen
  const canEditBoard = perms.includes('board.write') && !presenting && !!summary.data
  const canSettings = perms.includes('seating.write') && !!summary.data
  // 保存班级设置后名单、教室概况、班级行列都变了;排座模式下草稿也要按新桌椅重建
  const onLayoutSaved = () => {
    for (const key of [
      ['my-classes'],
      ['classroom', classId],
      ['class-students', classId],
      ['student-records', classId],
    ]) {
      void qc.invalidateQueries({ queryKey: key })
    }
    if (mode === 'seating') void seating.reload()
  }
  const goFromSettings = async (to: 'add' | 'import' | 'list') => {
    // 先等班级数据刷新,学生页 / 添加表单才能拿到新的行列
    await qc.invalidateQueries({ queryKey: ['my-classes'] })
    navigate(to === 'list' ? '/teacher/students' : `/teacher/students?action=${to}`)
  }
  const canPick = mode !== 'seating' && !!todayAttendance.data && !!roster.data
  const overlay = mode === 'seating' ? undefined : attendance.views
  let slot: ModeSlot = {}
  // 日常 / 点评模式投屏时不叠加考勤(请假等不上投影);考勤模式是老师主动进入的,照常显示
  if (mode === 'daily')
    slot = {
      views: presenting ? undefined : overlay,
      onSeatClick: presenting ? undefined : openProfile,
    }
  else if (mode === 'attendance')
    slot = {
      views: overlay,
      onSeatClick: attendance.onSeatClick,
      actions: attendance.bar,
      menu: attendance.menu,
    }
  else if (mode === 'review') {
    slot = {
      views: review.views,
      effects: { floats: review.floats },
      actions: review.toolbar,
      // 投屏时也能点评:飘字本来就是给投影看的
      onSeatClick: review.onSeatClick,
    }
  } else if (mode === 'grades') {
    // 成绩模式不叠加考勤外观;投屏时座位不可点(不弹档案)
    slot = { views: grades.views, onSeatClick: grades.onSeatClick, actions: grades.bar }
  } else if (mode === 'seating' && seating.ready) {
    slot = {
      seats: seating.seats,
      rows: seating.rows,
      cols: seating.cols,
      deskSize: seating.deskSize,
      podium: seating.podium,
      views: seating.views,
      onSeatClick: seating.onSeatClick,
      onEmptySeatClick: seating.onEmptySeatClick,
      onSeatDrop: seating.onSeatDrop,
      actions: <SeatingBar {...seating.bar} />,
      menu: <SeatingMenuItems {...seating.bar} />,
      tray: <UnseatedTray {...seating.tray} />,
    }
  } else if (mode === 'seating' && seating.failed) {
    // 草稿加载失败:地图只读,给出重试
    slot = {
      actions: (
        <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
          座位表加载失败
          <Button variant="outline" onClick={seating.retry}>
            重新加载
          </Button>
        </div>
      ),
    }
  }
  // 排座草稿加载 / 保存中地图只读:工具栏显示状态,舞台上提示为什么点不动
  const seatingPending =
    mode === 'seating' && !seating.failed
      ? (seating.pending ?? (seating.ready ? null : 'loading'))
      : null

  const reducedMotion = useReducedMotion()
  const seatedIds = useMemo(
    () =>
      (roster.data?.items ?? [])
        .filter((s) => s.seat_row != null && s.seat_col != null)
        .map((s) => s.enrollment_id),
    [roster.data],
  )
  // 全屏看摄像头(多半在投屏)时舞台不再动
  const { idle, teacher: idleTeacher } = useIdleActions({
    ids: seatedIds,
    enabled: !!preferences.data?.idle_animation && !reducedMotion && mode !== 'seating',
    paused: picking || cameraFullscreen,
  })
  const cameraCount = summary.data?.cameras ?? 0
  // 概况刷新后本班没有可看的摄像头了:收起,之后再有也要老师重新点开
  useEffect(() => {
    if (cameraCount === 0) setCamerasOpen(false)
  }, [cameraCount])
  const pickEffects: ClassroomEffects = {
    ...slot.effects,
    idle,
    spotlightId: pick.spotlightId,
    pickedId: pick.pickedId,
    teacher: pick.pickedId ? 'point' : (slot.effects?.teacher ?? idleTeacher),
  }

  let stage: ReactNode
  if (roster.isError && !roster.data)
    stage = (
      <ErrorState
        title="名单加载失败"
        onRetry={() => void roster.refetch()}
        retrying={roster.isFetching}
      />
    )
  else if (!roster.data || summary.isPending) stage = <LoadingState />
  else {
    stage = (
      <ClassroomMap
        rows={slot.rows ?? cls.seat_rows}
        cols={slot.cols ?? cls.seat_cols}
        deskSize={slot.deskSize ?? cls.desk_size}
        podium={slot.podium ?? { left: cls.podium_left, right: cls.podium_right }}
        seats={slot.seats ?? roster.data.items}
        mode={mode}
        teacher={teacher}
        board={board}
        attendanceBoard={attendanceBoard}
        onAttendanceBoardVisibleChange={setBoardVisible}
        views={slot.views}
        effects={pickEffects}
        presenting={presenting}
        renderHoverCard={renderHoverCard}
        onSeatClick={slot.onSeatClick}
        onEmptySeatClick={slot.onEmptySeatClick}
        onSeatDrop={slot.onSeatDrop}
        viewportRef={viewportRef}
        zoomControls
      />
    )
  }

  return (
    // 全屏时根节点就是全屏元素,半透明底会透出浏览器的黑色 ::backdrop,所以底色必须不透明:
    // bg-background 打底、再叠一层 muted/40 的渐变,外观与窗口态(原 bg-muted/40)在浅/深色下一致
    // 高度跟着窗口走:1024×768 的投影下各模式都不用滚动页面,舞台吃掉剩余高度(排座的操作条多,舞台就矮一些)
    <div
      ref={rootRef}
      className="relative flex h-full gap-4 bg-background p-3 lg:p-4 [background-image:linear-gradient(hsl(var(--ws-muted)/0.4),hsl(var(--ws-muted)/0.4))]"
    >
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        {!presenting && <h2 className="sr-only">{cls.name}</h2>}
        {!presenting && summary.isError && !summary.data && (
          <p role="alert" className="text-sm text-destructive">
            班级概况加载失败
          </p>
        )}
        {/* 舞台下限:窗口矮于 560px 时放宽到 120px,让排座托盘 + 操作台也装得下而不整页滚动(适应缩放随舞台缩小) */}
        {/* 弹层锚点是点击瞬间的快照:在舞台上按下或滚轮平移 / 缩放时先关掉弹层 */}
        <div
          ref={stageRef}
          data-testid="classroom-stage"
          aria-busy={seatingPending ? true : undefined}
          className={`relative min-h-[120px] flex-1 overflow-hidden [@media(min-height:560px)]:min-h-[240px] rounded-xl border bg-card ${
            seatingPending ? 'cursor-progress' : ''
          }`}
          onPointerDownCapture={(e) => {
            if (!(e.target instanceof Element && e.target.closest('[role="dialog"]')))
              review.closePopover()
          }}
          onWheel={review.closePopover}
        >
          {stage}
          {seatingPending && (
            // 工具栏的 status 已经朗读,这里只做可见提示
            <p
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-foreground/80 px-3 py-1 text-sm text-background"
            >
              {seatingPending === 'saving'
                ? '正在保存,暂时不能调整座位'
                : '座位表加载中,暂时不能调整座位'}
            </p>
          )}
          {review.popover}
          {cardOpen && (
            <PickCard
              groupOf={mapGroup}
              seat={pick.state === 'picked' ? pickedSeat : null}
              presenting={presenting}
              alone={pool.length === 1}
              canReward={perms.includes('review.write')}
              rewarding={pickReward.pending}
              onReward={() => pick.pickedId && pickReward.reward(pick.pickedId)}
              onAgain={pick.start}
              onClose={pick.close}
            />
          )}
        </div>
        {slot.tray}
        {review.leaderboard}
        {camerasOpen && cameraCount > 0 && summary.data && (
          <CameraStrip
            classId={classId}
            schoolName={summary.data.school_name}
            viewerName={displayName ?? ''}
            timeZone={summary.data.timezone}
            onClose={() => setCamerasOpen(false)}
            onFullscreenChange={setCameraFullscreen}
          />
        )}
        <ClassroomDock
          mode={mode}
          perms={perms}
          onModeChange={setMode}
          actions={slot.actions}
          common={
            mode === 'daily' && (canPick || canEditBoard) ? (
              <>
                {canPick && (
                  <Button onClick={pick.start} disabled={picking}>
                    <Dices aria-hidden />
                    随机点名
                  </Button>
                )}
                {canEditBoard && (
                  <Button variant="outline" onClick={() => setEditingBoard(true)}>
                    <PencilLine aria-hidden="true" />
                    编辑黑板
                  </Button>
                )}
              </>
            ) : undefined
          }
          menu={
            slot.menu || canSettings || (mode !== 'daily' && (canPick || canEditBoard)) ? (
              <>
                {slot.menu}
                {canSettings && (
                  // 排座草稿有未保存的修改时不能改桌椅(保存会按新桌椅重排并重建草稿)
                  <MenuItem disabled={seating.dirty} onSelect={openSettings}>
                    {seating.dirty ? '班级设置(先保存或放弃当前的座位修改)' : '班级设置'}
                  </MenuItem>
                )}
                {mode !== 'daily' && canPick && (
                  <MenuItem disabled={picking} onSelect={pick.start}>
                    随机点名
                  </MenuItem>
                )}
                {mode !== 'daily' && canEditBoard && (
                  <MenuItem onSelect={() => setEditingBoard(true)}>编辑黑板</MenuItem>
                )}
              </>
            ) : undefined
          }
          status={
            seatingPending === 'saving'
              ? '保存中…'
              : seatingPending === 'loading'
                ? '加载中…'
                : undefined
          }
          presenting={presenting}
          onTogglePresent={togglePresent}
          onOpenPanel={() => setPanelOpen(true)}
          cameras={
            cameraCount > 0
              ? { open: camerasOpen, onToggle: () => setCamerasOpen((o) => !o) }
              : undefined
          }
        />
      </section>
      {settingsOpen && summary.data && roster.data && (
        <ClassSettingsDialog
          cls={cls}
          seatVersion={summary.data.seat_version}
          studentCount={roster.data.items.length}
          hasSeated={roster.data.items.some((s) => s.seat_row != null && s.seat_col != null)}
          onClose={() => setSettingsOpen(false)}
          onSaved={onLayoutSaved}
          onGo={goFromSettings}
        />
      )}
      {editingBoard && summary.data && (
        <BoardEditor
          classId={classId}
          board={summary.data.board}
          onClose={() => setEditingBoard(false)}
        />
      )}
      {panelOpen && !presenting && summary.data && roster.data && (
        <SidePanel open title="待办与点评" onClose={() => setPanelOpen(false)}>
          <div className="flex flex-col gap-3">
            <TodoSection />
            {perms.includes('exam.read') && (
              <ExamSection classId={classId} roster={roster.data.items} />
            )}
            {perms.includes('review.read') && (
              <FeedSection
                classId={classId}
                roster={roster.data.items}
                timezone={summary.data.timezone}
              />
            )}
          </div>
        </SidePanel>
      )}
    </div>
  )
}
