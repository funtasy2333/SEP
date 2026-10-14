/**
 * 行内渲染（docs/wp7-docx-delivery.md §5.5、§4.6）。
 *
 * marks → rPr：bold→b/bCs，italic→i/iCs，underline→u，sub/sup→vertAlign；crossRef 不是格式，
 * 按 §4.6 输出 labels[targetId].refText（无 label 时原样输出该 run 的文字），同一 run 上的
 * 其余 marks 照常作用。文本中的 \n 拆开输出，每个 \n 一个 `<w:r><w:br/></w:r>`（带同样的
 * rPr）；`w:t` 一律写 `xml:space="preserve"`。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import type { IRInline, NodeId, ResolvedLabel } from '../../../ir/types'
import { escapeXmlText, rPr, type XmlChild } from '../xml'

type Labels = Record<NodeId, ResolvedLabel>

function markRprChildren(marks: IRInline['marks']): XmlChild[] {
  const out: XmlChild[] = []
  // 去重：同一 mark 类型重复出现时只输出一次；sub/sup 都落在 vertAlign 这一个子元素名上，
  // 两者同时出现时只保留先出现的那个——否则会产出两个 w:b、两个 w:vertAlign，不符合
  // schema（rPr 的每个子元素至多一个，#34 审查；Word 16.113 能容忍，WPS 未验证）。
  const seen = new Set<string>()
  const add = (name: string, xml: string) => {
    if (seen.has(name)) return
    seen.add(name)
    out.push([name, xml])
  }
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold':
        add('b', '<w:b/>')
        add('bCs', '<w:bCs/>')
        break
      case 'italic':
        add('i', '<w:i/>')
        add('iCs', '<w:iCs/>')
        break
      case 'underline':
        add('u', '<w:u w:val="single"/>')
        break
      case 'sub':
        add('vertAlign', '<w:vertAlign w:val="subscript"/>')
        break
      case 'sup':
        add('vertAlign', '<w:vertAlign w:val="superscript"/>')
        break
      case 'crossRef':
        break // 不是格式；文字本身在 renderRun 里按 labels[targetId].refText 换掉
      case 'tableFootnoteRef':
        break // 文字来自 labels[targetId].refText，并以脚注上标样式输出
    }
  }
  return out
}

/** 按 \n 拆分文本，每个 \n 输出一个 `<w:r><w:br/></w:r>`（同样的 rPr），其余片段输出 `<w:t>` */
function textRunsXml(text: string, rprXml: string): string {
  const segments = text.split('\n')
  const parts: string[] = []
  segments.forEach((seg, i) => {
    if (seg !== '') parts.push(`<w:r>${rprXml}<w:t xml:space="preserve">${escapeXmlText(seg)}</w:t></w:r>`)
    if (i < segments.length - 1) parts.push(`<w:r>${rprXml}<w:br/></w:r>`)
  })
  return parts.join('')
}

/** 渲染一个 IRInline：crossRef 换成 refText，其余 marks 正常应用，\n 拆成 br */
export function renderRun(run: IRInline, labels: Labels): string {
  const marks = run.marks ?? []
  const textMarks = marks.filter((mark) => mark.type !== 'tableFootnoteRef')
  const xref = textMarks.find((mark) => mark.type === 'crossRef')
  let bodyText = run.text
  if (xref && xref.type === 'crossRef') {
    const resolved = labels[xref.targetId]
    bodyText = resolved ? resolved.refText : run.text // target without a label falls back to the author's source text
  }
  const rprChildren = markRprChildren(textMarks)
  const rprXml = rprChildren.length > 0 ? rPr(rprChildren) : ''
  const body = textRunsXml(bodyText, rprXml)

  let footnoteAtom = ''
  if (run.footnote) {
    const resolved = labels[run.footnote.id]
    if (!resolved) throw new Error(`renderRun: 条文脚注 "${run.footnote.id}" 在 labels 中没有编号`)
    const match = /^fn_(\d+)$/.exec(resolved.xmlId)
    const id = match ? Number(match[1]) : Number.NaN
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error(`renderRun: 条文脚注 "${run.footnote.id}" 的 xmlId "${resolved.xmlId}" 不是 fn_N`)
    }
    const markerRpr = rPr([['rStyle', '<w:rStyle w:val="FootnoteReference"/>']])
    const labelRpr = rPr([['vertAlign', '<w:vertAlign w:val="superscript"/>']])
    footnoteAtom = `<w:r>${markerRpr}<w:footnoteReference w:id="${id}" w:customMarkFollows="1"/></w:r>` +
      textRunsXml(resolved.refText, labelRpr)
  }

  const tableFootnoteRpr = rPr([['vertAlign', '<w:vertAlign w:val="superscript"/>']])
  let tableFootnoteAtoms = ''
  for (const mark of marks) {
    if (mark.type !== 'tableFootnoteRef') continue
    const resolved = labels[mark.targetId]
    if (!resolved) throw new Error(`renderRun: 表脚注 "${mark.targetId}" 在 labels 中没有编号`)
    // The table-footnote reference is a separate atom in IR→PM and therefore
    // receives only its own superscript treatment, never the source text marks.
    tableFootnoteAtoms += textRunsXml(resolved.refText, tableFootnoteRpr)
  }

  // Keep the same order as irToPm: source body, body footnote atom, then all
  // table-footnote reference atoms carried by this IR run.
  return `${body}${footnoteAtom}${tableFootnoteAtoms}`
}

/** 渲染一组 IRInline；数组为空时返回空串（段落层再据此决定是否输出不含 run 的段落） */
export function renderInlines(inlines: IRInline[], labels: Labels): string {
  return inlines.map((r) => renderRun(r, labels)).join('')
}

/** 纯文本 run（无 marks），用于字面量文字（如附录标识里的「（规范性）」） */
export function plainRun(text: string, rprXml = ''): string {
  return textRunsXml(text, rprXml)
}

/** `<w:rPr><w:spacing w:val="N"/></w:rPr>`：标题字距（§3.3），供 plainRun 的 rprXml 参数使用 */
export function spacingRpr(val: number): string {
  return rPr([['spacing', `<w:spacing w:val="${val}"/>`]])
}

export function tabRun(): string {
  return '<w:r><w:tab/></w:r>'
}

/** Superscript custom marker for body/table footnotes. */
export function superscriptRun(text: string): string {
  return textRunsXml(text, rPr([['vertAlign', '<w:vertAlign w:val="superscript"/>']]))
}

export function breakRun(): string {
  return '<w:r><w:br/></w:r>'
}

/** 长名称优先在已有中文标点或元素间空格处折成两行，不拆词或改写元数据。 */
export function wrapTitleAtSeparator(title: string, maxUnits: number): string {
  if (title.includes('\n')) return title
  const units = (value: string) => [...value].reduce((sum, char) => sum + (char.codePointAt(0)! < 128 ? 0.55 : 1), 0)
  if (units(title) <= maxUnits) return title
  let split = -1
  let balance = Infinity
  for (let index = 0; index < title.length - 1; index += 1) {
    if (!/[、，；：　]/.test(title[index]!)) continue
    const left = units(title.slice(0, index + 1)), right = units(title.slice(index + 1))
    if (left <= maxUnits && right <= maxUnits && Math.abs(left - right) < balance) {
      split = index + 1
      balance = Math.abs(left - right)
    }
  }
  return split < 0 ? title : title.slice(0, split) + '\n' + title.slice(split)
}
