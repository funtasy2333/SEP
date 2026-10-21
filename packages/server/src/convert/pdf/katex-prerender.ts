/**
 * KaTeX 公式预渲染（Phase 5.5 / WP5）。
 *
 * @ses/shared 的 HTML 渲染器不渲染 KaTeX（依赖 DOM 字体度量不可靠，WP0 结论 6），
 * 只输出占位：`<span class="ses-formula" data-latex="LATEX"></span>`（式中符号为 `ses-formula-inline`）。
 * 出件管线在服务端用 katex.renderToString 把占位替换为静态 HTML，再交给 vivliostyle。
 *
 * 纯函数（除注入的 renderToString 外无 IO），便于单元测试。
 */

import katex from 'katex'

/** 反转 escapeAttr：&amp; &lt; &gt; &quot;（渲染器写 data-latex 时的转义） */
function unescapeAttr(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

export interface PrerenderResult {
  html: string
  /** 渲染失败的公式数量（throwOnError:false 下回退为原始 LaTeX 文本） */
  failures: number
}

/**
 * 将 HTML 中的公式占位替换为 KaTeX 静态 HTML：块级 `.ses-formula` 按 display 模式，
 * 式中符号的 `.ses-formula-inline` 按行内模式。
 * @param html print 变体 HTML
 * @param render 注入点，默认用 katex.renderToString（测试可替换）；第二参数为是否 display 模式
 */
export function prerenderFormulas(
  html: string,
  render: (latex: string, display: boolean) => string = defaultRender,
): PrerenderResult {
  let failures = 0
  const out = html.replace(
    /<span class="(ses-formula|ses-formula-inline)" data-latex="([^"]*)"><\/span>/g,
    (_match, className: string, escaped: string) => {
      const latex = unescapeAttr(escaped)
      try {
        const rendered = render(latex, className === 'ses-formula')
        return `<span class="${className}">${rendered}</span>`
      } catch {
        failures++
        return `<span class="${className}">${escapeHtml(latex)}</span>`
      }
    },
  )
  return { html: out, failures }
}

function defaultRender(latex: string, display: boolean): string {
  return katex.renderToString(latex, {
    displayMode: display,
    throwOnError: false,
    output: 'html',
  })
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
