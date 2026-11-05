import type { Audience } from '@/shared/types/admin'
import type { TargetKind } from './TargetPicker'

/** 对象选项:school_wide=false(年级组长)没有"全校";发给家长没有"指定的人" */
export function kindsFor(audience: Audience, schoolWide: boolean): TargetKind[] {
  return [...(schoolWide ? (['school'] as const) : []), 'grade', 'class', ...(audience === 'teachers' ? (['users'] as const) : [])]
}
