import { hasSemanticExtensions } from '../../ir/extensions'
import type { XmlDocument } from '../tree'
import type { MappingOptions, MappingResult } from './contracts'
import { createImportContext } from './context'
import { detectLegacyXml46687 } from './legacy'
import { mapCoreInline } from './inline'
import { mapMediaBlock, mapMediaInline } from './media'
import { mapBibliography, mapIndex, mapReferenceBlock, mapReferenceInline } from './refs'
import { mapCoreBlock, mapStructure } from './structure'
import { mapTerm } from './terms'
import { validateXml46687 } from './validate'

/** 同步纯映射；直接调用同样先验证，任何错误都不会返回部分文档。 */
export function mapXml46687(tree: XmlDocument, options: MappingOptions): MappingResult {
  const legacy = detectLegacyXml46687(tree)
  if (legacy.some(p => p.severity === 'error')) return { ir: null, problems: legacy }
  const validation = validateXml46687(tree).problems
  if (validation.some(p => p.severity === 'error')) return { ir: null, problems: validation }
  const ctx = createImportContext(tree, options, {
    inline: (element, context) => mapCoreInline(element, context) ?? mapMediaInline(element, context) ?? mapReferenceInline(element, context),
    block: (element, context) => mapCoreBlock(element, context) ?? mapMediaBlock(element, context) ?? mapReferenceBlock(element, context),
    term: mapTerm,
    references: mapBibliography,
    index: mapIndex,
  })
  if (ctx.problems.some(p => p.severity === 'error')) return { ir: null, problems: [...validation, ...ctx.problems] }
  const ir = mapStructure(tree, ctx)
  const problems = [...validation, ...ctx.problems]
  if (!ir || problems.some(p => p.severity === 'error')) return { ir: null, problems }
  if (hasSemanticExtensions(ir)) ir.extensionVersion = 1
  return { ir, problems }
}
