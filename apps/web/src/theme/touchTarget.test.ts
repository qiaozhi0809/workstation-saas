import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// L82:触屏(pointer: coarse)下教师端顶栏导航、档案抽屉页签、表格行按钮、对话框关闭按钮的点击区 ≥ 44 × 44 px,
// 桌面鼠标下尺寸不变。规则集中写在 theme/index.css 的一个 @media 块里;jsdom 不算媒体查询,这里直接核对样式表。
const css = readFileSync(join(process.cwd(), 'src/theme/index.css'), 'utf8')

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

  it('keeps every 44px rule inside the coarse-pointer block so desktop sizes stay unchanged', () => {
    // 去掉注释再查:块外不能出现这几个选择器
    const outside = css.replace(coarseBlock(), '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(outside).not.toMatch(/\.touch-target|\.touch-tabs|button\.absolute\.right-4/)
  })
})
