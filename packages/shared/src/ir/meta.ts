/**
 * IR 元数据的标准类型口径转换与数据库元数据映射（WP7.1）。
 *
 * 仓库里标准类型有两套取值：
 * - 文档库口径 `StandardType`（`../types/document.ts`）：national/industry/local/group/enterprise/guidance，
 *   存于数据库与编辑器根节点属性；
 * - IR 口径 `IRDocMeta['standardType']`（`./types.ts`）：gb/industry/local/group/enterprise/guide，定稿接口不改。
 *
 * 本文件只做增量：不改 IRDocMeta 已有字段名与类型。
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import type { DocumentMeta } from '../types/document'
import type { IRDocMeta } from './types'

export type IRStandardType = IRDocMeta['standardType']

/** 文档库口径 → IR 口径的映射表；也接受已经是 IR 口径的取值（gb、guide）原样通过 */
const DOC_TO_IR_STANDARD_TYPE: Record<string, IRStandardType> = {
  national: 'gb',
  guidance: 'guide',
  industry: 'industry',
  local: 'local',
  group: 'group',
  enterprise: 'enterprise',
  gb: 'gb',
  guide: 'guide',
}

/**
 * 文档库口径 → IR 口径：national→gb、guidance→guide；industry/local/group/enterprise 同名；
 * 也接受 gb、guide；其余（含 undefined）返回 undefined。
 */
export function toIrStandardType(t: string | undefined): IRStandardType | undefined {
  if (t === undefined) return undefined
  return DOC_TO_IR_STANDARD_TYPE[t]
}

/**
 * 数据库文档元数据 → IR 元数据覆盖项：titleCn→title、standardNo→stdCode，titleEn/icsCode/ccsCode/issuer/
 * applicant/publishDate/implementDate 同名复制，standardType 经 toIrStandardType。只跳过 undefined，空字符串
 * 照常复制（与现行 EditorView 的 buildDocMeta 一致）。proposer、technicalCommittee 不进 IR。
 */
export function irMetaFromDocumentMeta(meta: DocumentMeta | undefined): Partial<IRDocMeta> {
  const out: Partial<IRDocMeta> = {}
  if (!meta) return out
  const set = <K extends keyof IRDocMeta>(key: K, value: IRDocMeta[K] | undefined) => {
    if (value !== undefined) out[key] = value
  }
  set('title', meta.titleCn)
  set('titleEn', meta.titleEn)
  set('stdCode', meta.standardNo)
  set('icsCode', meta.icsCode)
  set('ccsCode', meta.ccsCode)
  set('issuer', meta.issuer)
  set('applicant', meta.applicant)
  set('publishDate', meta.publishDate)
  set('implementDate', meta.implementDate)
  set('standardType', toIrStandardType(meta.standardType))
  return out
}
