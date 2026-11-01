const MS_PER_DAY = 86_400_000
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

function utcMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toIso(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addDays(iso: string, n: number): string {
  return toIso(utcMs(iso) + n * MS_PER_DAY)
}

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / MS_PER_DAY)
}

/** Birthday date within `year`; Feb 29 falls on Feb 28 in common years. */
function birthdayIn(birthdate: string, year: number): string {
  const [, m, d] = birthdate.split('-').map(Number)
  const day = m === 2 && d === 29 && !isLeap(year) ? 28 : d
  return `${year}-${pad(m)}-${pad(day)}`
}

export function daysUntilBirthday(birthdate: string, today: string): number {
  const year = Number(today.slice(0, 4))
  const thisYear = birthdayIn(birthdate, year)
  const next = thisYear >= today ? thisYear : birthdayIn(birthdate, year + 1)
  return daysBetween(today, next)
}

export function ageOn(birthdate: string, day: string): number {
  const year = Number(day.slice(0, 4))
  const age = year - Number(birthdate.slice(0, 4))
  return birthdayIn(birthdate, year) > day ? age - 1 : age
}

export function weekdayCN(iso: string): string {
  return WEEKDAYS[new Date(utcMs(iso)).getUTCDay()]
}

export function formatMonthDay(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${m}月${d}日`
}

export function formatInTz(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}
