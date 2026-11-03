import type { IRInline, IRMark } from '../../ir/types'
import type { XmlElement } from '../tree'
import type { ImportContext } from './context'

/** 混合内容按原始顺序保留；其他领域通过注入的处理器解析。 */
export function readInlineChildren(element: XmlElement, ctx: ImportContext): IRInline[] {
  const result: IRInline[] = []
  for (const child of element.children) {
    if (child.type === 'text') result.push({ text: child.value })
    else if (child.type === 'element') result.push(...(ctx.dispatchInline(child) ?? []))
  }
  return result
}

export function mapCoreInline(element: XmlElement, ctx: ImportContext): IRInline[] | undefined {
  if (element.name.ns !== null) return undefined
  const name = element.name.local
  if (name === 'monospace') ctx.report({ code: 'xml-normalized', severity: 'warning', message: '等宽文字已规范化为行内代码', xml: ctx.location(element), matrixId: 'M-5.1-05' })
  if (name === 'break') return [{ text: '\n' }]
  const types: Record<string, IRMark['type']> = {
    bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strike',
    sup: 'sup', sub: 'sub', monospace: 'code', 'inline-code': 'code',
  }
  let mark: IRMark | undefined
  if (name === 'named-content' && ctx.attr(element, null, 'content-type') === 'variable') mark = { type: 'variable' }
  else if (types[name]) mark = { type: types[name] } as IRMark
  else return undefined
  return readInlineChildren(element, ctx).map(run => ({
    ...run, marks: [mark!, ...(run.marks ?? []).filter(existing => existing.type !== mark!.type)],
  }))
}
