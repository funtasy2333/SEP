/**
 * 段落文本提取（docs/wp7-docx-delivery.md §10.2 helpers/outline.ts 的 text 列提取规则）。
 *
 * `w:t` 原文；`w:br` 记为「⏎」；`w:tab` 记为「⇥」；公式（m:oMath/m:oMathPara）记为「〔公式〕」；
 * 图片（w:r 内的 w:drawing）记为「〔图〕」。§4.7 模拟器的 text 列提取规则与此完全相同
 * （numberingSim.ts 直接复用本文件，不重新实现一份，避免两处规则跑偏）。
 *
 * 独立成文件（而不是留在 outline.ts 里）是为了让 outline.ts 可以反过来依赖 numberingSim.ts
 * （WP7.2 起大纲的编号栏改用 §4.7 模拟器的 label）而不产生循环依赖：
 * xmlTree.ts ← paragraphText.ts ← { outline.ts, numberingSim.ts } ← outline.ts。
 *
 * 这是测试代码（属于 shared 测试基建），不从任何 index.ts 导出，同样不得使用 Node 或浏览器
 * 专有 API。
 */

import type { XmlElement } from './xmlTree'

function textOf(el: XmlElement): string {
  let out = ''
  for (const c of el.children) if (c.kind === 'text') out += c.text
  return out
}

function extractRunText(r: XmlElement): string {
  let out = ''
  for (const child of r.children) {
    if (child.kind === 'text') {
      out += child.text
      continue
    }
    if (child.name === 'w:t') out += textOf(child)
    else if (child.name === 'w:br') out += '⏎'
    else if (child.name === 'w:tab') out += '⇥'
    else if (child.name === 'w:drawing') out += '〔图〕'
    // 其余（rPr、fldChar、instrText…）不影响提取的文本，忽略
  }
  return out
}

/** 目次超链接等段落容器里的可见 run；fldChar/instrText 不属于可见文本。 */
function extractVisibleDescendants(container: XmlElement): string {
  let out = ''
  for (const child of container.children) {
    if (child.kind !== 'element') continue
    if (child.name === 'w:r') out += extractRunText(child)
    else if (child.name === 'w:hyperlink') out += extractVisibleDescendants(child)
    else if (child.name === 'm:oMath' || child.name === 'm:oMathPara') out += '〔公式〕'
  }
  return out
}

/** 提取一个 `w:p` 段落的文本（含 run 内的 br/tab/图片标记与公式占位），规则见文件头注释 */
export function extractParagraphText(p: XmlElement): string {
  let out = ''
  for (const child of p.children) {
    if (child.kind !== 'element') continue
    if (child.name === 'w:pPr') continue
    if (child.name === 'w:r') out += extractRunText(child)
    else if (child.name === 'w:hyperlink') out += extractVisibleDescendants(child)
    else if (child.name === 'm:oMath' || child.name === 'm:oMathPara') out += '〔公式〕'
  }
  return out
}
