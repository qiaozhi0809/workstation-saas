import { useId } from 'react'
import { hairStyleOf, type Gender } from './identity'
import { mix } from './palette'
import { Face, HairBehind, HairFront, HoodieFront } from './parts'

interface Props {
  gender: Gender
  seed: string
  color: string
  size?: number
  title: string
}

// 正脸头像:悬停卡、点名卡、托盘、拖拽影子共用(独立 svg,不依赖教室的 defs)
export default function Avatar({ gender, seed, color, size = 40, title }: Props) {
  const clip = `cr-av-${useId().replace(/:/g, '')}`
  const hair = hairStyleOf(gender, seed)
  return (
    <svg
      role="img"
      aria-label={title}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className="cr-avatar shrink-0"
      data-hair={hair}
    >
      <clipPath id={clip}>
        <circle cx={32} cy={32} r={32} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <circle cx={32} cy={32} r={32} fill={mix(color, '#ffffff', 0.72)} />
        <g transform="translate(32 30)">
          <HoodieFront color={color} />
          <HairBehind style={hair} />
          <Face />
          <HairFront style={hair} color={color} />
        </g>
      </g>
    </svg>
  )
}
