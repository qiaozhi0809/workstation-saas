import type { SeatView } from '@/shared/components/ClassroomMap/types'

export type RankTint = NonNullable<SeatView['tint']>

/** 名次五等分的档位文案:图例色块与座位的读屏描述共用,改文案只改这里 */
export const RANK_BANDS: readonly { tint: RankTint; label: string }[] = [
  { tint: 1, label: '前 20%' },
  { tint: 2, label: '20–40%' },
  { tint: 3, label: '40–60%' },
  { tint: 4, label: '60–80%' },
  { tint: 5, label: '后 20%' },
]

/** 座位的读屏补充说明,如"名次档:前 20%"(名次档不进可访问名称,只进可访问描述) */
export function rankBandDescription(tint: RankTint): string {
  return `名次档：${RANK_BANDS.find((b) => b.tint === tint)!.label}`
}
