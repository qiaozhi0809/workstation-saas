import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// tailwind.config.ts 的 boxShadow 自定义了 surface / overlay;不认识它们时 twMerge 不会把它们当阴影,
// shadow-none 与 shadow-surface 会同时留下,生成的 CSS 里后者排在后面,阴影去不掉
const twMerge = extendTailwindMerge({
  extend: { classGroups: { shadow: [{ shadow: ['surface', 'overlay'] }] } },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
