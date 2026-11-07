import { SHADOW_ID } from './palette'

// 整张教室 svg 放一次;Avatar 是独立 svg,不使用该滤镜。
// 同页还有别的 svg 各带一份 defs 时(欢迎页两张形象卡)传各自唯一的 id,文档里不出现重复 id(L241)
export default function CrDefs({ id = SHADOW_ID }: { id?: string }) {
  return (
    <defs>
      <filter id={id} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
        <feDropShadow dx={4} dy={4} stdDeviation={3} floodColor="#6b5640" floodOpacity={0.22} />
      </filter>
    </defs>
  )
}
