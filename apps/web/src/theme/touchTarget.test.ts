import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// L82:触屏(pointer: coarse)下教师端顶栏导航、档案抽屉页签、表格行按钮、对话框关闭按钮的点击区 ≥ 44 × 44 px,
// 桌面鼠标下尺寸不变。规则集中写在 theme/index.css 的一个 @media 块里;jsdom 不算媒体查询,这里直接核对样式表。
// 样式表按本文件位置解析(不依赖 cwd);jsdom 环境下全局 URL 不是 Node 的 URL,readFileSync 不认,所以先转成路径
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8')

/** 取出 `@media (pointer: coarse) { … }` 的块体(按花括号配对) */
function coarseBlock(): string {
  const start = css.indexOf('@media (pointer: coarse)')
  expect(start).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  throw new Error('@media (pointer: coarse) 块没有闭合')
}

/** 块体里某个选择器的声明 */
function rule(block: string, selector: string): string {
  const at = block.indexOf(`${selector} {`)
  expect(at, `缺少 ${selector} 规则`).toBeGreaterThanOrEqual(0)
  return block.slice(at, block.indexOf('}', at))
}

describe('pointer: coarse touch targets', () => {
  it('gives .touch-target (nav links, table row buttons) a 44px minimum box', () => {
    const r = rule(coarseBlock(), '.touch-target')
    expect(r).toMatch(/min-height:\s*44px/)
    expect(r).toMatch(/min-width:\s*44px/)
  })

  it('gives drawer tabs a 44px box without wrapping their labels', () => {
    const r = rule(coarseBlock(), ".touch-tabs [role='tab']")
    expect(r).toMatch(/min-height:\s*44px/)
    expect(r).toMatch(/min-width:\s*44px/)
    expect(r).toMatch(/white-space:\s*nowrap/)
  })

  it('enlarges the dialog / sheet close button to 44px', () => {
    const r = rule(coarseBlock(), "[role='dialog'] > button.absolute.right-4.top-4")
    expect(r).toMatch(/width:\s*44px/)
    expect(r).toMatch(/height:\s*44px/)
  })

  it('pads the dialog / sheet header so the 44px close button does not cover the title', () => {
    // 关闭按钮占到距右边 46px(44 + right 2px);标题区右侧至少让出 3rem(48px)
    const r = rule(coarseBlock(), '.touch-dialog-header')
    const rem = Number(/padding-right:\s*([\d.]+)rem/.exec(r)?.[1])
    expect(rem).toBeGreaterThanOrEqual(3)
  })

  it('keeps every 44px rule inside the coarse-pointer block so desktop sizes stay unchanged', () => {
    // 去掉注释再查:块外不能出现这几个选择器
    const outside = css.replace(coarseBlock(), '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(outside).not.toMatch(
      /\.touch-target|\.touch-tabs|\.touch-dialog-header|button\.absolute\.right-4/,
    )
  })
})
