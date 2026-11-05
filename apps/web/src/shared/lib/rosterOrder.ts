const collator = new Intl.Collator('zh-CN', { numeric: true })

interface RosterOrderKey {
  student_no: string | null | undefined
  name: string
}

/** 全站统一的名单顺序:学号按数字排(空学号在后),再按姓名。 */
export function compareRoster(a: RosterOrderKey, b: RosterOrderKey): number {
  if (!a.student_no !== !b.student_no) return a.student_no ? -1 : 1
  return (
    collator.compare(a.student_no ?? '', b.student_no ?? '') || collator.compare(a.name, b.name)
  )
}
