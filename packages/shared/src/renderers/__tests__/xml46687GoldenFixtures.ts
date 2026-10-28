/**
 * 黄金样例的派生夹具（T2.6，设计 §7.2）。
 *
 * 三份既有夹具（`fullRendererFixture()` 经 `pmToIr`、WP8.M 全要素 `createWp8mIrDoc()`、WP6 夹具经 `pmToIr`）不能原样按
 * GB/T 46687.2 导出：它们或缺 SES 必填元数据（D-X-02），或含有 46687.2 无法表达的结构。字节锁定的 `fixtures.ts`、`wp6.ts`
 * 不能改，所以在测试里用**纯函数**派生出可导出的 IR：每处改写都是一个有名字的步骤，注释写明原因与对应的错误码；
 * `skip` 参数可以跳过某一步，让对应的原始不可导出点重现——`xml46687.goldenSamples.test.ts` 的“原始夹具的不可导出点”
 * 对每个步骤保留一条反例测试，钉住错误码。
 *
 * 所有函数返回深拷贝，不修改入参。本文件不引用 client（shared 的 tsc 不允许）；WP6 夹具由测试文件导入并经 `pmToIr` 转成 IR 后传入。
 */

import type { IRBlock, IRChapter, IRClauseChild, IRDoc, IRInline, IRTable, IRTermEntry } from '../../ir/types'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 递归访问所有对象（含数组元素）。 */
function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) { for (const entry of value) walk(entry, visit); return }
  if (typeof value !== 'object' || value === null) return
  const node = value as Record<string, unknown>
  visit(node)
  for (const child of Object.values(node)) walk(child, visit)
}

/**
 * 补齐 SES 必填元数据（D-X-02）：发布机构、内容语言、发布日期、实施日期缺失时填入，已有的保持不变。
 * 不补题名（`withTitle` 另给）。对应告警码：`meta-required-missing`（缺机构/语言/日期为 warning，输出可能通不过
 * `validate.py` 的必备检查；黄金样例必须补齐）。
 */
export function completeSesMeta(input: IRDoc, withTitle?: string): IRDoc {
  const doc = clone(input)
  const { meta } = doc
  if (withTitle !== undefined && !meta.title && (meta.titleParts ?? []).length === 0) meta.title = withTitle
  if (!meta.issuer && (meta.publishers ?? []).length === 0) meta.issuer = '国家市场监督管理总局'
  if ((meta.languages ?? []).length === 0) meta.languages = [{ id: 'golden-lang-zh', tag: 'zh' }]
  if (!meta.publishDate) meta.publishDate = '2026-04-30'
  if (!meta.implementDate) meta.implementDate = '2026-11-01'
  return doc
}

/** WP8.M 派生夹具的改写步骤名（`skip` 用）。 */
export type Wp8mPatchStep = 'split-crossref-stdref' | 'move-cell-note' | 'move-appendix-term' | 'meta'

/**
 * WP8.M 全要素夹具 → 可导出的派生夹具。改写项（其余按实测原样导出）：
 *
 * - `split-crossref-stdref`：`g1-ch3-p2` 里同时带 `crossRef` 与 `stdRef` 的 run。`xref` 与 `std` 在 schema 中互不包含 →
 *   原样报 `xml-mark-combination`。拆成两个 run：`2`（仅 crossRef）与 `GB/T 20000.1—2014`（仅 stdRef）。
 * - `move-cell-note`：`g7-t1-note`（表格单元格里的注）。单元格内只能放段落和列表（schema `cm.cell-content`）→ 原样报
 *   `xml-cell-content`。移出单元格，改为该表的表注（`notes`）；单元格留一个说明段落。
 * - `move-appendix-term`：`g5-t-app`（附录里的术语条目）。术语条目只能在术语和定义章内（WP8.1 V-2、C-S-25、C-T-37）→ 原样报
 *   `xml-term-outside-terms`。移入术语章末尾；附录留一个说明段落。
 * - `meta`：SES 必填元数据（`completeSesMeta`，另补题名）。缺题名为 error `meta-required-missing`，缺其余四项为同码 warning。
 */
export function patchWp8mForXml(input: IRDoc, skip: readonly Wp8mPatchStep[] = []): IRDoc {
  const doc = skip.includes('meta') ? clone(input) : completeSesMeta(input, 'WP8.M 全要素样例')

  if (!skip.includes('split-crossref-stdref')) {
    let found = false
    walk(doc.body, node => {
      if (node.id !== 'g1-ch3-p2' || node.kind !== 'paragraph') return
      const content = node.content as IRInline[]
      const index = content.findIndex(run => (run.marks ?? []).some(mark => mark.type === 'crossRef') && (run.marks ?? []).some(mark => mark.type === 'stdRef'))
      if (index < 0) throw new Error('patchWp8mForXml: 找不到 g1-ch3-p2 里同时带 crossRef 与 stdRef 的 run')
      const original = content[index]!
      const crossRef = original.marks!.find(mark => mark.type === 'crossRef')!
      content.splice(index, 1, { text: original.text, marks: [crossRef] }, { text: 'GB/T 20000.1—2014', marks: [{ type: 'stdRef' }] })
      found = true
    })
    if (!found) throw new Error('patchWp8mForXml: 找不到段落 g1-ch3-p2')
  }

  if (!skip.includes('move-cell-note')) {
    let found = false
    walk(doc.body, node => {
      if (node.id !== 'g7-t1' || node.kind !== 'table') return
      const table = node as unknown as IRTable
      for (const row of table.rows) {
        for (const cell of row.cells) {
          const noteIndex = cell.content.findIndex(block => block.kind === 'note' && block.id === 'g7-t1-note')
          if (noteIndex < 0) continue
          const [note] = cell.content.splice(noteIndex, 1) as IRBlock[]
          cell.content.push({ kind: 'paragraph', id: 'g7-t1-c2-p', content: [{ text: '详见表注。' }] })
          table.notes.push(note as IRTable['notes'][number])
          found = true
        }
      }
    })
    if (!found) throw new Error('patchWp8mForXml: 找不到单元格里的 g7-t1-note')
  }

  if (!skip.includes('move-appendix-term')) {
    const termsChapter = doc.body.find((chapter): chapter is IRChapter => chapter.secType === 'terms')
    const appendix = doc.appendices.find(entry => entry.children.some(child => child.kind === 'termEntry' && child.id === 'g5-t-app'))
    if (!termsChapter || !appendix) throw new Error('patchWp8mForXml: 找不到术语章或含 g5-t-app 的附录')
    const entry = appendix.children.find((child): child is IRTermEntry => child.kind === 'termEntry' && child.id === 'g5-t-app')!
    appendix.children = [{ kind: 'paragraph', id: 'g5-app-p', content: [{ text: '本附录的术语见术语和定义一章。' }] } as IRBlock]
    termsChapter.children.push(entry as IRClauseChild)
  }
  return doc
}

/** WP6 派生夹具的改写步骤名（`skip` 用）。 */
export type Wp6PatchStep = 'figure-groups' | 'inline-style' | 'part-of-speech' | 'mathml-namespace' | 'move-term' | 'cell-unit' | 'meta'

/**
 * WP6 夹具（经 `pmToIr`）→ 可导出的派生夹具。改写项（其余按实测原样导出）：
 *
 * - `figure-groups`：`figure.groups`（多资源/分图）在 46687.2 中无写法，输出边界永久阻断 → 原样报 `unsupported-output`（D-T-11、D-M-12）。去掉。
 * - `inline-style`：行内 `style`（字体、颜色……），D-S-06，输出边界永久阻断 → 原样报 `unsupported-output`。去掉。
 * - `part-of-speech`：术语描述符 `partOfSpeech='名词'` 不在 `tbx.rng` 枚举 `noun/verb/adj/adv` 内 → 原样报 `xml-descriptor-value`（D-X-14）。改为 `noun`。
 * - `mathml-namespace`：行内公式的 `mathml` 是 `<math>…`（没有 MathML 命名空间），设计 §4.5 的契约要求根元素在 MathML 命名空间内 →
 *   原样报 `mathml-invalid`。给根元素补 `xmlns="http://www.w3.org/1998/Math/MathML"`，其余不动。
 * - `move-term`：术语条目 `term-main` 放在普通章的条里。术语条目只能在术语和定义章内（WP8.1 V-2、C-S-25、C-T-37）→ 原样报
 *   `xml-term-outside-terms`；它占着条内位置，后面的块因“子条之后不能再有块”报 `xml-block-after-subsec`，对它的引用报 `xml-rid-unresolved`。
 *   移入新增的术语和定义章（`secType: 'terms'`，追加在正文最后）；对它的 `termRef` 仍在原段落里（章外引用 → `xref[custom=term-entry]`）。
 * - `cell-unit`：非表头单元格的 `unit`（`table-cell-1` 带 `mm`）。46687.2 只规定了表头单元格的单位（6.2.4）→ 原样报 `cell-unit-unsupported`（D-X-03）。去掉。
 * - `meta`：SES 必填元数据（`completeSesMeta`）。
 */
export function patchWp6ForXml(input: IRDoc, skip: readonly Wp6PatchStep[] = []): IRDoc {
  const doc = skip.includes('meta') ? clone(input) : completeSesMeta(input)

  if (!skip.includes('move-term')) {
    const movedTerms: IRTermEntry[] = []
    const detachTerms = (children: IRClauseChild[]): IRClauseChild[] =>
      children.filter(child => {
        if (child.kind === 'termEntry') { movedTerms.push(child); return false }
        if (child.kind === 'clause') child.children = detachTerms(child.children)
        return true
      })
    for (const chapter of doc.body) if (chapter.secType !== 'terms') chapter.children = detachTerms(chapter.children) as IRChapter['children']
    if (movedTerms.length > 0) {
      doc.body.push({ kind: 'chapter', id: 'golden-terms', secType: 'terms', title: [{ text: '术语和定义' }], children: movedTerms })
    }
  }

  walk(doc, node => {
    if (!skip.includes('mathml-namespace') && typeof node.mathml === 'string') {
      node.mathml = node.mathml.replace(/^<math(?![^>]*\bxmlns=)/, '<math xmlns="http://www.w3.org/1998/Math/MathML"')
    }
    if (!skip.includes('figure-groups') && node.kind === 'figure') delete node.groups
    // 表格单元格 { id, colspan, rowspan, header, content, unit? }
    if (!skip.includes('cell-unit') && typeof node.colspan === 'number' && node.header === false) delete node.unit
    // 行内 run：有 text 字符串；单元格/表/行的 style 所在对象没有 text 字段
    if (!skip.includes('inline-style') && typeof node.text === 'string' && 'style' in node) delete node.style
    // 术语描述符 { id, kind: 'partOfSpeech', value: IRInline[] }
    if (!skip.includes('part-of-speech') && node.kind === 'partOfSpeech' && Array.isArray(node.value)) {
      const value = node.value as IRInline[]
      if (value.length === 1 && value[0]!.text === '名词') value[0]!.text = 'noun'
    }
  })
  return doc
}

/** `fullRendererFixture()` 经 `pmToIr` 后只缺内容语言：补齐 SES 必填元数据即可导出（`skip` 含 `meta` 时原样）。 */
export function patchFullRendererForXml(input: IRDoc, skip: readonly 'meta'[] = []): IRDoc {
  return skip.includes('meta') ? clone(input) : completeSesMeta(input)
}
