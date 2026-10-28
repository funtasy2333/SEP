/**
 * 术语条目（含 G5 领域规则）与缩略语（WP8.2 设计 §1.2、§2.9、§2.12）。
 *
 * 术语条（§2.9）：`term-sec[@id=sec_<n>]` ＞ `label` + `tbx:termEntry[@id=term_<n>]` ＞ `tbx:langSet[@xml:lang]`+ ＞
 * （首个 `langSet`：`tbx:subjectField`?、`tbx:definition`、`tbx:example`*、`tbx:note`*、`tbx:source`?；每个 `langSet`：`tbx:tig`+）。
 * `tbx:tig` 内按 `tbx.rng` 的次序：`tbx:term`、`partOfSpeech`、`grammaticalNumber`、`normativeAuthorization`、`termType`
 * （描述符取值不在枚举 → error `xml-descriptor-value`，D-X-14；缺词性/采用级别只报 warning，不伪造）。
 *
 * - 语言集（D-X-13）：隐含集（`term` → zh、`termEn` → en）与显式 `languageSets` 按**主语言子标签**合并（`zh-Hans` → `zh`），
 *   同语言的 `tig` 追加在已有集之后、`xml:lang` 沿用已有集；新语言新增一个 `langSet`。条目级内容全部写入最终列表里的第一个 `langSet`；
 * - `subjectField`（§1.2，G5）：条目级优先；缺失时术语级描述符取值一致才提升（warning `term-subjectfield-promoted`），不一致
 *   error `term-subjectfield-conflict`；条目级与术语级并存时术语级被忽略（warning `term-subjectfield-duplicate`）；术语级的
 *   `subjectField` 描述符无论如何都不写进 `tig`；
 * - 注经 `registerPendingId` 登记（`nte_<术语号>-<k>`，仅被引用时写 id）；示例没有 `@id`；`tbx:see` 不输出；
 * - `nestedEntries` 由输出边界继续阻断（D-T-09）；术语条不在术语章 → error `xml-term-outside-terms`。
 *
 * 缩略语（§2.12）：`def-list[@list-content="abbreviation"]` ＞ `def-item`（仅被引用时写 `abb_<k>`）＞ `term` + `def>p`。
 */

import { canonicalTermTailOrder, sameTermTailOrder } from '../../ir/termTailOrder'
import type { IRBlock, IRDefList, IRInline, IRTermDescriptor, IRTermEntry } from '../../ir/types'
import type { XmlElement, XmlNode } from '../../xml46687/tree'
import type { Xml46687BoundaryContribution } from '../xml46687Boundary'
import { el, inlineHasContent, sub, type RenderContext, type Site } from './context'

export const XML46687_TERMS_BOUNDARY: Xml46687BoundaryContribution = {
  fields: {
    termEntry: ['subjectField', 'languageSets'],
    // BASE_FIELDS 里没有 defList：视为整个 kind 放行；项沿用 where 形状（outputBoundary 的默认链）
    defList: ['kind', 'id', 'items'],
    languageSet: ['id', 'language', 'groups'],
    termGroup: ['id', 'terms'],
    termVariant: ['id', 'content', 'descriptors'],
    termDescriptor: ['id', 'kind', 'value'],
  },
  shapes: [
    { parent: 'termEntry', key: 'languageSets', shape: 'languageSet' },
    { parent: 'languageSet', key: 'groups', shape: 'termGroup' },
    { parent: 'termGroup', key: 'terms', shape: 'termVariant' },
    { parent: 'termVariant', key: 'descriptors', shape: 'termDescriptor' },
  ],
  // IRTermDescriptor.kind 是描述符种类（partOfSpeech/subjectField……），不是节点 kind
  plainKindShapes: ['termDescriptor'],
  declared: [
    { pathSuffix: '.subjectField', kind: 'field', name: 'subjectField', matrixIds: ['M-9.2.9-01'], task: 'T2.4c', reason: '术语领域写成首个 langSet 内的 tbx:subjectField（G5，9.2.9）' },
    { pathSuffix: '.languageSets', kind: 'field', name: 'languageSets', matrixIds: ['M-9.2.1-06', 'M-9.2.1-07', 'M-9.2.3-01', 'M-9.2.3-02', 'M-9.2.3-03', 'M-9.2.3-04'], task: 'T2.4c', reason: 'TBX 语言集写成 tbx:langSet/tbx:tig 与描述符（9.2.1、9.2.3）' },
    { pathSuffix: '.kind', kind: 'kind', name: 'defList', matrixIds: ['M-10.1.4-01', 'M-10.1.4-03', 'M-10.1.4-04', 'M-10.1.4-05'], task: 'T2.4c', reason: '缩略语表写成 def-list[@list-content="abbreviation"]（10.1.4）' },
  ],
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 节点序列的纯文本（'text' 容器只产生文本节点；其余容器也递归取文字）。 */
function textOf(nodes: readonly XmlNode[]): string {
  return nodes.map((node) => (node.type === 'text' ? node.value : node.type === 'element' ? textOf(node.children) : '')).join('')
}

/** 行内数组渲染为纯文本（经 'text' 容器：marks 丢弃并告警，公式/行内图报错）。 */
function plainText(ctx: RenderContext, runs: readonly IRInline[], at: Site): string {
  return textOf(ctx.renderInlines(runs, at, 'text'))
}

/** 有实际可输出内容（文本去空白后非空，或公式、脚注、行内图）。 */
function hasContent(runs: readonly IRInline[]): boolean {
  return runs.some((run) => run.text.trim() !== '' || run.formula !== undefined || run.footnote !== undefined || run.image !== undefined)
}

const DESCRIPTOR_ENUMS = {
  partOfSpeech: ['noun', 'verb', 'adj', 'adv'],
  grammaticalNumber: ['singular', 'plural'],
  normativeAuthorization: ['preferredTerm', 'admittedTerm', 'deprecatedTerm'],
  termType: ['fullForm', 'abbreviation', 'symbol', 'formula'],
} as const
type DescriptorKind = keyof typeof DESCRIPTOR_ENUMS
/** 描述符在 `tbx:tig` 内的次序（`tbx.rng`：词性、语法数、采用级别、术语类型）。 */
const DESCRIPTOR_ORDER: readonly DescriptorKind[] = ['partOfSpeech', 'grammaticalNumber', 'normativeAuthorization', 'termType']
const DESCRIPTOR_NAMES: Readonly<Record<DescriptorKind, string>> = {
  partOfSpeech: '词性', grammaticalNumber: '语法数', normativeAuthorization: '采用级别', termType: '术语类型',
}
const isDescriptorKind = (kind: string): kind is DescriptorKind => (DESCRIPTOR_ORDER as readonly string[]).includes(kind)

// ---------------------------------------------------------------------------
// 术语名（tig）
// ---------------------------------------------------------------------------

interface TigInput {
  nameNodes: XmlNode[]
  descriptors: readonly IRTermDescriptor[]
  /** 变体（或隐含术语名）的定位；描述符的路径为 `${path}.descriptors[m]`。 */
  at: Site
  entryLabel: string
}

function buildTig(ctx: RenderContext, input: TigInput): XmlElement {
  const { nameNodes, descriptors, at, entryLabel } = input
  const values = new Map<DescriptorKind, string>()
  const present = new Set<DescriptorKind>()
  descriptors.forEach((descriptor, index) => {
    const descriptorSite = sub(at, `.descriptors[${index}]`, descriptor.id)
    // 术语级领域描述符由 G5 规则统一处理，永远不进 tig（tbx:tig 没有该元素）
    if (descriptor.kind === 'subjectField') return
    if (!isDescriptorKind(descriptor.kind)) {
      ctx.reportMerged('term-descriptor-not-expressed', 'warning', '术语描述符在 GB/T 46687.2 中没有对应元素，未导出',
        `术语条目${entryLabel}的「${descriptor.kind}」`, descriptorSite)
      return
    }
    const kind = descriptor.kind
    if (present.has(kind)) {
      ctx.report('xml-descriptor-duplicate', 'error', `同一术语变体里出现了多个「${kind}」（${DESCRIPTOR_NAMES[kind]}）描述符；tbx:tig 内每类描述符至多一个。`, descriptorSite)
      return
    }
    present.add(kind)
    const value = plainText(ctx, descriptor.value, sub(descriptorSite, '.value')).trim()
    if (!(DESCRIPTOR_ENUMS[kind] as readonly string[]).includes(value)) {
      ctx.report('xml-descriptor-value', 'error',
        `「${kind}」（${DESCRIPTOR_NAMES[kind]}）的取值${value === '' ? '为空' : `「${value}」`}不在 GB/T 46687.2 的取值范围内（${DESCRIPTOR_ENUMS[kind].join('、')}）。`, descriptorSite)
      return
    }
    values.set(kind, value)
  })

  const missing = (['partOfSpeech', 'normativeAuthorization'] as const).filter((kind) => !present.has(kind))
  if (missing.length > 0) {
    ctx.reportMerged('term-descriptor-missing', 'warning', '术语名缺少词性或采用级别，对应元素未输出（不推断、不伪造）',
      `术语条目${entryLabel}的术语名「${textOf(nameNodes).trim()}」缺${missing.map((kind) => DESCRIPTOR_NAMES[kind]).join('、')}`, at)
  }
  return el('tbx:tig', undefined, [
    el('tbx:term', undefined, nameNodes),
    ...DESCRIPTOR_ORDER.filter((kind) => values.has(kind)).map((kind) => el(`tbx:${kind}`, { value: values.get(kind) })),
  ])
}

// ---------------------------------------------------------------------------
// 语言集（D-X-13）
// ---------------------------------------------------------------------------

interface LanguagePlan {
  /** 主语言子标签（小写），合并键。 */
  key: string
  /** 写入 `xml:lang` 的取值：隐含集恒为 zh/en，新语言取 `language` 原文（去首尾空白）。 */
  lang: string
  tigs: XmlElement[]
}

const languageKey = (language: string): string => language.split(/[-_]/)[0]!.toLowerCase()

function buildLanguageSets(ctx: RenderContext, entry: IRTermEntry, at: Site, entryLabel: string): LanguagePlan[] {
  const plans: LanguagePlan[] = []
  const byKey = new Map<string, LanguagePlan>()
  const add = (plan: LanguagePlan): void => { plans.push(plan); byKey.set(plan.key, plan) }

  // 隐含集：term → zh，termEn → en
  if (hasContent(entry.term)) {
    const tigSite = sub(at, '.term')
    add({ key: 'zh', lang: 'zh', tigs: [buildTig(ctx, { nameNodes: ctx.renderInlines(entry.term, tigSite, 'inline'), descriptors: [], at: tigSite, entryLabel })] })
  }
  if (entry.termEn && hasContent(entry.termEn)) {
    const tigSite = sub(at, '.termEn')
    add({ key: 'en', lang: 'en', tigs: [buildTig(ctx, { nameNodes: ctx.renderInlines(entry.termEn, tigSite, 'inline'), descriptors: [], at: tigSite, entryLabel })] })
  }

  // 显式集，按数组序
  entry.languageSets?.forEach((set, setIndex) => {
    const setSite = sub(at, `.languageSets[${setIndex}]`, set.id)
    const language = typeof set.language === 'string' ? set.language.trim() : ''
    if (language === '') {
      ctx.report('term-language-missing', 'error', '术语语言集没有语言（xml:lang 必填）。', sub(setSite, '.language'))
      return
    }
    const tigs: XmlElement[] = []
    set.groups.forEach((group, groupIndex) => {
      const groupSite = sub(setSite, `.groups[${groupIndex}]`, group.id)
      group.terms.forEach((variant, variantIndex) => {
        const variantSite = sub(groupSite, `.terms[${variantIndex}]`, variant.id)
        if (!hasContent(variant.content)) {
          ctx.report('empty-content', 'warning', '术语变体没有术语名，已跳过（tbx:tig 必须有 tbx:term）。', sub(variantSite, '.content'))
          return
        }
        tigs.push(buildTig(ctx, {
          nameNodes: ctx.renderInlines(variant.content, sub(variantSite, '.content'), 'inline'),
          descriptors: variant.descriptors, at: variantSite, entryLabel,
        }))
      })
    })
    const key = languageKey(language)
    const existing = byKey.get(key)
    if (existing) {
      existing.tigs.push(...tigs)
      if (existing.lang !== language) {
        ctx.report('term-language-merged', 'info', `语言集「${language}」与已有的「${existing.lang}」主语言相同（${key}），已合并为同一个 langSet（xml:lang 沿用「${existing.lang}」）。`, setSite)
      }
    } else if (tigs.length === 0) {
      ctx.report('xml-term-empty', 'error', `术语语言集「${language}」里没有任何术语名（langSet 内至少要有一个 tbx:tig）。`, setSite)
    } else {
      add({ key, lang: language, tigs })
    }
  })
  return plans
}

// ---------------------------------------------------------------------------
// G5：subjectField（设计 §1.2）
// ---------------------------------------------------------------------------

/** 返回最终写出的领域文本（无则 undefined）；问题码见 §1.2。 */
function resolveSubjectField(ctx: RenderContext, entry: IRTermEntry, at: Site, entryLabel: string): string | undefined {
  const termLevel: Array<{ descriptor: IRTermDescriptor; at: Site }> = []
  entry.languageSets?.forEach((set, setIndex) => set.groups.forEach((group, groupIndex) => group.terms.forEach((variant, variantIndex) => {
    variant.descriptors.forEach((descriptor, descriptorIndex) => {
      if (descriptor.kind !== 'subjectField') return
      termLevel.push({
        descriptor,
        at: sub(at, `.languageSets[${setIndex}].groups[${groupIndex}].terms[${variantIndex}].descriptors[${descriptorIndex}]`, descriptor.id),
      })
    })
  })))

  const own = entry.subjectField === undefined ? '' : plainText(ctx, entry.subjectField, sub(at, '.subjectField')).trim()
  let text: string | undefined
  if (own !== '') {
    for (const item of termLevel) {
      ctx.report('term-subjectfield-duplicate', 'warning',
        `术语条目${entryLabel}已有条目级领域「${own}」，术语级的领域描述符被忽略（tbx:subjectField 只在 langSet 内、只有一个）。`, item.at)
    }
    text = own
  } else if (termLevel.length > 0) {
    const values = termLevel
      .map((item) => ({ id: item.descriptor.id, text: plainText(ctx, item.descriptor.value, sub(item.at, '.value')).trim() }))
      .filter((value) => value.text !== '')
    const distinct = [...new Set(values.map((value) => value.text))]
    if (distinct.length === 1) {
      text = distinct[0]
      ctx.report('term-subjectfield-promoted', 'warning',
        `术语条目${entryLabel}没有条目级领域，已把 ${values.length} 个取值一致的术语级领域描述符提升为条目级领域「${text}」。`, at)
    } else if (distinct.length > 1) {
      ctx.report('term-subjectfield-conflict', 'error',
        `术语条目${entryLabel}没有条目级领域，而术语级领域描述符取值不一致：${values.map((value) => `「${value.text}」（描述符 ${value.id}）`).join('、')}；请在条目级填写统一的领域。`, at)
    }
  }
  if (text !== undefined && /[〈〉]/.test(text)) {
    ctx.report('term-subjectfield-brackets', 'warning', `术语条目${entryLabel}的领域「${text}」含〈〉：括号由渲染阶段添加，内容里不应带（9.2.9），已原样输出。`, at)
  }
  return text
}

// ---------------------------------------------------------------------------
// 定义、示例、注、来源
// ---------------------------------------------------------------------------

/** 定义：全部段落用 `break` 连接成一个 `tbx:definition`（D-T-07）；非段落块 error；没有非空定义段 error（V-9）。 */
function renderDefinition(ctx: RenderContext, entry: IRTermEntry, at: Site): XmlElement | undefined {
  const pieces: XmlNode[][] = []
  entry.definition.forEach((block, index) => {
    const blockSite = sub(at, `.definition[${index}]`, block.id)
    if (block.kind !== 'paragraph') {
      ctx.report('xml-term-definition-block', 'error', `术语定义里只能放段落（tbx:definition 只容纳行内内容，多段用换行连接），不能放「${block.kind}」。`, blockSite)
      return
    }
    if (!inlineHasContent(block.content)) return
    pieces.push(ctx.renderInlines(block.content, sub(blockSite, '.content'), 'tbx'))
  })
  if (pieces.length === 0) {
    ctx.report('xml-term-no-definition', 'error', '术语条目没有定义：“每个术语条目必须有且仅有一个定义”（附录 C 行 92）。', sub(at, '.definition'))
    return undefined
  }
  const children: XmlNode[] = []
  pieces.forEach((nodes, index) => {
    if (index > 0) children.push(el('break'))
    children.push(...nodes)
  })
  return el('tbx:definition', undefined, children)
}

/** 示例/注的内容：恰为单个段落（行内内容）；多块或非段落 error `xml-note-content`；空内容 warning 并写出空元素。 */
function singleParagraph(ctx: RenderContext, content: readonly IRBlock[], at: Site, what: string): XmlNode[] | undefined {
  const contentSite = sub(at, '.content')
  if (content.length === 0) {
    ctx.report('empty-content', 'warning', `术语条目中的${what}没有内容，已写出空元素。`, contentSite)
    return []
  }
  const invalid = content.length > 1 ? `含 ${content.length} 个块` : content[0]!.kind !== 'paragraph' ? `是「${content[0]!.kind}」` : undefined
  if (invalid !== undefined) {
    ctx.report('xml-note-content', 'error', `术语条目中的${what}只能是单个段落（tbx 的${what}元素只容纳行内内容），现在${invalid}。`, contentSite)
    return undefined
  }
  const paragraph = content[0] as Extract<IRBlock, { kind: 'paragraph' }>
  const paragraphSite = sub(contentSite, '[0]', paragraph.id)
  if (!inlineHasContent(paragraph.content)) ctx.report('empty-content', 'warning', `术语条目中的${what}没有内容，已写出空元素。`, paragraphSite)
  return ctx.renderInlines(paragraph.content, sub(paragraphSite, '.content'), 'tbx')
}

// ---------------------------------------------------------------------------
// 术语条目
// ---------------------------------------------------------------------------

export function renderTermEntry(entry: IRTermEntry, at: Site, ctx: RenderContext): XmlElement[] {
  if (ctx.scope.chapter?.secType !== 'terms') {
    ctx.report('xml-term-outside-terms', 'error', '术语条目只能放在「术语和定义」章（secType 为 terms）内，此处（附录、引言或其他章）不能导出。', at)
    return []
  }
  const label = ctx.labelOf(entry.id)
  if (!label || label.xmlId === '' || label.label === '') {
    ctx.report('xml-label-missing', 'error', `术语条目在 Resolver 的 labels 中缺少编号或 xmlId（节点 ${entry.id}）。`, at)
  }
  if (!label?.termEntryXmlId) {
    ctx.report('xml-label-missing', 'error', `术语条目在 Resolver 的 labels 中缺少 termEntryXmlId（term_<编号>，节点 ${entry.id}）。`, at)
  }
  const entryLabel = label?.label ? `「${label.label}」` : `（${entry.id}）`

  const plans = buildLanguageSets(ctx, entry, at, entryLabel)
  if (plans.length === 0) {
    ctx.report('xml-term-empty', 'error', `术语条目${entryLabel}没有任何术语名（term、termEn 与语言集都为空）：langSet 内至少要有一个 tbx:tig。`, at)
  }

  const subjectField = resolveSubjectField(ctx, entry, at, entryLabel)
  const definition = renderDefinition(ctx, entry, at)

  const examples: XmlElement[] = []
  entry.examples.forEach((example, index) => {
    const nodes = singleParagraph(ctx, example.content, sub(at, `.examples[${index}]`, example.id), '示例')
    if (nodes) examples.push(el('tbx:example', undefined, nodes))
  })

  const notes: XmlElement[] = []
  entry.notes.forEach((note, index) => {
    const noteSite = sub(at, `.notes[${index}]`, note.id)
    const nodes = singleParagraph(ctx, note.content, noteSite, '注')
    if (!nodes) return
    const element = el('tbx:note', undefined, nodes)
    ctx.registerPendingId(note.id, element, noteSite)
    notes.push(element)
  })

  const source = entry.source !== undefined && inlineHasContent(entry.source)
    ? el('tbx:source', undefined, ctx.renderInlines(entry.source, sub(at, '.source'), 'text'))
    : undefined

  if (Array.isArray(entry.tailOrder) && !sameTermTailOrder(entry.tailOrder, canonicalTermTailOrder(entry, 'resolver'))) {
    ctx.report('term-tail-order-normalized', 'info', `术语条目${entryLabel}的尾项作者顺序与 XML 固定次序（领域、定义、示例、注、来源、术语名）不同，已按固定次序输出。`, sub(at, '.tailOrder'))
  }

  if (plans.length === 0) return []
  const langSets = plans.map((plan, index) => el('tbx:langSet', { 'xml:lang': plan.lang }, [
    ...(index === 0
      ? [
        subjectField === undefined ? null : el('tbx:subjectField', undefined, [subjectField]),
        definition,
        ...examples,
        ...notes,
        source,
      ]
      : []),
    ...plan.tigs,
  ]))
  return [
    el('term-sec', { id: label?.xmlId }, [
      el('label', undefined, [label?.label]),
      el('tbx:termEntry', { id: label?.termEntryXmlId }, langSets),
    ]),
  ]
}

// ---------------------------------------------------------------------------
// 缩略语（§2.12）
// ---------------------------------------------------------------------------

export function renderDefList(block: IRDefList, at: Site, ctx: RenderContext): XmlElement[] {
  if (block.items.length === 0) {
    ctx.report('xml-list-empty', 'error', '缩略语表没有任何项（def-list 至少需要一个 def-item）。', at)
    return []
  }
  const items = block.items.map((item, index): XmlElement => {
    const itemSite = sub(at, `.items[${index}]`, item.id)
    if (!hasContent(item.term)) ctx.report('empty-content', 'warning', '缩略语表的项没有缩略语，已写出空的 term。', sub(itemSite, '.term'))
    if (!hasContent(item.definition)) ctx.report('empty-content', 'warning', '缩略语表的项没有释义，已写出空的 p。', sub(itemSite, '.definition'))
    const element = el('def-item', undefined, [
      el('term', undefined, ctx.renderInlines(item.term, sub(itemSite, '.term'), 'term')),
      el('def', undefined, [el('p', undefined, ctx.renderInlines(item.definition, sub(itemSite, '.definition'), 'inline'))]),
    ])
    ctx.registerPendingId(item.id, element, itemSite)
    return element
  })
  return [el('def-list', { 'list-content': 'abbreviation' }, items)]
}
