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
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold':
        out.push(['b', '<w:b/>'], ['bCs', '<w:bCs/>'])
        break
      case 'italic':
        out.push(['i', '<w:i/>'], ['iCs', '<w:iCs/>'])
        break
      case 'underline':
        out.push(['u', '<w:u w:val="single"/>'])
        break
      case 'sub':
        out.push(['vertAlign', '<w:vertAlign w:val="subscript"/>'])
        break
      case 'sup':
        out.push(['vertAlign', '<w:vertAlign w:val="superscript"/>'])
        break
      case 'crossRef':
        break // 不是格式；文字本身在 renderRun 里按 labels[targetId].refText 换掉
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
  const xref = marks.find((m) => m.type === 'crossRef')
  let text = run.text
  if (xref && xref.type === 'crossRef') {
    const resolved = labels[xref.targetId]
    text = resolved ? resolved.refText : run.text // 目标没有 label 时输出该 run 的原文（同 HTML 渲染器）
  }
  const rprChildren = markRprChildren(marks)
  const rprXml = rprChildren.length > 0 ? rPr(rprChildren) : ''
  return textRunsXml(text, rprXml)
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

export function breakRun(): string {
  return '<w:r><w:br/></w:r>'
}
