/**
 * 写作片段归一化（WP9.2b）。
 *
 * AI（经 MCP）向文档插入、替换内容时使用宽松的「写作片段」：id 可省略、可推导字段可省略、
 * 行内内容可写字符串。{@link normalizeAuthoringFragment} 把它归一化为合法的 IR 节点，
 * 再由 irToPm.ts 的 `irFragmentToPm` 投影为生产 ProseMirror JSON。
 *
 * 错误处理：**不抛异常**，返回带路径的问题列表（一次报全，不在第一个错误处停下）。
 * 选择理由：批量写入（apply_operations）要把多个操作的问题聚合后整批拒绝，返回结果比
 * try/catch 更直接；而投影沿用 `irToPm` 的约定抛 `IRToPmError`。
 *
 * 同构纯 TypeScript：不引用浏览器或 Node 专有 API，不引入依赖，不计算任何编号（编号只在 Resolver）。
 *
 * 写作规则的完整说明见 docs/wp9-authoring-reference.md（WP9.3 `get_authoring_reference` 的唯一来源），
 * 其中的示例由测试直接读取并校验。
 */
import { diagnoseInlineProjection } from './inlineProjectionDiagnostics'
import type { IRToPmDiagnostic } from './irToPm'
import {
  describeAuthoringContext, fragmentContextRules, validateAuthoringContext,
  type AuthoringContext, type FragmentContextRules, type FragmentLevel, type IRFragmentNode,
} from './fragmentContext'
import { generateNodeId } from './nodeId'
import type {
  IRAppendix, IRBibEntry, IRBlock, IRChapter, IRClause, IRClauseChild, IRExample, IRFigure,
  IRFormula, IRInline, IRList, IRMark, IRNote, IRParagraph, IRReferenceTargetKind, IRTable,
  IRTableRow, IRTermEntry,
} from './types'

// ---------- 公开类型 ----------

/** 写作片段支持的块种类。warning / quote / code 等 IR 扩展块暂不支持。 */
export const AUTHORING_BLOCK_KINDS = [
  'paragraph', 'list', 'table', 'figure', 'formula', 'note', 'example',
] as const

/** 写作片段支持的全部节点种类（`kind` 取值）。 */
export const AUTHORING_NODE_KINDS = [
  ...AUTHORING_BLOCK_KINDS, 'clause', 'termEntry', 'chapter', 'appendix', 'bibEntry',
] as const

export type AuthoringNodeKind = typeof AUTHORING_NODE_KINDS[number]

/**
 * 问题代码（稳定的机器可读标识）。含义：
 * - invalid-context：上下文本身无效
 * - empty-fragment：片段为空
 * - invalid-type：JSON 类型不对
 * - missing-field：缺少必填字段
 * - unknown-field：未知字段（多为拼写错误）
 * - unsupported-field：IR 里存在、但写作片段暂不支持的字段
 * - unknown-kind：未知的 kind
 * - unsupported-kind：IR 里存在、但写作片段暂不支持的块（warning/quote/code/defList）
 * - not-allowed-here：此种节点不能放在该上下文/容器中
 * - invalid-value：取值非法（枚举、格式、范围）
 * - empty-value：必须非空的内容为空
 * - invalid-id：id 不是非空字符串、违反派生规则，或是保留名（见 {@link AuthoringNormalizeOptions.reservedIds}）
 * - duplicate-id：片段内 id 重复
 * - id-conflict：与文档中已有 id 冲突
 * - level-mismatch：显式层级与插入位置推导的层级不一致
 * - inline-projection：行内标记组合无法在生产 schema 中保留
 * - table-grid：表格行列占用不一致
 */
export const AUTHORING_ISSUE_CODES = [
  'invalid-context', 'empty-fragment', 'invalid-type', 'missing-field', 'unknown-field',
  'unsupported-field', 'unknown-kind', 'unsupported-kind', 'not-allowed-here', 'invalid-value',
  'empty-value', 'invalid-id', 'duplicate-id', 'id-conflict', 'level-mismatch',
  'inline-projection', 'table-grid',
] as const

export type AuthoringIssueCode = typeof AUTHORING_ISSUE_CODES[number]

export interface AuthoringIssue {
  /** 问题位置，以 `rootPath`（默认 `fragment`）开头，如 `fragment[0].children[1].title`。 */
  path: string
  code: AuthoringIssueCode
  /** 中文原因，面向 AI 与最终用户。 */
  reason: string
  /** 相关节点 id（已知时）。 */
  nodeId?: string
}

export interface AuthoringNormalizeOptions {
  /** 文档中已有的 nodeId（不含将被本次替换掉的子树）；片段内的 id 不得与之冲突，生成的 id 会避开它们。 */
  existingIds?: ReadonlySet<string>
  /**
   * 保留 id：显式 `id` 命中时报 `invalid-id`，自动生成的 id 也会避开它们。默认没有保留 id。
   *
   * 供宿主声明「这些名字另有所指，不能用作节点 id」。文档操作引擎（`@ses/io`）传入五个容器名
   * （foreword / introduction / body / appendices / bibliography）：操作的 `parent` 先按容器名解析，
   * id 为容器名的章、条、附录将永远无法作为 insert / move 的父节点，所以写入时就拒绝。
   *
   * 只约束本次片段里**新写入**的 id。文档里已有的保留名 id（例如经 REST 直接写入的内容）不在此列：
   * 这里不会改写它们，`nodeId` 规范化也不处理保留名；replace 时若片段沿用这样的原 id，同样会被拒绝。
   */
  reservedIds?: ReadonlySet<string>
  /** 自定义 id 生成器（默认 {@link generateNodeId}）；供测试注入确定性序列。 */
  generateId?: () => string
  /** 问题路径的根名称，默认 `fragment`。 */
  rootPath?: string
}

export type AuthoringNormalizeResult =
  | { ok: true; nodes: IRFragmentNode[] }
  | { ok: false; issues: AuthoringIssue[] }

// ---------- 内部：基础工具 ----------

type Obj = Record<string, unknown>

const isObj = (value: unknown): value is Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const has = (obj: Obj, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined

const own = (obj: Obj, key: string): unknown => has(obj, key) ? obj[key] : undefined

const KIND_LABELS: Record<string, string> = {
  paragraph: '段落', list: '列项', table: '表', figure: '图', formula: '公式', note: '注',
  example: '示例', clause: '条', termEntry: '术语条目', chapter: '章', appendix: '附录',
  bibEntry: '参考文献条目',
}

const label = (kind: string): string => `${kind}（${KIND_LABELS[kind] ?? kind}）`

/** 各对象支持的字段；节点种类（有 `kind` 的对象）的字段表含 `kind` 与 `id`。 */
const FIELDS = {
  paragraph: ['kind', 'id', 'content'],
  list: ['kind', 'id', 'listType', 'level', 'items'],
  listItem: ['id', 'content'],
  table: ['kind', 'id', 'caption', 'captionEn', 'orientation', 'headerRowCount', 'rows', 'notes'],
  row: ['id', 'cells'],
  cell: ['id', 'content', 'colspan', 'rowspan', 'header'],
  figure: ['kind', 'id', 'caption', 'captionEn', 'orientation', 'src', 'alt', 'notes'],
  formula: ['kind', 'id', 'latex', 'numbered', 'whereList'],
  whereItem: ['id', 'term', 'definition'],
  note: ['kind', 'id', 'content'],
  example: ['kind', 'id', 'content'],
  clause: ['kind', 'id', 'level', 'titled', 'title', 'children'],
  termEntry: ['kind', 'id', 'level', 'term', 'termEn', 'definition', 'source', 'notes', 'examples'],
  chapter: ['kind', 'id', 'secType', 'title', 'children'],
  appendix: ['kind', 'id', 'normative', 'title', 'children'],
  bibEntry: ['kind', 'id', 'content'],
  run: ['text', 'marks', 'formula'],
  inlineFormula: ['id', 'latex'],
} as const

/**
 * 各节点种类的顶层字段（含 `kind`、`id`），供生成 MCP 工具 schema 与核对说明文档使用。
 * 嵌套对象（列项项、表行、单元格、式中项、行内片段）的字段见 {@link FIELDS} 中的同名条目，不对外公开。
 */
export const AUTHORING_NODE_FIELDS: { readonly [K in AuthoringNodeKind]: readonly string[] } = {
  paragraph: FIELDS.paragraph, list: FIELDS.list, table: FIELDS.table, figure: FIELDS.figure,
  formula: FIELDS.formula, note: FIELDS.note, example: FIELDS.example, clause: FIELDS.clause,
  termEntry: FIELDS.termEntry, chapter: FIELDS.chapter, appendix: FIELDS.appendix, bibEntry: FIELDS.bibEntry,
}

type FieldOwner = keyof typeof FIELDS

const OWNER_LABELS: Record<FieldOwner, string> = {
  paragraph: '段落', list: '列项', listItem: '列项项', table: '表', row: '表行', cell: '单元格',
  figure: '图', formula: '公式', whereItem: '式中项', note: '注', example: '示例', clause: '条',
  termEntry: '术语条目', chapter: '章', appendix: '附录', bibEntry: '参考文献条目', run: '行内片段',
  inlineFormula: '行内公式',
}

/** IR 里有、但写作片段暂不支持的字段：给出专门的提示，而不是笼统的「未知字段」。 */
const IR_ONLY_FIELDS: Partial<Record<FieldOwner, readonly string[]>> = {
  run: ['style', 'footnote'],
  inlineFormula: ['mathml', 'source'],
  table: ['width', 'style', 'unit', 'footnotes'],
  figure: ['title', 'unit', 'resourceId', 'imageWidth', 'imageHeight', 'descriptions', 'groups'],
  formula: ['mathml', 'sourceInlines', 'notes'],
  termEntry: ['nestedEntries', 'languageSets', 'tailOrder', 'subjectField'],
  bibEntry: ['entryType', 'fields', 'identifiers', 'externalLink'],
}

const REFERENCE_KINDS: readonly IRReferenceTargetKind[] = [
  'chapter', 'clause', 'appendix', 'figure', 'table', 'formula',
  'note', 'example', 'bibliography', 'term', 'index', 'paragraph', 'listItem', 'abbreviation',
]

const SIMPLE_MARKS = ['bold', 'italic', 'underline', 'sub', 'sup', 'strike', 'code'] as const

/** 写作片段支持的行内标记类型（`tableFootnoteRef` 不在其中）。 */
export const AUTHORING_MARK_TYPES = [
  ...SIMPLE_MARKS, 'variable', 'externalLink', 'crossRef', 'bibRef', 'termRef',
] as const
const SUPPORTED_MARK_TYPES: readonly string[] = AUTHORING_MARK_TYPES

/** 与 pmToIr 的 `CHAPTER_SEC_TYPES` 一致（测试里有对拍）。 */
const CHAPTER_SEC_TYPES: { match: RegExp; secType: IRChapter['secType'] }[] = [
  { match: /^范围$/, secType: 'scope' },
  { match: /^规范性引用文件$/, secType: 'norm-refs' },
  { match: /^术语和定义$/, secType: 'terms' },
]

/** 单元格 colspan/rowspan 上限：防止异常输入撑出巨大的占用网格。 */
const MAX_SPAN = 100

// ---------- 内部：归一化上下文 ----------

class Ctx {
  readonly issues: AuthoringIssue[] = []
  private readonly used = new Map<string, string>()
  private readonly declared: Set<string>
  private readonly existing: ReadonlySet<string>
  private readonly reserved: ReadonlySet<string>
  private readonly generate: () => string

  constructor(input: unknown, options: AuthoringNormalizeOptions) {
    this.existing = options.existingIds ?? new Set<string>()
    this.reserved = options.reservedIds ?? new Set<string>()
    this.generate = options.generateId ?? generateNodeId
    this.declared = collectDeclaredIds(input)
  }

  issue(path: string, code: AuthoringIssueCode, reason: string, nodeId?: string): void {
    this.issues.push({ path, code, reason, ...(nodeId === undefined ? {} : { nodeId }) })
  }

  /** 登记一个 id；重复或与已有 id 冲突时记录问题但仍返回该 id（继续收集其余问题）。 */
  claim(id: string, path: string): string {
    const first = this.used.get(id)
    if (first !== undefined) {
      this.issue(path, 'duplicate-id', `id「${id}」在片段内重复（首次出现于 ${first}）`, id)
    } else if (this.existing.has(id)) {
      this.issue(path, 'id-conflict', `id「${id}」已存在于文档中，请换一个或省略以自动生成`, id)
    } else {
      this.used.set(id, path)
    }
    return id
  }

  /** 生成一个不与片段内、已有 id、保留 id、以及片段中任何显式 id 冲突的新 id。 */
  fresh(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = this.generate()
      if (typeof id === 'string' && id.length > 0
        && !this.used.has(id) && !this.existing.has(id) && !this.reserved.has(id) && !this.declared.has(id)) {
        this.used.set(id, '（自动生成）')
        return id
      }
    }
    throw new Error('无法生成不冲突的 nodeId：id 生成器连续返回重复或空值')
  }

  /** 读取对象的 `id`：缺省时生成；给出时必须是非空字符串。 */
  idOf(obj: Obj, path: string): string {
    const raw = own(obj, 'id')
    if (raw === undefined) return this.fresh()
    if (typeof raw !== 'string' || raw.length === 0) {
      this.issue(`${path}.id`, 'invalid-id', 'id 必须是非空字符串；不需要指定时请省略该字段')
      return this.fresh()
    }
    if (this.reserved.has(raw)) {
      this.issue(`${path}.id`, 'invalid-id', `id「${raw}」是保留的容器名，不能用作节点 id；请换一个，或省略以自动生成`, raw)
      return this.fresh()
    }
    return this.claim(raw, `${path}.id`)
  }
}

/** 预先收集输入里出现的所有显式 `id`，保证生成的 id 不会撞上稍后才出现的显式 id。 */
function collectDeclaredIds(input: unknown): Set<string> {
  const ids = new Set<string>()
  const seen = new Set<object>()
  const stack: unknown[] = [input]
  while (stack.length > 0) {
    const value = stack.pop()
    if (value === null || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    if (Array.isArray(value)) {
      stack.push(...value)
      continue
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'id' && typeof child === 'string' && child.length > 0) ids.add(child)
      else stack.push(child)
    }
  }
  return ids
}

function checkKeys(obj: Obj, path: string, owner: FieldOwner, ctx: Ctx): void {
  const supported: readonly string[] = FIELDS[owner]
  const irOnly = IR_ONLY_FIELDS[owner] ?? []
  for (const key of Object.keys(obj)) {
    if (supported.includes(key) || obj[key] === undefined) continue
    const names = supported.filter(name => name !== 'kind').join('、')
    if (irOnly.includes(key)) {
      ctx.issue(`${path}.${key}`, 'unsupported-field',
        `「${OWNER_LABELS[owner]}」暂不支持字段「${key}」（写作片段支持：${names}）；请省略该字段`)
    } else {
      ctx.issue(`${path}.${key}`, 'unknown-field',
        `「${OWNER_LABELS[owner]}」没有字段「${key}」（支持：${names}）；请检查拼写`)
    }
  }
}

// ---------- 行内内容 ----------

/** 与编辑器 `safeExternalHref`（client/extensions/nodes/semantic.ts）一致：只放行 http(s)/mailto/tel，且无空白与控制字符。 */
function isSafeHref(href: string): boolean {
  return !/[\u0000- ]/.test(href) && /^(https?:\/\/|mailto:|tel:)/i.test(href)
}

function optionalString(obj: Obj, key: string, path: string, ctx: Ctx): string | undefined {
  const value = own(obj, key)
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    ctx.issue(`${path}.${key}`, 'invalid-type', `「${key}」必须是字符串`)
    return undefined
  }
  return value
}

function requiredId(obj: Obj, key: string, path: string, what: string, ctx: Ctx): string | undefined {
  const value = own(obj, key)
  if (value === undefined) {
    ctx.issue(`${path}.${key}`, 'missing-field', `${what}缺少「${key}」（目标节点的显式 id）`)
    return undefined
  }
  if (typeof value !== 'string' || value.length === 0) {
    ctx.issue(`${path}.${key}`, 'invalid-type', `「${key}」必须是非空字符串`)
    return undefined
  }
  return value
}

function checkMarkKeys(mark: Obj, path: string, allowed: readonly string[], ctx: Ctx): void {
  for (const key of Object.keys(mark)) {
    if (allowed.includes(key) || mark[key] === undefined) continue
    ctx.issue(`${path}.${key}`, 'unknown-field', `「${String(mark.type)}」标记没有字段「${key}」（支持：${allowed.join('、')}）`)
  }
}

function parseMark(value: unknown, path: string, ctx: Ctx): IRMark | undefined {
  if (!isObj(value)) {
    ctx.issue(path, 'invalid-type', '行内标记应为 {"type": …} 对象')
    return undefined
  }
  const type = own(value, 'type')
  if (typeof type !== 'string') {
    ctx.issue(`${path}.type`, 'missing-field', `行内标记缺少 type（支持：${SUPPORTED_MARK_TYPES.join('、')}）`)
    return undefined
  }
  if ((SIMPLE_MARKS as readonly string[]).includes(type)) {
    checkMarkKeys(value, path, ['type'], ctx)
    return { type } as IRMark
  }
  switch (type) {
    case 'variable': {
      checkMarkKeys(value, path, ['type', 'kind', 'name'], ctx)
      const kind = optionalString(value, 'kind', path, ctx)
      const name = optionalString(value, 'name', path, ctx)
      return { type, ...(kind === undefined ? {} : { kind }), ...(name === undefined ? {} : { name }) }
    }
    case 'externalLink': {
      checkMarkKeys(value, path, ['type', 'href', 'title', 'target', 'rel'], ctx)
      const href = own(value, 'href')
      if (typeof href !== 'string' || href.length === 0) {
        ctx.issue(`${path}.href`, href === undefined ? 'missing-field' : 'invalid-type', 'externalLink 需要非空字符串 href')
        return undefined
      }
      if (!isSafeHref(href)) {
        ctx.issue(`${path}.href`, 'invalid-value', 'href 只接受 http://、https://、mailto:、tel: 开头且不含空白字符的地址')
        return undefined
      }
      const title = optionalString(value, 'title', path, ctx)
      const target = optionalString(value, 'target', path, ctx)
      const rel = optionalString(value, 'rel', path, ctx)
      return {
        type, href,
        ...(title === undefined ? {} : { title }),
        ...(target === undefined ? {} : { target }),
        ...(rel === undefined ? {} : { rel }),
      }
    }
    case 'crossRef': {
      checkMarkKeys(value, path, ['type', 'targetId', 'targetKind'], ctx)
      const targetId = requiredId(value, 'targetId', path, 'crossRef', ctx)
      const targetKind = own(value, 'targetKind')
      if (targetKind !== undefined && !(REFERENCE_KINDS as readonly unknown[]).includes(targetKind)) {
        ctx.issue(`${path}.targetKind`, 'invalid-value', `targetKind 必须是 ${REFERENCE_KINDS.join('、')} 之一`)
        return undefined
      }
      if (targetId === undefined) return undefined
      return { type, targetId, ...(targetKind === undefined ? {} : { targetKind: targetKind as IRReferenceTargetKind }) }
    }
    case 'bibRef':
    case 'termRef': {
      checkMarkKeys(value, path, ['type', 'targetId'], ctx)
      const targetId = requiredId(value, 'targetId', path, type, ctx)
      return targetId === undefined ? undefined : { type, targetId }
    }
    case 'tableFootnoteRef':
      ctx.issue(path, 'unsupported-field', '写作片段暂不支持表脚注引用（tableFootnoteRef）')
      return undefined
    default:
      ctx.issue(`${path}.type`, 'invalid-value', `未知的行内标记类型「${type}」（支持：${SUPPORTED_MARK_TYPES.join('、')}）`)
      return undefined
  }
}

/**
 * 行内公式片段 `{"formula": {"latex": …, "id"?: …}}`：只开放给正文类位置（段落、注、示例、列项、单元格、
 * 术语定义、式中符号与释义），与导出边界一致（docs/phase7-inline-formula.md）。文字与标记不能附在公式片段上。
 */
function parseFormulaRun(value: Obj, rawFormula: unknown, path: string, ctx: Ctx, allowFormula: boolean): IRInline | undefined {
  if (!allowFormula) {
    ctx.issue(`${path}.formula`, 'unsupported-field',
      '这里暂不支持行内公式：标题、图表题、术语名、参考文献中暂不支持行内公式；请改用文字')
    return undefined
  }
  const before = ctx.issues.length
  const text = own(value, 'text')
  if (text !== undefined && text !== '') {
    ctx.issue(`${path}.text`, 'invalid-value', '公式片段不能同时带文字：请把文字拆成单独的片段')
  }
  const marks = own(value, 'marks')
  if (marks !== undefined && !(Array.isArray(marks) && marks.length === 0)) {
    ctx.issue(`${path}.marks`, 'invalid-value', '公式片段不能带行内标记：公式的字形由 LaTeX 决定')
  }
  if (!isObj(rawFormula)) {
    ctx.issue(`${path}.formula`, 'invalid-type', 'formula 应为 {"latex": "…"} 对象')
    return undefined
  }
  checkKeys(rawFormula, `${path}.formula`, 'inlineFormula', ctx)
  const rawLatex = own(rawFormula, 'latex')
  let latex = ''
  if (rawLatex === undefined) {
    ctx.issue(`${path}.formula.latex`, 'missing-field', '行内公式缺少 latex')
  } else if (typeof rawLatex !== 'string') {
    ctx.issue(`${path}.formula.latex`, 'invalid-type', 'latex 必须是字符串')
  } else {
    latex = rawLatex.trim()
    if (latex === '') ctx.issue(`${path}.formula.latex`, 'empty-value', 'latex 不能为空')
  }
  const id = ctx.idOf(rawFormula, `${path}.formula`)
  return ctx.issues.length > before ? undefined : { text: '', formula: { id, latex } }
}

/** 解析一个行内片段；空文本且无标记返回 null（丢弃），无效返回 undefined。 */
function parseRun(value: unknown, path: string, ctx: Ctx, allowFormula = false): IRInline | null | undefined {
  if (typeof value === 'string') return value === '' ? null : { text: value }
  if (!isObj(value)) {
    ctx.issue(path, 'invalid-type', '行内片段应为字符串或 {"text": …, "marks": […]} 对象')
    return undefined
  }
  checkKeys(value, path, 'run', ctx)
  const rawFormula = own(value, 'formula')
  if (rawFormula !== undefined) return parseFormulaRun(value, rawFormula, path, ctx, allowFormula)
  const before = ctx.issues.length
  const text = own(value, 'text')
  if (typeof text !== 'string') {
    ctx.issue(`${path}.text`, text === undefined ? 'missing-field' : 'invalid-type', '行内片段需要字符串 text')
    return undefined
  }
  const rawMarks = own(value, 'marks')
  const marks: IRMark[] = []
  if (rawMarks !== undefined) {
    if (!Array.isArray(rawMarks)) {
      ctx.issue(`${path}.marks`, 'invalid-type', 'marks 必须是数组')
    } else {
      rawMarks.forEach((raw, index) => {
        const mark = parseMark(raw, `${path}.marks[${index}]`, ctx)
        if (mark) marks.push(mark)
      })
    }
  }
  if (ctx.issues.length > before) return undefined

  if (text === '') {
    if (marks.length === 0) return null
    ctx.issue(`${path}.text`, 'inline-projection', '空文本不能携带行内标记：标记在生产文档中没有可附着的文字，会丢失')
    return undefined
  }
  const run: IRInline = { text, ...(marks.length ? { marks } : {}) }
  if (marks.some(mark => mark.type === 'crossRef') && text.includes('\n')) {
    ctx.issue(`${path}.text`, 'inline-projection', 'crossRef 文本包含换行；生产 schema 会拆分文本载体，无法保留原引用范围')
    return undefined
  }
  // 重复标记、code 与其他标记互斥等：复用投影阶段的同一套判定，路径天然对应（marks 数组原样保留）。
  const diagnostics: IRToPmDiagnostic[] = []
  diagnoseInlineProjection(run, path, undefined, diagnostics)
  for (const diagnostic of diagnostics) ctx.issue(diagnostic.path, 'inline-projection', diagnostic.reason)
  return diagnostics.length ? undefined : run
}

/**
 * 规范形态：换行拆成独立的 `{ text: '\n' }` 片段（与 pmToIr 读回的形态一致，
 * 使归一化结果是「投影到 PM 再读回」的不动点）。
 */
function splitNewlines(run: IRInline): IRInline[] {
  if (!run.text.includes('\n')) return [run]
  const out: IRInline[] = []
  const parts = run.text.split('\n')
  const withMarks = (text: string): IRInline => ({
    text,
    ...(run.marks ? { marks: run.marks.map(mark => ({ ...mark })) } : {}),
  })
  parts.forEach((part, index) => {
    if (part) out.push(withMarks(part))
    if (index < parts.length - 1) out.push(withMarks('\n'))
  })
  return out
}

/**
 * 合并相邻且标记完全相同的文字片段：在生产文档里它们本来就是同一段文字（ProseMirror 会合并相邻同标记
 * 的文本节点），不合并则归一化结果不是「写入编辑器再读回」的不动点。换行片段（hardBreak）独立，不参与合并。
 */
function mergeAdjacentRuns(runs: IRInline[]): IRInline[] {
  const out: IRInline[] = []
  for (const run of runs) {
    const previous = out[out.length - 1]
    if (previous && previous.text !== '\n' && run.text !== '\n' && !previous.formula && !run.formula
      && JSON.stringify(previous.marks ?? []) === JSON.stringify(run.marks ?? [])) {
      out[out.length - 1] = { ...previous, text: previous.text + run.text }
    } else {
      out.push(run)
    }
  }
  return out
}

/** 行内内容：字符串，或由字符串与 `{text, marks}` 对象组成的数组。无效返回 undefined。 */
function parseInlines(value: unknown, path: string, ctx: Ctx, allowFormula = false): IRInline[] | undefined {
  const before = ctx.issues.length
  const out: IRInline[] = []
  if (typeof value === 'string') {
    if (value) out.push(...splitNewlines({ text: value }))
    return out
  }
  if (!Array.isArray(value)) {
    ctx.issue(path, 'invalid-type', '行内内容应为字符串，或由字符串与 {"text": …} 对象组成的数组')
    return undefined
  }
  value.forEach((item, index) => {
    const run = parseRun(item, `${path}[${index}]`, ctx, allowFormula)
    if (run) out.push(...splitNewlines(run))
  })
  return ctx.issues.length > before ? undefined : mergeAdjacentRuns(out)
}

const plainText = (inlines: IRInline[]): string => inlines.map(run => run.text).join('')
const isBlank = (inlines: IRInline[]): boolean => !inlines.some(run => run.formula) && plainText(inlines).trim() === ''

/** 必填的行内字段；缺失或无效返回空数组（问题已记录）。 */
function inlineField(obj: Obj, key: string, path: string, ctx: Ctx, options: { nonBlank?: boolean; what?: string; allowFormula?: boolean } = {}): IRInline[] {
  const value = own(obj, key)
  if (value === undefined) {
    ctx.issue(`${path}.${key}`, 'missing-field', `缺少「${key}」`)
    return []
  }
  const inlines = parseInlines(value, `${path}.${key}`, ctx, options.allowFormula)
  if (inlines === undefined) return []
  if (options.nonBlank && isBlank(inlines)) {
    ctx.issue(`${path}.${key}`, 'empty-value', `${options.what ?? key}不能为空`)
  }
  return inlines
}

/** 可选的行内字段；省略或空白（nonBlank 模式下）返回 undefined。 */
function optionalInlineField(obj: Obj, key: string, path: string, ctx: Ctx): IRInline[] | undefined {
  const value = own(obj, key)
  if (value === undefined) return undefined
  const inlines = parseInlines(value, `${path}.${key}`, ctx)
  return inlines === undefined || isBlank(inlines) ? undefined : inlines
}

// ---------- 通用字段 ----------

function enumField<T extends string>(
  obj: Obj, key: string, path: string, values: readonly T[], fallback: T, ctx: Ctx,
): T {
  const value = own(obj, key)
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    ctx.issue(`${path}.${key}`, 'invalid-value', `「${key}」必须是 ${values.join('、')} 之一`)
    return fallback
  }
  return value as T
}

function booleanField(obj: Obj, key: string, path: string, ctx: Ctx): boolean | undefined {
  const value = own(obj, key)
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    ctx.issue(`${path}.${key}`, 'invalid-type', `「${key}」必须是 true 或 false`)
    return undefined
  }
  return value
}

function integerField(
  obj: Obj, key: string, path: string, min: number, max: number, fallback: number, ctx: Ctx,
): number {
  const value = own(obj, key)
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    ctx.issue(`${path}.${key}`, 'invalid-value', `「${key}」必须是 ${min}~${max} 的整数`)
    return fallback
  }
  return value
}

function arrayField(obj: Obj, key: string, path: string, ctx: Ctx): unknown[] | undefined {
  const value = own(obj, key)
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    ctx.issue(`${path}.${key}`, 'invalid-type', `「${key}」必须是数组`)
    return undefined
  }
  return value
}

/** `kind` 在类型已由位置确定的数组（notes 等）中可省略，给出则必须一致。 */
function checkExpectedKind(obj: Obj, path: string, expected: string, ctx: Ctx): void {
  const kind = own(obj, 'kind')
  if (kind !== undefined && kind !== expected) {
    ctx.issue(`${path}.kind`, 'invalid-value', `此处只能放「${expected}」，kind 应省略或为 "${expected}"`)
  }
}

// ---------- 段落与块容器 ----------

const paragraphOf = (id: string, content: IRInline[]): IRParagraph => ({ kind: 'paragraph', id, content })

function parseParagraphObject(obj: Obj, path: string, ctx: Ctx): IRParagraph {
  checkKeys(obj, path, 'paragraph', ctx)
  const id = ctx.idOf(obj, path)
  return paragraphOf(id, inlineField(obj, 'content', path, ctx, { allowFormula: true }))
}

/**
 * 「单段落容器」的内容（列项项、注、示例）：生产 schema 里它们是 `inline*` 节点，
 * IR 里的段落 id 由所属节点派生为 `${ownerId}.p0`（pmToIr 同此约定）。
 * 可写：字符串 / 行内数组 / 恰含一个 paragraph 的块数组（其 id 省略或等于派生值）。
 */
function parseSingleParagraph(value: unknown, path: string, ownerId: string, what: string, ctx: Ctx): IRParagraph[] {
  const derivedId = `${ownerId}.p0`
  const isBlockForm = Array.isArray(value) && value.length > 0
    && value.every(item => isObj(item) && has(item, 'kind'))
  if (!isBlockForm) {
    if (Array.isArray(value) && value.some(item => isObj(item) && has(item, 'kind'))) {
      ctx.issue(path, 'invalid-type', `${what}的内容不能混用块对象与行内片段`)
      return []
    }
    const inlines = parseInlines(value, path, ctx, true)
    ctx.claim(derivedId, path)
    return [paragraphOf(derivedId, inlines ?? [])]
  }
  const blocks = value as Obj[]
  if (blocks.length !== 1) {
    ctx.issue(path, 'not-allowed-here', `${what}只能包含一段内容（生产编辑器中为单个行内段落），不能写多个块`)
  }
  const first = blocks[0]!
  if (first.kind !== 'paragraph') {
    ctx.issue(`${path}[0].kind`, 'not-allowed-here', `${what}只能包含段落，不能放「${String(first.kind)}」`)
    return []
  }
  checkKeys(first, `${path}[0]`, 'paragraph', ctx)
  const givenId = own(first, 'id')
  if (givenId !== undefined && givenId !== derivedId) {
    ctx.issue(`${path}[0].id`, 'invalid-id', `${what}内段落的 id 由所属节点派生，必须省略或等于「${derivedId}」`)
  }
  ctx.claim(derivedId, `${path}[0]`)
  return [paragraphOf(derivedId, inlineField(first, 'content', `${path}[0]`, ctx, { allowFormula: true }))]
}

type BlockKind = typeof AUTHORING_BLOCK_KINDS[number]

/**
 * 多块容器的内容（单元格、术语定义）：
 * 字符串 = 一个段落；数组 = 块列表（字符串 = 段落，对象需 kind）；
 * 全是行内片段对象的数组 = 一个段落。`allowed` 限定可用的块种类。
 */
function parseBlocks(
  value: unknown, path: string, allowed: readonly BlockKind[], what: string, ctx: Ctx,
): IRBlock[] {
  if (typeof value === 'string') return [paragraphOf(ctx.fresh(), parseInlines(value, path, ctx) ?? [])]
  if (!Array.isArray(value)) {
    ctx.issue(path, 'invalid-type', `${what}应为字符串或块数组`)
    return []
  }
  if (value.length > 0 && value.every(item => isObj(item) && !has(item, 'kind'))) {
    const inlines = parseInlines(value, path, ctx, true)
    return [paragraphOf(ctx.fresh(), inlines ?? [])]
  }
  const out: IRBlock[] = []
  value.forEach((item, index) => {
    const at = `${path}[${index}]`
    if (typeof item === 'string') {
      out.push(paragraphOf(ctx.fresh(), parseInlines(item, at, ctx) ?? []))
      return
    }
    if (!isObj(item) || !has(item, 'kind')) {
      ctx.issue(at, 'invalid-type', `${what}中的块应为字符串（段落）或带 kind 的对象；行内片段与块不能混用`)
      return
    }
    const kind = item.kind
    if (typeof kind !== 'string' || !(allowed as readonly string[]).includes(kind)) {
      ctx.issue(`${at}.kind`, 'not-allowed-here',
        `${what}中只能放：${allowed.map(label).join('、')}${typeof kind === 'string' ? `，不能放「${kind}」` : ''}`)
      return
    }
    out.push(kind === 'list' ? parseList(item, at, ctx) : parseParagraphObject(item, at, ctx))
  })
  return out
}

// ---------- 列项 ----------

const LIST_TYPES = ['dash', 'number', 'alpha', 'boxed', 'dot'] as const

function parseListItem(value: unknown, path: string, ctx: Ctx): IRList['items'][number] {
  if (typeof value === 'string' || Array.isArray(value)) {
    const id = ctx.fresh()
    return { id, content: parseSingleParagraph(value, path, id, '列项项', ctx) }
  }
  if (!isObj(value)) {
    ctx.issue(path, 'invalid-type', '列项项应为字符串、行内数组或 {"content": …} 对象')
    return { id: ctx.fresh(), content: [] }
  }
  checkKeys(value, path, 'listItem', ctx)
  const id = ctx.idOf(value, path)
  const content = own(value, 'content')
  if (content === undefined) {
    ctx.issue(`${path}.content`, 'missing-field', '列项项缺少 content')
    return { id, content: [] }
  }
  if (Array.isArray(content) && content.some(item => isObj(item) && item.kind === 'list')) {
    ctx.issue(`${path}.content`, 'not-allowed-here',
      '生产编辑器的列项不能嵌套列项；二级列项请写成紧随其后的另一个 list（number、dot 为二级）')
    return { id, content: [] }
  }
  return { id, content: parseSingleParagraph(content, `${path}.content`, id, '列项项', ctx) }
}

function parseList(obj: Obj, path: string, ctx: Ctx): IRList {
  checkKeys(obj, path, 'list', ctx)
  const id = ctx.idOf(obj, path)
  const rawType = own(obj, 'listType')
  let listType: IRList['listType'] = 'dash'
  if (rawType !== undefined) {
    if (rawType === 'roman' || rawType === 'romanUpper') {
      ctx.issue(`${path}.listType`, 'invalid-value', `生产列表不支持「${rawType}」编号，请改用 ${LIST_TYPES.join('、')}`)
    } else if (typeof rawType !== 'string' || !(LIST_TYPES as readonly string[]).includes(rawType)) {
      ctx.issue(`${path}.listType`, 'invalid-value', `listType 必须是 ${LIST_TYPES.join('、')} 之一（缺省 dash）`)
    } else {
      listType = rawType as IRList['listType']
    }
  }
  // 数字（number）与间隔号（dot）列项固定为二级，其余为一级；与 irToPm、pmToIr 一致。
  const fixedLevel = listType === 'number' || listType === 'dot' ? 2 : 1
  const level = own(obj, 'level')
  if (level !== undefined && level !== fixedLevel) {
    ctx.issue(`${path}.level`, 'level-mismatch', `「${listType}」列项的层级固定为 ${fixedLevel} 级，level 应省略或为 ${fixedLevel}`)
  }
  const rawItems = arrayField(obj, 'items', path, ctx)
  if (rawItems === undefined && !has(obj, 'items')) ctx.issue(`${path}.items`, 'missing-field', '列项缺少 items')
  if (rawItems?.length === 0) ctx.issue(`${path}.items`, 'empty-value', '列项至少需要一个列项项')
  const items = (rawItems ?? []).map((item, index) => parseListItem(item, `${path}.items[${index}]`, ctx))
  return { kind: 'list', id, listType, ...(fixedLevel === 2 ? { level: 2 as const } : {}), items }
}

// ---------- 注与示例 ----------

function parseNoteLike<K extends 'note' | 'example'>(
  kind: K, value: unknown, path: string, ctx: Ctx,
): { kind: K; id: string; content: IRBlock[] } {
  const what = kind === 'note' ? '注' : '示例'
  if (typeof value === 'string' || Array.isArray(value)) {
    const id = ctx.fresh()
    return { kind, id, content: parseSingleParagraph(value, path, id, what, ctx) }
  }
  if (!isObj(value)) {
    ctx.issue(path, 'invalid-type', `${what}应为字符串或 {"content": …} 对象`)
    return { kind, id: ctx.fresh(), content: [] }
  }
  checkKeys(value, path, kind, ctx)
  checkExpectedKind(value, path, kind, ctx)
  const id = ctx.idOf(value, path)
  const content = own(value, 'content')
  if (content === undefined) {
    ctx.issue(`${path}.content`, 'missing-field', `${what}缺少 content`)
    return { kind, id, content: [] }
  }
  return { kind, id, content: parseSingleParagraph(content, `${path}.content`, id, what, ctx) }
}

function parseNoteList(obj: Obj, key: string, kind: 'note' | 'example', path: string, ctx: Ctx): IRNote[] | IRExample[] {
  const items = arrayField(obj, key, path, ctx) ?? []
  return items.map((item, index) => parseNoteLike(kind, item, `${path}.${key}[${index}]`, ctx)) as IRNote[] | IRExample[]
}

// ---------- 表 ----------

interface ParsedRows {
  rows: IRTableRow[]
  rowPaths: string[]
  cellPaths: string[][]
}

function parseCell(
  value: unknown, path: string, header: boolean, ctx: Ctx,
): IRTableRow['cells'][number] {
  const cellBlocks = ['paragraph', 'list'] as const
  if (typeof value === 'string') {
    return {
      id: ctx.fresh(), colspan: 1, rowspan: 1, header,
      content: parseBlocks(value, path, cellBlocks, '单元格', ctx),
    }
  }
  if (!isObj(value)) {
    ctx.issue(path, 'invalid-type', '单元格应为字符串或 {"content": …, "colspan": …} 对象')
    return { id: ctx.fresh(), colspan: 1, rowspan: 1, header, content: [] }
  }
  checkKeys(value, path, 'cell', ctx)
  const id = ctx.idOf(value, path)
  const colspan = integerField(value, 'colspan', path, 1, MAX_SPAN, 1, ctx)
  const rowspan = integerField(value, 'rowspan', path, 1, MAX_SPAN, 1, ctx)
  const explicitHeader = booleanField(value, 'header', path, ctx)
  const rawContent = own(value, 'content')
  let content: IRBlock[] = []
  if (rawContent === undefined) {
    ctx.issue(`${path}.content`, 'missing-field', '单元格缺少 content；空单元格请写 ""')
  } else {
    content = parseBlocks(rawContent, `${path}.content`, cellBlocks, '单元格', ctx)
    // 生产表格单元格至少要有一个块：空数组等同于空字符串。
    if (content.length === 0) content = [paragraphOf(ctx.fresh(), [])]
  }
  return { id, colspan, rowspan, header: explicitHeader ?? header, content }
}

function parseRows(rawRows: unknown[], path: string, headerRowCount: number, ctx: Ctx): ParsedRows {
  const parsed: ParsedRows = { rows: [], rowPaths: [], cellPaths: [] }
  rawRows.forEach((raw, rowIndex) => {
    const rowPath = `${path}[${rowIndex}]`
    let id: string
    let rawCells: unknown[] | undefined
    let cellsPath: string
    if (Array.isArray(raw)) {
      id = ctx.fresh()
      rawCells = raw
      cellsPath = rowPath
    } else if (isObj(raw)) {
      checkKeys(raw, rowPath, 'row', ctx)
      id = ctx.idOf(raw, rowPath)
      cellsPath = `${rowPath}.cells`
      rawCells = arrayField(raw, 'cells', rowPath, ctx)
      if (rawCells === undefined && !has(raw, 'cells')) ctx.issue(cellsPath, 'missing-field', '表行缺少 cells')
    } else {
      ctx.issue(rowPath, 'invalid-type', '表行应为单元格数组或 {"cells": […]} 对象')
      id = ctx.fresh()
      cellsPath = rowPath
    }
    if (rawCells?.length === 0) ctx.issue(cellsPath, 'empty-value', '表行至少需要一个单元格')
    const cellPaths = (rawCells ?? []).map((_, cellIndex) => `${cellsPath}[${cellIndex}]`)
    const cells = (rawCells ?? []).map((cell, cellIndex) =>
      parseCell(cell, cellPaths[cellIndex]!, rowIndex < headerRowCount, ctx))
    parsed.rows.push({ id, cells })
    parsed.rowPaths.push(rowPath)
    parsed.cellPaths.push(cellPaths)
  })
  return parsed
}

/** 按 colspan/rowspan 展开占用网格，要求每行占用的列数一致、rowspan 不越过最后一行。 */
function checkTableGrid(parsed: ParsedRows, ctx: Ctx): void {
  const { rows, rowPaths, cellPaths } = parsed
  let remaining: number[] = []
  const origin: string[] = []
  let expectedWidth: number | undefined
  rows.forEach((row, rowIndex) => {
    const occupied = remaining.map(count => count > 0)
    const next = remaining.map(count => Math.max(0, count - 1))
    let col = 0
    row.cells.forEach((cell, cellIndex) => {
      while (occupied[col]) col += 1
      const cellPath = cellPaths[rowIndex]![cellIndex]!
      for (let k = 0; k < cell.colspan; k += 1) {
        if (occupied[col + k]) {
          ctx.issue(cellPath, 'table-grid', `该单元格与上方 rowspan 占用的列重叠（第 ${col + k + 1} 列）`)
          break
        }
      }
      for (let k = 0; k < cell.colspan; k += 1) {
        next[col + k] = cell.rowspan - 1
        origin[col + k] = cellPath
      }
      col += cell.colspan
    })
    let width = col
    occupied.forEach((isOccupied, index) => { if (isOccupied && index + 1 > width) width = index + 1 })
    if (expectedWidth === undefined) expectedWidth = width
    else if (width !== expectedWidth) {
      ctx.issue(rowPaths[rowIndex]!, 'table-grid',
        `第 ${rowIndex + 1} 行占 ${width} 列，与首行的 ${expectedWidth} 列不一致（请检查 colspan/rowspan 与单元格数量）`)
    }
    remaining = next
  })
  const reported = new Set<string>()
  remaining.forEach((count, index) => {
    const at = origin[index]
    if (count > 0 && at && !reported.has(at)) {
      reported.add(at)
      ctx.issue(at, 'table-grid', 'rowspan 超出了表的最后一行')
    }
  })
}

function parseTable(obj: Obj, path: string, ctx: Ctx): IRTable {
  checkKeys(obj, path, 'table', ctx)
  const id = ctx.idOf(obj, path)
  const caption = inlineField(obj, 'caption', path, ctx)
  const captionEn = optionalInlineField(obj, 'captionEn', path, ctx)
  const orientation = enumField(obj, 'orientation', path, ['portrait', 'landscape'], 'portrait', ctx)
  const rawRows = arrayField(obj, 'rows', path, ctx)
  if (rawRows === undefined && !has(obj, 'rows')) ctx.issue(`${path}.rows`, 'missing-field', '表缺少 rows')
  if (rawRows?.length === 0) ctx.issue(`${path}.rows`, 'empty-value', '表至少需要一行')
  const rowCount = rawRows?.length ?? 0
  const headerRowCount = integerField(obj, 'headerRowCount', path, 0, Math.max(rowCount, 0), 1, ctx)
  const rowsBefore = ctx.issues.length
  const parsed = parseRows(rawRows ?? [], `${path}.rows`, headerRowCount, ctx)
  // 行/单元格本身有问题时不再检查网格，避免连锁的次生报错。
  if (ctx.issues.length === rowsBefore) checkTableGrid(parsed, ctx)
  const notes = parseNoteList(obj, 'notes', 'note', path, ctx) as IRNote[]
  return {
    kind: 'table', id, caption, ...(captionEn ? { captionEn } : {}), orientation,
    headerRowCount, rows: parsed.rows, notes,
  }
}

// ---------- 图 ----------

/** 与 @ses/io DOCX 出件接受的图片一致：PNG/JPEG/GIF 的 base64 data URL；不下载外链。 */
function imageDataUrlProblem(src: string): string | undefined {
  const match = /^data:image\/(?:png|jpeg|jpg|gif);base64,([\s\S]*)$/i.exec(src)
  if (!match) return 'src 只接受 PNG、JPEG、GIF 的 base64 data URL（如 "data:image/png;base64,…"），不会下载外链图片'
  const payload = match[1]!.replace(/\s/g, '')
  if (!payload || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(payload) || payload.length % 4 === 1) {
    return 'src 的 base64 数据格式无效'
  }
  return undefined
}

function parseFigure(obj: Obj, path: string, ctx: Ctx): IRFigure {
  checkKeys(obj, path, 'figure', ctx)
  const id = ctx.idOf(obj, path)
  const caption = inlineField(obj, 'caption', path, ctx)
  const captionEn = optionalInlineField(obj, 'captionEn', path, ctx)
  const orientation = enumField(obj, 'orientation', path, ['portrait', 'landscape'], 'portrait', ctx)
  const rawSrc = own(obj, 'src')
  let src = ''
  if (rawSrc === undefined) {
    ctx.issue(`${path}.src`, 'missing-field', '图缺少 src（data URL）')
  } else if (typeof rawSrc !== 'string') {
    ctx.issue(`${path}.src`, 'invalid-type', 'src 必须是字符串')
  } else {
    const problem = imageDataUrlProblem(rawSrc)
    if (problem) ctx.issue(`${path}.src`, 'invalid-value', problem)
    else src = rawSrc
  }
  // alt 缺省为空串：与生产 figureImage 的属性缺省值一致（pmToIr 读回时恒带 alt）。
  const alt = optionalString(obj, 'alt', path, ctx) ?? ''
  const notes = arrayField(obj, 'notes', path, ctx)
  if (notes && notes.length > 0) {
    ctx.issue(`${path}.notes`, 'unsupported-field', '生产编辑器的图没有保存图中注的节点，notes 必须为空；请把说明写进 caption 或图后的 note')
  }
  return { kind: 'figure', id, caption, ...(captionEn ? { captionEn } : {}), orientation, src, alt, notes: [] }
}

// ---------- 公式 ----------

function parseFormula(obj: Obj, path: string, ctx: Ctx): IRFormula {
  checkKeys(obj, path, 'formula', ctx)
  const id = ctx.idOf(obj, path)
  const rawLatex = own(obj, 'latex')
  let latex = ''
  if (rawLatex === undefined) {
    ctx.issue(`${path}.latex`, 'missing-field', '公式缺少 latex')
  } else if (typeof rawLatex !== 'string') {
    ctx.issue(`${path}.latex`, 'invalid-type', 'latex 必须是字符串')
  } else {
    // pmToIr 读回时会 trim，这里同样规整，保持往返一致。
    latex = rawLatex.trim()
    if (latex === '') ctx.issue(`${path}.latex`, 'empty-value', 'latex 不能为空')
  }
  const numbered = booleanField(obj, 'numbered', path, ctx) ?? true
  const rawWhere = arrayField(obj, 'whereList', path, ctx) ?? []
  const whereList = rawWhere.map((raw, index): IRFormula['whereList'][number] => {
    const at = `${path}.whereList[${index}]`
    if (!isObj(raw)) {
      ctx.issue(at, 'invalid-type', '式中项应为 {"term": …, "definition": …} 对象')
      return { id: ctx.fresh(), term: [], definition: [] }
    }
    checkKeys(raw, at, 'whereItem', ctx)
    const itemId = ctx.idOf(raw, at)
    return {
      id: itemId,
      term: inlineField(raw, 'term', at, ctx, { nonBlank: true, what: '式中项的符号', allowFormula: true }),
      definition: inlineField(raw, 'definition', at, ctx, { nonBlank: true, what: '式中项的说明', allowFormula: true }),
    }
  })
  return { kind: 'formula', id, latex, numbered, whereList }
}

// ---------- 结构：条 / 术语条目 / 章 / 附录 / 参考文献 ----------

function allowedKinds(rules: FragmentContextRules): string[] {
  return [
    ...(rules.chapter ? ['chapter'] : []),
    ...(rules.appendix ? ['appendix'] : []),
    ...(rules.clause ? ['clause'] : []),
    ...(rules.blocks ? AUTHORING_BLOCK_KINDS : []),
    ...(rules.termEntry ? ['termEntry'] : []),
    ...(rules.bibEntry ? ['bibEntry'] : []),
  ]
}

function kindAllowed(kind: string, rules: FragmentContextRules): boolean {
  if ((AUTHORING_BLOCK_KINDS as readonly string[]).includes(kind)) return rules.blocks
  switch (kind) {
    case 'chapter': return rules.chapter
    case 'appendix': return rules.appendix
    case 'clause': return rules.clause
    case 'termEntry': return rules.termEntry
    case 'bibEntry': return rules.bibEntry
    default: return false
  }
}

function checkDerivedLevel(
  obj: Obj, path: string, derived: FragmentLevel | undefined, what: string, ctx: Ctx,
): FragmentLevel {
  const level = derived ?? 1
  const given = own(obj, 'level')
  if (given !== undefined && given !== level) {
    ctx.issue(`${path}.level`, 'level-mismatch',
      `${what}的层级由插入位置决定，此处应为 ${level}，level 应省略或为 ${level}（实际给出 ${JSON.stringify(given)}）`)
  }
  return level
}

function parseChildren(
  obj: Obj, path: string, context: AuthoringContext, ctx: Ctx,
): IRClauseChild[] {
  const raw = arrayField(obj, 'children', path, ctx) ?? []
  const rules = fragmentContextRules(context)
  const out: IRClauseChild[] = []
  raw.forEach((item, index) => {
    const node = parseNode(item, `${path}.children[${index}]`, context, rules, ctx)
    if (node) out.push(node as IRClauseChild)
  })
  return out
}

function parseClause(obj: Obj, path: string, rules: FragmentContextRules, ctx: Ctx): IRClause {
  checkKeys(obj, path, 'clause', ctx)
  const id = ctx.idOf(obj, path)
  const level = checkDerivedLevel(obj, path, rules.childLevel, '条', ctx)
  const before = ctx.issues.length
  const rawTitle = own(obj, 'title')
  const parsedTitle = rawTitle === undefined ? [] : parseInlines(rawTitle, `${path}.title`, ctx) ?? []
  const titleOk = ctx.issues.length === before
  const hasTitle = !isBlank(parsedTitle)
  const titled = booleanField(obj, 'titled', path, ctx) ?? hasTitle
  if (titleOk && own(obj, 'titled') !== undefined) {
    if (titled && !hasTitle) ctx.issue(`${path}.titled`, 'empty-value', 'titled 为 true 时必须提供非空 title')
    if (!titled && hasTitle) ctx.issue(`${path}.titled`, 'invalid-value', 'titled 为 false（无题条）时不能提供 title')
  }
  const children = parseChildren(obj, path, { parent: 'clause', level }, ctx)
  return { kind: 'clause', id, level, titled, title: titled ? parsedTitle : [], children }
}

const SOURCE_PARAGRAPH = /^\s*[[［]来源/

function parseTermEntry(obj: Obj, path: string, rules: FragmentContextRules, ctx: Ctx): IRTermEntry {
  checkKeys(obj, path, 'termEntry', ctx)
  const id = ctx.idOf(obj, path)
  // 术语条目的 level 只影响显示层级、不参与编号（Resolver 按位置编号），编辑器里由人任选；
  // 因此与条不同：缺省对齐位置，显式给出 1~5 的整数则原样保留，不报不一致。
  const level = integerField(obj, 'level', path, 1, 5, rules.childLevel ?? 1, ctx)
  const term = inlineField(obj, 'term', path, ctx, { nonBlank: true, what: '术语' })
  const termEn = optionalInlineField(obj, 'termEn', path, ctx)
  const rawDefinition = own(obj, 'definition')
  let definition: IRBlock[] = []
  if (rawDefinition === undefined) {
    ctx.issue(`${path}.definition`, 'missing-field', '术语条目缺少 definition')
  } else {
    const before = ctx.issues.length
    definition = parseBlocks(rawDefinition, `${path}.definition`, ['paragraph'], '术语定义', ctx)
    if (ctx.issues.length === before) {
      const first = definition[0] as IRParagraph | undefined
      if (!first || isBlank(first.content)) {
        ctx.issue(`${path}.definition`, 'empty-value', '术语条目必须有非空的定义')
      }
      definition.slice(1).forEach((block, index) => {
        if (block.kind === 'paragraph' && SOURCE_PARAGRAPH.test(plainText(block.content))) {
          ctx.issue(`${path}.definition[${index + 1}]`, 'invalid-value',
            '以「[来源」开头的后续定义段会被读回为来源字段；来源请写在 source 字段中')
        }
      })
    }
  }
  const source = optionalInlineField(obj, 'source', path, ctx)
  const notes = parseNoteList(obj, 'notes', 'note', path, ctx) as IRNote[]
  const examples = parseNoteList(obj, 'examples', 'example', path, ctx) as IRExample[]
  return {
    kind: 'termEntry', id, level, term, ...(termEn ? { termEn } : {}), definition,
    ...(source ? { source } : {}), notes, examples,
  }
}

function inferSecType(title: IRInline[]): IRChapter['secType'] {
  const text = plainText(title).trim()
  return CHAPTER_SEC_TYPES.find(item => item.match.test(text))?.secType ?? 'general'
}

function parseChapter(obj: Obj, path: string, ctx: Ctx): IRChapter {
  checkKeys(obj, path, 'chapter', ctx)
  const id = ctx.idOf(obj, path)
  const title = inlineField(obj, 'title', path, ctx, { nonBlank: true, what: '章标题' })
  const secType = enumField(obj, 'secType', path, ['scope', 'norm-refs', 'terms', 'general'], inferSecType(title), ctx)
  const children = parseChildren(obj, path, { parent: 'chapter' }, ctx)
  return { kind: 'chapter', id, secType, title, children }
}

function parseAppendix(obj: Obj, path: string, ctx: Ctx): IRAppendix {
  checkKeys(obj, path, 'appendix', ctx)
  const id = ctx.idOf(obj, path)
  const normative = booleanField(obj, 'normative', path, ctx) ?? false
  const title = inlineField(obj, 'title', path, ctx, { nonBlank: true, what: '附录标题' })
  const children = parseChildren(obj, path, { parent: 'appendix' }, ctx)
  return { kind: 'appendix', id, normative, title, children }
}

function parseBibEntry(value: unknown, path: string, ctx: Ctx): IRBibEntry {
  if (typeof value === 'string') {
    const content = parseInlines(value, path, ctx) ?? []
    if (isBlank(content)) ctx.issue(path, 'empty-value', '参考文献条目不能为空')
    return { kind: 'bibEntry', id: ctx.fresh(), content }
  }
  const obj = value as Obj
  checkKeys(obj, path, 'bibEntry', ctx)
  const id = ctx.idOf(obj, path)
  return { kind: 'bibEntry', id, content: inlineField(obj, 'content', path, ctx, { nonBlank: true, what: '参考文献条目' }) }
}

// ---------- 节点分发 ----------

/** 解析 `context` 位置上的一个节点（片段顶层元素，或章/条/附录的子节点）。 */
function parseNode(
  value: unknown, path: string, context: AuthoringContext, rules: FragmentContextRules, ctx: Ctx,
): IRFragmentNode | undefined {
  const where = describeAuthoringContext(context)
  // 只在报错时才拼提示文字：这条路径对片段里的每个节点都会走到。
  const hint = (): string => `「${where}」中允许：${allowedKinds(rules).map(label).join('、')}`

  if (typeof value === 'string') {
    if (rules.blocks) {
      return paragraphOf(ctx.fresh(), parseInlines(value, path, ctx) ?? [])
    }
    if (rules.bibEntry) return parseBibEntry(value, path, ctx)
    ctx.issue(path, 'not-allowed-here', `此处不能直接写字符串；${hint()}`)
    return undefined
  }
  if (!isObj(value)) {
    ctx.issue(path, 'invalid-type', `节点应为字符串或带 kind 的对象；${hint()}`)
    return undefined
  }
  const kind = own(value, 'kind')
  if (kind === undefined) {
    ctx.issue(`${path}.kind`, 'missing-field', `节点缺少 kind；${hint()}`)
    return undefined
  }
  if (typeof kind !== 'string') {
    ctx.issue(`${path}.kind`, 'invalid-type', 'kind 必须是字符串')
    return undefined
  }
  if (kind === 'warning' || kind === 'quote' || kind === 'code' || kind === 'defList') {
    ctx.issue(`${path}.kind`, 'unsupported-kind',
      `写作片段暂不支持「${kind}」块（支持：${AUTHORING_NODE_KINDS.join('、')}）`)
    return undefined
  }
  if (!(AUTHORING_NODE_KINDS as readonly string[]).includes(kind)) {
    ctx.issue(`${path}.kind`, 'unknown-kind', `未知的 kind「${kind}」（支持：${AUTHORING_NODE_KINDS.join('、')}）`)
    return undefined
  }
  if (!kindAllowed(kind, rules)) {
    ctx.issue(`${path}.kind`, 'not-allowed-here',
      `「${label(kind)}」不能放在「${where}」中；${hint()}${kind === 'clause' && context.parent === 'clause' ? '（已达最大层级 5，不能再嵌套条）' : ''}`)
    return undefined
  }
  switch (kind as AuthoringNodeKind) {
    case 'paragraph': return parseParagraphObject(value, path, ctx)
    case 'list': return parseList(value, path, ctx)
    case 'table': return parseTable(value, path, ctx)
    case 'figure': return parseFigure(value, path, ctx)
    case 'formula': return parseFormula(value, path, ctx)
    case 'note': return parseNoteLike('note', value, path, ctx)
    case 'example': return parseNoteLike('example', value, path, ctx)
    case 'clause': return parseClause(value, path, rules, ctx)
    case 'termEntry': return parseTermEntry(value, path, rules, ctx)
    case 'chapter': return parseChapter(value, path, ctx)
    case 'appendix': return parseAppendix(value, path, ctx)
    case 'bibEntry': return parseBibEntry(value, path, ctx)
  }
}

// ---------- 入口 ----------

/**
 * 把写作片段归一化为合法的 IR 节点。
 *
 * @param input   片段：节点数组（元素为字符串或带 `kind` 的对象）。字符串在可放块的位置视为段落，
 *                在参考文献中视为文献条目。
 * @param context 插入位置的父节点，决定允许的节点种类与条/术语条目的层级，见 {@link AuthoringContext}。
 *
 * 成功时返回完整的 IR 节点（所有必填字段、可推导字段、id 均已补齐，行内为规范形态）；
 * 失败时返回全部问题（带路径），不返回部分结果。归一化结果再次作为输入是不动点。
 * 输入对象不会被修改。
 */
export function normalizeAuthoringFragment(
  input: unknown,
  context: AuthoringContext,
  options: AuthoringNormalizeOptions = {},
): AuthoringNormalizeResult {
  const root = options.rootPath ?? 'fragment'
  const contextProblem = validateAuthoringContext(context)
  if (contextProblem) {
    return { ok: false, issues: [{ path: 'context', code: 'invalid-context', reason: contextProblem }] }
  }
  if (!Array.isArray(input)) {
    return {
      ok: false,
      issues: [{ path: root, code: 'invalid-type', reason: '片段必须是节点数组（单个节点也要放进数组）' }],
    }
  }
  if (input.length === 0) {
    return {
      ok: false,
      issues: [{ path: root, code: 'empty-fragment', reason: '片段不能为空；要删除内容请使用删除操作' }],
    }
  }
  const ctx = new Ctx(input, options)
  const rules = fragmentContextRules(context)
  const nodes: IRFragmentNode[] = []
  input.forEach((item, index) => {
    const node = parseNode(item, `${root}[${index}]`, context, rules, ctx)
    if (node) nodes.push(node)
  })
  return ctx.issues.length > 0 ? { ok: false, issues: ctx.issues } : { ok: true, nodes }
}
