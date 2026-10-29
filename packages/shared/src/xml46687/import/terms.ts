import type { IRBlock, IRInline, IRTermDescriptor, IRTermEntry, IRTermGroup, IRTermLanguageSet, IRTermTailOrderItem } from '../../ir/types'
import { isXmlElement } from '../tree'
import type { XmlElement } from '../tree'
import type { ImportContext } from './context'
import { readInlineChildren } from './inline'

const TBX = 'urn:iso:std:iso:30042:ed-1'
const XML = 'http://www.w3.org/XML/1998/namespace'
const els = (e: XmlElement) => e.children.filter(isXmlElement)
function issue(e: XmlElement, ctx: ImportContext, message: string, warning = false, count = false) {
  ctx.report({ code: count ? 'xml-term-definition-count' : warning ? 'xml-normalized' : 'xml-unsupported', severity: warning ? 'warning' : 'error', message, xml: ctx.location(e) })
}
function structural(e: XmlElement, ctx: ImportContext) {
  if (e.children.some(c => c.type === 'text' && c.value.trim())) issue(e, ctx, '术语结构包含无法映射的文本')
}
function id(e: XmlElement, ctx: ImportContext) { return ctx.elementId(e) ?? '' }
function containsStd(e: XmlElement): boolean { return els(e).some(c => (c.name.ns === null && c.name.local === 'std') || containsStd(c)) }
export function mapTerm(e: XmlElement, ctx: ImportContext): IRTermEntry | undefined {
  if (e.name.ns !== null || e.name.local !== 'term-sec') return undefined
  structural(e, ctx)
  const entries = els(e).filter(c => c.name.ns === TBX && c.name.local === 'termEntry')
  if (entries.length !== 1 || els(e).some(c => c !== entries[0] && !(c.name.ns === null && c.name.local === 'label'))) issue(e, ctx, '术语条必须包含一个 TBX 条目')
  const entry = entries[0]
  const result: IRTermEntry = { kind: 'termEntry', id: id(e, ctx), term: [], definition: [], notes: [], examples: [], languageSets: [] }
  if (!entry) return result
  structural(entry, ctx)
  const tail: IRTermTailOrderItem[] = []
  const subjects: IRInline[][] = []
  let definitionCount = 0
  const languageKeys = new Set<string>()
  for (const set of els(entry)) {
    if (set.name.ns !== TBX || set.name.local !== 'langSet') { issue(set, ctx, '术语条目包含未知结构'); continue }
    structural(set, ctx)
    const language = ctx.attr(set, XML, 'lang')
    if (!language) issue(set, ctx, '术语语言集缺少语言')
    const key = language?.split('-')[0]?.toLowerCase()
    if (key && languageKeys.has(key)) issue(set, ctx, '同一主语言的语言集在导出时会合并', true)
    if (key) languageKeys.add(key)
    const groups: IRTermGroup[] = []
    const languageSet: IRTermLanguageSet = { id: id(set, ctx), language: language ?? '', groups }
    for (const part of els(set)) {
      if (part.name.ns !== TBX) { issue(part, ctx, '术语语言集包含未知结构'); continue }
      switch (part.name.local) {
        case 'tig': {
          structural(part, ctx)
          const terms: IRTermGroup['terms'] = []
          for (const child of els(part)) {
            if (child.name.ns !== TBX) { issue(child, ctx, '术语组包含未知结构'); continue }
            if (child.name.local === 'term') terms.push({ id: id(child, ctx), content: readInlineChildren(child, ctx), descriptors: [] })
            else if (['partOfSpeech', 'grammaticalNumber', 'normativeAuthorization', 'normativeAuthentication', 'termType'].includes(child.name.local)) {
              const variant = terms[terms.length - 1]
              if (!variant) { issue(child, ctx, '描述符缺少前置术语'); continue }
              const value = ctx.attr(child, null, 'value')
              if (value === undefined || els(child).length || child.children.some(c => c.type === 'text' && c.value.trim())) issue(child, ctx, '术语描述符必须使用 value')
              const descriptor: IRTermDescriptor = { id: id(child, ctx), kind: child.name.local === 'normativeAuthentication' ? 'normativeAuthorization' : child.name.local, value: [{ text: value ?? '' }] }
              variant.descriptors.push(descriptor)
            } else issue(child, ctx, '未知术语描述符')
          }
          if (!terms.length) issue(part, ctx, '术语组缺少术语')
          groups.push({ id: id(part, ctx), terms })
          break
        }
        case 'subjectField': subjects.push(readInlineChildren(part, ctx)); break
        case 'definition': {
          definitionCount++
          const p: IRBlock = { kind: 'paragraph', id: id(part, ctx), content: readInlineChildren(part, ctx) }
          if (result.definition.length) tail.push({ kind: 'definition', index: result.definition.length - 1 })
          result.definition.push(p)
          break
        }
        case 'source':
          if (containsStd(part)) issue(part, ctx, '术语来源不允许 std')
          if (result.source) issue(part, ctx, '术语来源不能重复')
          else { result.source = readInlineChildren(part, ctx); tail.push({ kind: 'source', index: 0 }) }
          break
        case 'note': case 'example': {
          const paragraphId = ctx.singleParagraphId(part) ?? ''
          const block: IRBlock = { kind: 'paragraph', id: paragraphId, content: readInlineChildren(part, ctx) }
          if (part.name.local === 'note') { tail.push({ kind: 'note', index: result.notes.length }); result.notes.push({ kind: 'note', id: id(part, ctx), content: [block] }) }
          else { tail.push({ kind: 'example', index: result.examples.length }); result.examples.push({ kind: 'example', id: id(part, ctx), content: [block] }) }
          break
        }
        default: issue(part, ctx, '术语语言集包含未知结构')
      }
    }
    if (!groups.length) issue(set, ctx, '术语语言集缺少术语组')
    tail.push({ kind: 'languageSet', index: result.languageSets!.length })
    result.languageSets!.push(languageSet)
  }
  if (definitionCount !== 1) issue(entry, ctx, '术语条目必须恰有一个定义', false, true)
  if (subjects.length) {
    result.subjectField = subjects.flatMap((s, i) => [...(i ? [{ text: '；' }] : []), ...s])
    if (subjects.length > 1) issue(entry, ctx, '多个术语领域已合并', true)
  }
  if (tail.length) result.tailOrder = tail
  return result
}
