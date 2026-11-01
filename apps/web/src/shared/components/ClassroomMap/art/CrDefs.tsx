import { SHADOW_ID } from './palette'

// 整张教室 svg 放一次;Avatar 是独立 svg,不使用该滤镜
export default function CrDefs() {
  return (
    <defs>
      <filter id={SHADOW_ID} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
        <feDropShadow dx={4} dy={4} stdDeviation={3} floodColor="#6b5640" floodOpacity={0.22} />
      </filter>
    </defs>
  )
}
