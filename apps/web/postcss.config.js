import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

const ARC_MODULE = /[\\/]shared[\\/]components[\\/]arc[\\/].+\.module\.css$/

// Arc 的 CSS 模块放进 arc 层:层序在 theme/index.css 里声明(tw-base < arc),
// 工具类不分层,所以调用点的 className 总是赢过 Arc,不依赖样式表加载顺序
const arcLayer = () => ({
  postcssPlugin: 'ws-arc-layer',
  Once(root, { AtRule }) {
    const file = (root.source?.input.file ?? '').split('?')[0]
    if (!ARC_MODULE.test(file)) return
    const nodes = [...root.nodes]
    root.removeAll()
    const layer = new AtRule({ name: 'layer', params: 'arc' })
    layer.append(nodes)
    root.append(layer)
  },
})
arcLayer.postcss = true

export default { plugins: [arcLayer(), tailwindcss(), autoprefixer()] }
