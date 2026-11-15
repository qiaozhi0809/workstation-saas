import { createContext, useContext } from 'react'

/** 操作台容器窄于这个宽度(px)时进入紧凑形态:次要按钮收进「更多操作」菜单,保持一行。 */
export const DOCK_COMPACT_BELOW = 1040

/** 操作台是否处于紧凑形态;不在操作台里渲染时(单测、独立使用)恒为 false。 */
export const DockCompactContext = createContext(false)

export const useDockCompact = () => useContext(DockCompactContext)
