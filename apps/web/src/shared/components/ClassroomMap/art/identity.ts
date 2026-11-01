import { pickBy } from './hash'

export type Gender = 'female' | 'male' | null
export type Pose = 'sit' | 'turn' | 'look' | 'raise' | 'doze' | 'stretch' | 'stand'
export type HairStyle = 'braid' | 'bob' | 'pony' | 'spiky' | 'buzz' | 'side' | 'beanie'

const FEMALE: HairStyle[] = ['braid', 'bob', 'pony']
const MALE: HairStyle[] = ['spiky', 'buzz', 'side']

export function genderOf(raw: string | null | undefined): Gender {
  const v = raw?.trim().toLowerCase()
  if (v === '女' || v === 'f' || v === 'female') return 'female'
  if (v === '男' || v === 'm' || v === 'male') return 'male'
  return null
}

export function hairStyleOf(gender: Gender, seed: string): HairStyle {
  if (gender === 'female') return pickBy(FEMALE, seed, ':hair')
  if (gender === 'male') return pickBy(MALE, seed, ':hair')
  return 'beanie'
}
