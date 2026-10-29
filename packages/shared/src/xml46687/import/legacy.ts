import { getXmlAttr, isXmlElement } from '../tree'
import type { XmlDocument, XmlElement } from '../tree'
import { location } from './context'
import type { ImportProblem } from './contracts'

const legacyNames = new Set('basic_info auxiliary_info clg_item clg_id clg_name n_docum apd_item apd_id apd_body t_item t_id t_cn t_en t_def t_note t_exp tech_item tech_itid tech_itname tech_paragraph tech_paraid tech_paraname tech_part tech_ptid tech_ptname tech_ptbody'.split(' '))
const sepNames = new Set('pub-date tex-math preferred term-name term-note term-example'.split(' '))
export function detectLegacyXml46687(tree: XmlDocument): ImportProblem[] {
  const result: ImportProblem[] = []
  const visit = (el: XmlElement, parent?: XmlElement) => {
    const n = el.name.local
    const ns = el.name.ns ?? ''
    const a = (name: string) => getXmlAttr(el, null, name)
    const old37967 = ns.startsWith('http://www.xmlgb.org/') || (parent === tree.root && ['content', 'edit', 'execute'].includes(n)) || (el.name.ns === null && legacyNames.has(n))
    const oldSep = ns === 'urn:csbts:std:xml:1.0' || (el.name.ns === null && (sepNames.has(n) || (['foreword', 'intro'].includes(n) && ['body', 'front', 'standard'].includes(parent?.name.local ?? '')) || (n === 'fn' && a('fn-type') !== undefined) || (['title-wrap', 'caption'].includes(n) && a('lang') !== undefined) || (n === 'sec' && a('content-type') === 'untitled') || (n === 'custom-meta-group' && a('content-type') === 'ses-cover')))
    if (old37967 || oldSep) result.push({ code: 'legacy-format', severity: 'error', message: `不支持旧格式 XML（${old37967 ? 'GB/T 37967' : 'SEP 早期格式'}）：发现 ${n}`, xml: location(el) })
    for (const c of el.children) if (isXmlElement(c)) visit(c, el)
  }
  visit(tree.root)
  return result
}
