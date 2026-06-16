/**
 * 目次页码提取与注入（Phase 5.5 / WP5）。
 *
 * 纯函数，无 IO：便于单元测试。两遍构建管线（convert.service）调用：
 *  - 第一遍 vivliostyle build 产出占位 PDF；
 *  - pdftotext 按页扫描得到 `pages: string[]`（每元素为一物理页的纯文本，按 \f 切分）；
 *  - computeTocPageNumbers 把每个目次目标映射到「分区相对页码」字符串
 *    （前置部分用大写罗马数字，正文用阿拉伯数字，依 GB/T 1.1 10.1.3）；
 *  - injectTocPageNumbers 把数字写回 print 变体 HTML 的 `.ses-toc-page` 定宽占位元素。
 *
 * 匹配策略：标题文本去除全部空白后做子串包含判断（pdftotext 的空格/换行与渲染不一致）。
 * 目次自身也含全部条目文本，故需按分区与正文起始页排除目次页的误命中（见下）。
 *
 * 编号-标题分列问题：当章标题（如「4 技术要求」）后紧跟子条标题（「4.1 总体要求」），
 * pdftotext 的阅读序会把两个编号归一列、两个标题归另一列（输出「4 4.1 技术要求 总体要求」），
 * 使「4技术要求」不再连续。故匹配优先用完整文本（标签+标题），命中失败再回退到仅标题部分
 * （目次文本中 U+3000 之后的部分），标题文本在 pdftotext 中通常仍连续。
 */

export type TocDivision = 'front' | 'body'

export interface TocTarget {
  /** 目标锚点 id（= 渲染器 data-target，对应标题元素 id） */
  target: string
  /** 目次显示文本（标签 + 标题），用于在 PDF 各页文本中定位标题真实所在页 */
  text: string
  /** 所属分区：front=前置（罗马页码），body=正文/附录/参考文献（阿拉伯页码） */
  division: TocDivision
}

/** 去除全部空白（含 U+3000 表意空格，JS \s 已涵盖）以做稳健子串匹配 */
function normalize(s: string): string {
  return s.replace(/\s+/g, '')
}

/**
 * needle 的字符按序作为 haystack 的子序列出现（不要求相邻）。
 * 用于前置标题：「目　次/前　言/引　言」含全角字间隔，居中排版后 pdftotext 的阅读序会把
 * 两字拆到不相邻位置（甚至跨页码），连续子串匹配会漏命中其真实所在页。字符按序匹配可稳健命中。
 */
function includesInOrder(haystack: string, needle: string): boolean {
  let i = 0
  for (const ch of haystack) {
    if (ch === needle[i]) {
      i += 1
      if (i === needle.length) return true
    }
  }
  return needle.length === 0
}

/**
 * 由目次显示文本派生匹配候选：优先完整文本，回退仅标题部分。
 * 目次文本形如「4　技术要求」（标签 U+3000 标题）；split 须在 normalize 前做（U+3000 是空白）。
 * 无 U+3000（前言/引言/参考文献）时两候选相同。空候选剔除。
 */
function matchCandidates(text: string): string[] {
  const full = normalize(text)
  const sep = text.indexOf('　')
  const out = [full]
  if (sep >= 0) {
    const titleOnly = normalize(text.slice(sep + 1))
    if (titleOnly && titleOnly !== full) out.push(titleOnly)
  }
  return out.filter(Boolean)
}

/** 1..3999 转大写罗马数字 */
export function toUpperRoman(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  const table: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ]
  let out = ''
  let rem = Math.floor(n)
  for (const [v, sym] of table) {
    while (rem >= v) {
      out += sym
      rem -= v
    }
  }
  return out
}

/**
 * 正文首页隐藏哨兵锚点文本（与 @ses/shared renderers/html.ts print 变体注入的
 * `.ses-body-anchor` 文本严格一致——跨包字符串契约，二者必须同步修改）。
 * 渲染器把它透明、零高度地排在正文首页起始，pdftotext 可提取、肉眼不可见、不影响版式。
 */
export const BODY_START_SENTINEL = 'SESBODYSTARTANCHOR'

/**
 * 定位正文起始物理页（0 基）。
 * 优先用渲染器注入的隐藏哨兵锚点（稳健：不受文件名称文本在前言/引言中复现的影响）。
 * 哨兵缺失时（非本渲染器产物/旧数据）回退到按文件名称文本定位首个命中；仍无则 -1，
 * 由调用方决定降级策略。
 */
export function findBodyStartPage(normPages: string[], docTitle: string): number {
  // normalize 仅去空白，哨兵为纯大写字母，规整后不变
  const bySentinel = normPages.findIndex((p) => p.includes(BODY_START_SENTINEL))
  if (bySentinel >= 0) return bySentinel
  const needle = normalize(docTitle)
  if (!needle) return -1
  return normPages.findIndex((p) => p.includes(needle))
}

/**
 * 计算各目次目标的分区相对页码字符串。
 * @param pages    第一遍 PDF 逐页纯文本（pdftotext 按 \f 切分，未规整）
 * @param toc      目次目标（含分区与显示文本）
 * @param docTitle 正文首页文件名称（用于定位正文起始页）
 * @returns Map<target, 页码字符串>；未能定位的目标不入表
 */
export function computeTocPageNumbers(
  pages: string[],
  toc: TocTarget[],
  docTitle: string,
): Map<string, string> {
  const normPages = pages.map(normalize)
  const bodyStart = findBodyStartPage(normPages, docTitle)
  const result = new Map<string, string>()

  for (const item of toc) {
    const candidates = matchCandidates(item.text)
    if (candidates.length === 0) continue

    if (item.division === 'body') {
      // 正文目标：在正文起始页及之后取首个命中（标题先于任何对它的引用出现），
      // 从而排除目次页（位于正文之前）的同文本误命中。
      const from = bodyStart >= 0 ? bodyStart : 0
      const idx = indexOfFrom(normPages, candidates, from)
      if (idx < 0) continue
      const arabic = bodyStart >= 0 ? idx - bodyStart + 1 : idx + 1
      result.set(item.target, String(arabic))
    } else {
      // 前置目标（前言/引言）：同文本既在目次又在其真实页，真实页在后，
      // 故在正文之前的范围内取「最后一次」命中。
      const end = bodyStart >= 0 ? bodyStart : normPages.length
      const idx = lastIndexOfWithin(normPages, candidates, end)
      if (idx < 0) continue
      // 前置部分页码从物理第 1 页起编（无 counter-reset），故罗马数 = 物理页序
      result.set(item.target, toUpperRoman(idx + 1))
    }
  }
  return result
}

/** 在 [from, end) 中按候选优先级取首个命中页（完整文本优先于仅标题）。 */
function indexOfFrom(normPages: string[], candidates: string[], from: number): number {
  for (const needle of candidates) {
    for (let i = Math.max(0, from); i < normPages.length; i++) {
      if (normPages[i].includes(needle)) return i
    }
  }
  return -1
}

/**
 * 在 [0, end) 中按候选优先级取最后一次命中页（前置标题用）。
 * 前置标题（前言/引言）因全角字间隔被 pdftotext 拆分，故用字符按序子序列匹配而非连续子串，
 * 避免漏命中其真实所在页而误回退到目次页（致页码偏小）。
 */
function lastIndexOfWithin(normPages: string[], candidates: string[], end: number): number {
  for (const needle of candidates) {
    for (let i = Math.min(end, normPages.length) - 1; i >= 0; i--) {
      if (includesInOrder(normPages[i], needle)) return i
    }
  }
  return -1
}

/**
 * 移除正文首页隐藏哨兵锚点元素。
 * 哨兵仅供第一遍 pdftotext 定位正文起始物理页；最终（第二遍）HTML/PDF 不应保留此内部
 * 定位文本，否则会污染最终 PDF 的文本层（搜索/复制/无障碍）。两遍构建在注入目次页码后、
 * 第二遍构建前调用本函数剥离哨兵；剥离不改变版式（哨兵透明零高度），不影响分页。
 */
export function stripBodyAnchor(html: string): string {
  return html.replace(
    new RegExp(`<span class="ses-body-anchor"[^>]*>${BODY_START_SENTINEL}</span>`, 'g'),
    '',
  )
}

/**
 * 把页码写回 print 变体 HTML 的目次占位元素。
 * 渲染器（@ses/shared html.ts）输出形如
 *   `<span class="ses-toc-page" data-target="X">　</span>`（内容为 U+3000 占位）。
 * 占位元素 CSS 定宽（min-width:2em），注入纯文本数字后宽度不变，保证两遍分页一致。
 */
export function injectTocPageNumbers(
  html: string,
  numbers: Map<string, string>,
): string {
  return html.replace(
    /<span class="ses-toc-page" data-target="([^"]*)">[^<]*<\/span>/g,
    (match, target: string) => {
      const num = numbers.get(target)
      if (num === undefined) return match
      return `<span class="ses-toc-page" data-target="${target}">${escapeHtml(num)}</span>`
    },
  )
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
