import { useEffect, useState } from 'react'

function formatNow(timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date())
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
  const [now, setNow] = useState(() => formatNow(timeZone))
  useEffect(() => {
    setNow(formatNow(timeZone))
    const id = setInterval(() => setNow(formatNow(timeZone)), 1000)
    return () => clearInterval(id)
  }, [timeZone])
  return (
    <div className="pointer-events-none absolute right-2 top-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded bg-black/70 px-2 py-1 text-xs text-white">
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
      <span className="truncate">{`正在直播 · ${schoolName} · ${now} · ${viewerName}`}</span>
    </div>
  )
}
