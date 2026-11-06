import { useEffect, useMemo, useState } from 'react'

const FORMAT: Intl.DateTimeFormatOptions = {
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
}

/** 已经警告过的非法时区:同一页面上多块水印(九宫格)只提醒一次 */
const warnedZones = new Set<string>()

/** 时区非法(后端配置写错 / 浏览器不认识)时退回浏览器时区,不让整块画面因 RangeError 崩掉 */
function makeFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('zh-CN', { ...FORMAT, timeZone })
  } catch {
    if (!warnedZones.has(timeZone)) {
      warnedZones.add(timeZone)
      console.warn(`LiveWatermark:时区 "${timeZone}" 无效,水印改用浏览器时区`)
    }
    return new Intl.DateTimeFormat('zh-CN', FORMAT)
  }
}

/** 直播水印:右上角深色半透明底(任何画面上对比度都够),不拦截鼠标 */
export function LiveWatermark({
  schoolName,
  viewerName,
  timeZone,
}: {
  schoolName: string
  viewerName: string
  timeZone: string
}) {
  const fmt = useMemo(() => makeFormatter(timeZone), [timeZone])
  const [now, setNow] = useState(() => fmt.format(new Date()))
  useEffect(() => {
    setNow(fmt.format(new Date()))
    const id = setInterval(() => setNow(fmt.format(new Date())), 1000)
    return () => clearInterval(id)
  }, [fmt])
  return (
    <div className="pointer-events-none absolute right-2 top-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded bg-background/80 px-2 py-1 text-xs text-foreground">
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-destructive" />
      <span className="truncate">{`正在直播 · ${schoolName} · ${now} · ${viewerName}`}</span>
    </div>
  )
}
