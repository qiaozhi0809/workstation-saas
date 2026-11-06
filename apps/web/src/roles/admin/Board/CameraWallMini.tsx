import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, LayoutGrid } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { camerasApi } from '@/shared/api/cameras'
import { ApiError } from '@/shared/api/client'
import { CameraGrid } from '@/shared/components/camera/CameraGrid'
import { CameraPlayer } from '@/shared/components/camera/CameraPlayer'
import { LiveWatermark } from '@/shared/components/camera/LiveWatermark'
import Modal from '@/shared/components/overlay/Modal'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'
import { useAuthStore } from '@/shared/stores/auth'
import type { CameraBrief, CameraStatus, CameraWall } from '@/shared/types/camera'

const ROTATE_MS = 10_000
/** 轮播换路时旧播放器最多再留这么久(新的一直没出画面也切) */
const HANDOFF_MAX_MS = 8_000
const GRID_MAX = 9
/** 状态点随 worker 写的状态刷新 */
const WALL_REFETCH_MS = 60_000
const WIDE = '(min-width: 1024px)'
const PUBLIC_KEY = 'public'

const STATUS_LABEL: Record<CameraStatus, string> = {
  streaming: '在播',
  idle: '空闲',
  error: '故障',
}
const STATUS_DOT: Record<CameraStatus, string> = {
  streaming: 'bg-success',
  idle: 'bg-muted-foreground/40',
  error: 'bg-destructive',
}

type WallGrade = CameraWall['grades'][number]
type WallClass = WallGrade['classes'][number]

/** 侧栏里的一行:一个班,或最后的"公共区域" */
interface Group {
  key: string
  name: string
  gradeId: string | null
  cameras: CameraBrief[]
}

const classGroup = (g: WallGrade, c: WallClass): Group => ({
  key: c.class_id,
  name: c.class_name,
  gradeId: g.grade_id,
  cameras: c.cameras,
})

function groupsOf(wall: CameraWall): Group[] {
  const out = wall.grades.flatMap((g) => g.classes.map((c) => classGroup(g, c)))
  if (wall.public.length > 0)
    out.push({ key: PUBLIC_KEY, name: '公共区域', gradeId: null, cameras: wall.public })
  return out
}

/** 轮播只停在有非故障摄像头的班;返回该班第一路能看的下标,没有则 -1 */
const firstWatchable = (g: Group) => g.cameras.findIndex((c) => c.status !== 'error')

/** 轮播间隔:默认 10 秒;开发环境可用 ?rotate=<秒> 覆盖(E2E 用) */
function useRotateInterval(): number {
  const [params] = useSearchParams()
  const raw = import.meta.env.DEV ? Number(params.get('rotate')) : NaN
  return Number.isFinite(raw) && raw >= 1 ? raw * 1000 : ROTATE_MS
}

/** ≥ 1024 是看板右侧的侧栏,否则是页面下方的折叠区(没有 matchMedia 的环境按宽屏算) */
function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia?.(WIDE).matches ?? true)
  useEffect(() => {
    const mq = window.matchMedia?.(WIDE)
    if (!mq) return
    const on = () => setWide(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

/**
 * 单画面。换路时先建新播放器(垫在下面),旧的留在上面,等新的出画面再卸载旧的,最多等 8 秒——
 * 两路都按摄像头 id 做 key,同一路从"当前"变成"旧的"时不会重挂。
 */
function HandoffPlayer({
  camera,
  schoolName,
  viewerName,
  timeZone,
}: {
  camera: CameraBrief
  schoolName: string
  viewerName: string
  timeZone: string
}) {
  const [shown, setShown] = useState<{ cur: CameraBrief; prev: CameraBrief | null }>({
    cur: camera,
    prev: null,
  })
  // 渲染期间按 props 调整状态:当前路变了,原来的当前路成为"旧的";
  // 切回还没来得及卸载的"旧的"(A→B→A)时它已经出过画面,直接只留它,不等交接;
  // 同一路 id 换了对象(60 秒刷新后名字 / 状态变了)只换对象,播放器按 id 做 key 不重挂
  const view =
    shown.cur.id === camera.id
      ? shown.cur === camera
        ? shown
        : { ...shown, cur: camera }
      : shown.prev?.id === camera.id
        ? { cur: camera, prev: null }
        : { cur: camera, prev: shown.cur }
  if (view !== shown) setShown(view)
  const prevId = view.prev?.id
  useEffect(() => {
    if (!prevId) return
    const t = setTimeout(
      () => setShown((s) => (s.prev?.id === prevId ? { ...s, prev: null } : s)),
      HANDOFF_MAX_MS,
    )
    return () => clearTimeout(t)
  }, [prevId])
  const dropPrev = () => setShown((s) => (s.prev ? { ...s, prev: null } : s))
  const players = view.prev ? [view.cur, view.prev] : [view.cur]
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
      {players.map((c) => (
        <div key={c.id} className={cn('absolute inset-0', c.id === view.prev?.id && 'z-[1]')}>
          <CameraPlayer
            cameraId={c.id}
            title={c.name}
            onPlaying={c.id === view.cur.id ? dropPrev : undefined}
          />
        </div>
      ))}
      <LiveWatermark schoolName={schoolName} viewerName={viewerName} timeZone={timeZone} />
    </div>
  )
}

function ClassRow({
  group,
  selected,
  onSelect,
}: {
  group: Group
  selected: boolean
  onSelect(): void
}) {
  const n = group.cameras.length
  const streaming = group.cameras.filter((c) => c.status === 'streaming').length
  const error = group.cameras.filter((c) => c.status === 'error').length
  const summary = [streaming > 0 && `${streaming} 路在播`, error > 0 && `${error} 路故障`]
    .filter(Boolean)
    .join(',')
  return (
    <button
      type="button"
      data-testid={`camera-wall-class-${group.key}`}
      aria-pressed={selected}
      disabled={n === 0}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 disabled:hover:bg-transparent',
        selected && 'bg-accent text-accent-foreground',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{group.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{`${n} 路`}</span>
      {n > 0 && (
        <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
          {group.cameras.map((c) => (
            <span
              key={c.id}
              title={`${c.name}:${STATUS_LABEL[c.status]}`}
              className={cn('h-2 w-2 rounded-full', STATUS_DOT[c.status])}
            />
          ))}
        </span>
      )}
      {summary && <span className="sr-only">{summary}</span>}
    </button>
  )
}

/**
 * 全校看板旁的监控侧栏:按年级列各班(班名 + 路数 + 状态点),公共区域单列;点班看单画面,
 * 多路时下方切换;"自动切换"每 10 秒换到下一个有非故障摄像头的班(页面隐藏时不换);
 * "九宫格"弹层最多选 9 路(默认当前年级的前 9 路),开着时侧栏单画面停掉,不多占一路。
 */
export default function CameraWallMini({ gradeId }: { gradeId: string | null }) {
  const viewerName = useAuthStore((s) => s.user?.display_name ?? '')
  const wide = useWide()
  const [expanded, setExpanded] = useState(false)
  const shown = wide || expanded
  const intervalMs = useRotateInterval()
  const q = useQuery({
    queryKey: ['camera-wall'],
    queryFn: camerasApi.wall,
    refetchInterval: WALL_REFETCH_MS,
  })
  const groups = q.data ? groupsOf(q.data) : []
  const total = groups.reduce((n, g) => n + g.cameras.length, 0)

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [camIndex, setCamIndex] = useState(0)
  const [rotate, setRotate] = useState(false)
  const [gridOpen, setGridOpen] = useState(false)
  const [pick, setPick] = useState<string[]>([])

  const group = groups.find((g) => g.key === selectedKey)
  const idx = group ? Math.min(camIndex, group.cameras.length - 1) : -1
  const current = group && idx >= 0 ? { group, camera: group.cameras[idx] } : null

  // 手动点班后轮播计时从头算(否则下一拍可能 1 秒后就切走);每次 +1 让计时器重建
  const [timerEpoch, setTimerEpoch] = useState(0)
  const select = (g: Group) => {
    setSelectedKey(g.key)
    setCamIndex(Math.max(firstWatchable(g), 0))
    setTimerEpoch((n) => n + 1)
  }
  // 轮播定时器读最新的班列表与选中项:提交后再写 ref,不在渲染期间写(并发渲染可能被丢弃)
  const latest = useRef({ groups, selectedKey })
  useEffect(() => {
    latest.current = { groups, selectedKey }
  })
  const advance = useCallback(() => {
    const rotatable = latest.current.groups.filter((g) => firstWatchable(g) >= 0)
    if (rotatable.length === 0) return
    const i = rotatable.findIndex((g) => g.key === latest.current.selectedKey)
    const next = rotatable[(i + 1) % rotatable.length]
    setSelectedKey(next.key)
    setCamIndex(firstWatchable(next))
  }, [])
  // 九宫格开着、折叠区收着时不轮播;标签页隐藏时不换(回来接着换);timerEpoch 变了就重新计时
  useEffect(() => {
    if (!rotate || gridOpen || !shown) return
    const id = setInterval(() => {
      if (!document.hidden) advance()
    }, intervalMs)
    return () => clearInterval(id)
  }, [rotate, gridOpen, shown, intervalMs, advance, timerEpoch])
  const toggleRotate = (on: boolean) => {
    setRotate(on)
    if (on && !current) advance()
  }

  const openGrid = () => {
    const inGrade = groups.filter((g) => g.gradeId === gradeId).flatMap((g) => g.cameras)
    const base = inGrade.length > 0 ? inGrade : groups.flatMap((g) => g.cameras)
    setPick(base.slice(0, GRID_MAX).map((c) => c.id))
    setGridOpen(true)
  }
  // 九宫格里的标题带班名,不同班的"讲台机位"分得清
  const byId = new Map<string, CameraBrief>()
  for (const g of groups)
    for (const c of g.cameras) byId.set(c.id, { ...c, name: `${g.name} · ${c.name}` })
  const picked = pick.flatMap((id) => byId.get(id) ?? [])

  let body: ReactNode = null
  if (shown) {
    const off = q.error instanceof ApiError && q.error.status === 404
    if (q.isPending) body = <p className="text-sm text-muted-foreground">加载中…</p>
    else if (q.isError)
      body = (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
          {off ? '学校还没开启监控' : '监控列表加载失败'}
          {!off && (
            <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
              重试
            </Button>
          )}
        </div>
      )
    else if (total === 0) body = <p className="text-sm text-muted-foreground">还没有登记摄像头</p>
    else
      body = (
        <>
          {gridOpen ? null : current ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-medium">{current.group.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {current.camera.name}
                </span>
              </div>
              <HandoffPlayer
                camera={current.camera}
                schoolName={q.data.school_name}
                viewerName={viewerName}
                timeZone={q.data.timezone}
              />
              {current.group.cameras.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {current.group.cameras.map((c, i) => (
                    <Button
                      key={c.id}
                      size="sm"
                      variant={i === idx ? 'secondary' : 'outline'}
                      aria-pressed={i === idx}
                      onClick={() => setCamIndex(i)}
                    >
                      {c.name}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">点一个班看画面</p>
          )}
          <nav aria-label="各班摄像头" className="flex flex-col gap-2">
            {q.data.grades.map((g) => (
              <div key={g.grade_id} className="flex flex-col gap-0.5">
                <h3 className="px-2 text-xs font-medium text-muted-foreground">{g.grade_name}</h3>
                {g.classes.map((c) => {
                  const grp = classGroup(g, c)
                  return (
                    <ClassRow
                      key={c.class_id}
                      group={grp}
                      selected={selectedKey === c.class_id}
                      onSelect={() => select(grp)}
                    />
                  )
                })}
              </div>
            ))}
            {groups
              .filter((g) => g.key === PUBLIC_KEY)
              .map((g) => (
                <ClassRow
                  key={g.key}
                  group={g}
                  selected={selectedKey === g.key}
                  onSelect={() => select(g)}
                />
              ))}
          </nav>
        </>
      )
  }

  return (
    <aside
      data-testid="camera-wall"
      aria-label="监控"
      className="flex flex-col gap-3 rounded-lg border bg-card p-3 text-card-foreground"
    >
      <div className="flex flex-wrap items-center gap-2">
        {wide ? (
          <h2 className="text-base font-semibold">监控</h2>
        ) : (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 rounded-md text-base font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {total > 0 ? `监控 · ${total} 路` : '监控'}
            {expanded ? (
              <ChevronUp aria-hidden className="size-4" />
            ) : (
              <ChevronDown aria-hidden className="size-4" />
            )}
          </button>
        )}
        {shown && total > 0 && (
          <>
            <label className="ml-auto flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                role="switch"
                data-testid="camera-wall-rotate"
                checked={rotate}
                onChange={(e) => toggleRotate(e.target.checked)}
              />
              自动切换
            </label>
            <Button variant="outline" size="sm" onClick={openGrid}>
              <LayoutGrid aria-hidden />
              九宫格
            </Button>
          </>
        )}
      </div>
      {body}
      {gridOpen && q.data && (
        <Modal
          open
          onClose={() => setGridOpen(false)}
          title="九宫格"
          description={`已选 ${pick.length} / ${GRID_MAX} 路`}
          className="sm:max-w-[min(96vw,1400px)]"
        >
          <div className="flex flex-col gap-4 lg:flex-row">
            <div data-testid="camera-wall-grid" className="min-w-0 flex-1">
              {picked.length > 0 ? (
                <CameraGrid
                  cameras={picked}
                  size={GRID_MAX}
                  schoolName={q.data.school_name}
                  viewerName={viewerName}
                  timeZone={q.data.timezone}
                />
              ) : (
                <p className="text-sm text-muted-foreground">勾选要看的摄像头</p>
              )}
            </div>
            <fieldset className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto text-sm lg:max-h-[70vh] lg:w-56 lg:shrink-0">
              <legend className="mb-1 font-medium">{`选择摄像头(最多 ${GRID_MAX} 路)`}</legend>
              {groups
                .filter((g) => g.cameras.length > 0)
                .map((g) => (
                  <div key={g.key} className="flex flex-col gap-0.5">
                    <div className="text-xs text-muted-foreground">{g.name}</div>
                    {g.cameras.map((c) => {
                      const on = pick.includes(c.id)
                      return (
                        <label key={c.id} className="flex items-center gap-2 py-0.5">
                          <input
                            type="checkbox"
                            aria-label={`${g.name} ${c.name}`}
                            checked={on}
                            disabled={!on && pick.length >= GRID_MAX}
                            onChange={() =>
                              setPick(on ? pick.filter((id) => id !== c.id) : [...pick, c.id])
                            }
                          />
                          <span className="min-w-0 flex-1 truncate">{c.name}</span>
                          <span
                            aria-hidden="true"
                            title={STATUS_LABEL[c.status]}
                            className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[c.status])}
                          />
                        </label>
                      )
                    })}
                  </div>
                ))}
            </fieldset>
          </div>
        </Modal>
      )}
    </aside>
  )
}
