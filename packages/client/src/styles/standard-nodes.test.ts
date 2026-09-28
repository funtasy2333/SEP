import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./standard-nodes.css', import.meta.url)), 'utf8')

describe('standard-nodes.css 列项标记', () => {
  it('alpha/number 使用全角右括号，旧罗马类型退化为数字标记', () => {
    expect(css).toContain("counter(alpha-counter, lower-alpha) '） '")
    expect(css).toContain("counter(numeric-counter) '） '")
    expect(css).not.toMatch(/counter\([^)]*(?:lower|upper)-roman/)
  })

  it('嵌套列项使用间隔号', () => {
    expect(css).toContain(".std-list .std-list .std-list-item::before {\n  content: '·';\n  margin-right: 0.5em;")
  })
})
