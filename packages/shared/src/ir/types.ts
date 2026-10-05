/**
 * Authoring IR 类型定义（Phase 5.5 / WP1）。
 *
 * 定稿接口见 docs/dev-plan-phase-5.5.md 第 2.2 节：已有字段不得改名、改型。
 * 不变式：
 * - IR 不含任何编号，编号由 Resolver 派生（labels）；
 * - IR 必须可 JSON.stringify 往返无损（无类实例、无函数）；
 * - 本文件为同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

/** 稳定内部 ID（节点创建时生成一次、终生不变），见计划 2.3 节 */
export type NodeId = string

export interface IRDoc {
  schemaVersion: 1
  /** 新增语义字段的兼容扩展版本；缺省值代表仅含原始 WP1/WP3 字段的旧文档。 */
  extensionVersion?: 1
  meta: IRDocMeta
  front: { foreword: IRBlock[]; introduction: IRBlock[] }
  body: IRChapter[]
  appendices: IRAppendix[]
  bibliography: IRBibEntry[]
  /** 文档级序列化资源目录；资源负载不得藏在渲染器私有属性中。 */
  resources?: IRResource[]
  index?: IRIndex
  /** 转换时不能表达的 PM 内容，以位置和原因保留，并由 Resolver 阻止不完整输出。 */
  unsupportedContent?: IRUnsupportedContent[]
  /** 未能无损映射的脚注；保留诊断并由 Resolver 阻断输出，不能静默跳过。 */
  unmappedFootnotes?: { container: string; nodeId: NodeId; content: IRInline[]; reason?: string }[]
}

/** 定稿接口，字段与取值见 docs/dev-plan-phase-5.5.md 第 2.2 节；不得改名、改型 */
export interface IRDocMeta {
  title?: string
  titleEn?: string
  stdCode?: string
  icsCode?: string
  ccsCode?: string
  standardType: 'gb' | 'industry' | 'local' | 'group' | 'enterprise' | 'guide'
  issuer?: string
  applicant?: string
  publishDate?: string
  implementDate?: string
  /** 被代替的标准文件编号 */
  replaces?: string
  /** 一致性程度标识 */
  consistency?: string
  /** 备案号（行业标准封面） */
  filingNo?: string
  /** 行业名称 */
  industryName?: string
  /** 地方名称 */
  regionName?: string
  /** 封面标准称谓完整覆盖值；国家标准和指导性技术文件仍使用固定称谓 */
  coverDesignation?: string
  /** DocumentMeta 中的既有文件设置字段。 */
  proposer?: string
  technicalCommittee?: string
  /** 分段和多语种题名；旧 title/titleEn 保留用于既有消费端。 */
  titleParts?: IRTitlePart[]
  /** 完整编号及组成部分；不从未知组成猜测传统 stdCode。 */
  identifiers?: IRIdentifier[]
  languages?: IRLanguage[]
  publishers?: IROrganization[]
  adoptions?: IRAdoption[]
  replacedStandards?: IRStandardReference[]
  copyrights?: IRCopyright[]
}

export interface IRTitlePart {
  id: NodeId
  lang?: string
  role?: string
  content: IRInline[]
}

export interface IRIdentifier {
  id: NodeId
  scheme?: string
  /** 外部文档给出的完整编号文本；缺省时只保留 parts，不推断组合方式。 */
  value?: string
  parts: IRIdentifierPart[]
}

export interface IRIdentifierPart {
  id: NodeId
  kind: string
  position?: number
  content: IRInline[]
}

export interface IRLanguage {
  id: NodeId
  tag: string
  usage?: string
}

export interface IROrganization {
  id: NodeId
  name: IRInline[]
  role?: string
  identifier?: string
}

export interface IRAdoption {
  id: NodeId
  reference: string
  degree?: string
  language?: string
}

export interface IRStandardReference {
  id: NodeId
  reference: string
  relation?: string
}

export interface IRCopyright {
  id: NodeId
  holder?: IRInline[]
  year?: string
  language?: string
  statement: IRInline[]
}

export interface IRChapter {
  kind: 'chapter'
  id: NodeId
  /** NISO STS sec-type 对齐：范围/规范性引用文件/术语和定义章需要特殊渲染 */
  secType: 'scope' | 'norm-refs' | 'terms' | 'general'
  title: IRInline[]
  children: IRChapterChild[]
}
export type IRChapterChild = IRClause | IRBlock | IRTermEntry

export interface IRClause {
  kind: 'clause'
  id: NodeId
  level: 1 | 2 | 3 | 4 | 5
  /** 无标题条（GB/T 1.1 无题条）titled=false 且 title=[] */
  titled: boolean
  title: IRInline[]
  children: IRClauseChild[]
}
export type IRClauseChild = IRClause | IRBlock | IRTermEntry

export interface IRAppendix {
  kind: 'appendix'
  id: NodeId
  /** 规范性/资料性 */
  normative: boolean
  title: IRInline[]
  children: IRClauseChild[]
}

export type IRBlock =
  | IRParagraph | IRList | IRTable | IRFigure
  | IRFormula | IRNote | IRExample | IRWarning | IRQuote | IRCodeBlock

export interface IRParagraph {
  kind: 'paragraph'
  id: NodeId
  content: IRInline[]
}

export interface IRList {
  kind: 'list'
  id: NodeId
  listType: 'dash' | 'number' | 'alpha' | 'roman' | 'romanUpper' | 'boxed' | 'dot'
  /** 同级列项的视觉层级；省略时为一级。 */
  level?: 1 | 2
  items: { id: NodeId; content: (IRParagraph | IRList)[] }[]
}

export interface IRTable {
  kind: 'table'
  id: NodeId
  caption: IRInline[]
  captionEn?: IRInline[]
  /** 横排宽表 */
  orientation: 'portrait' | 'landscape'
  /** 跨页重复表头依据 */
  headerRowCount: number
  rows: IRTableRow[]
  /** 表注（表内注，编号独立于正文注） */
  notes: IRNote[]
  /** 表脚注；与表注分开，通过稳定 ID 与单元格上标关联。旧文稿可省略。 */
  footnotes?: IRFootnote[]
  /** 表格宽度和已知版式字段；各数值携带显式单位。 */
  width?: IRMeasure
  style?: IRTableStyle
  /** 整张表适用的单位说明。 */
  unit?: string
}
export interface IRTableRow {
  id: NodeId
  style?: IRRowStyle
  cells: {
    id: NodeId
    colspan: number
    rowspan: number
    header: boolean
    content: IRBlock[]
    cellType?: string
    style?: IRCellStyle
    width?: IRMeasure
    unit?: string
    /** ProseMirror table resizing widths, each numeric entry measured in CSS pixels. */
    columnWidths?: number[]
  }[]
}

export interface IRMeasure {
  value: number
  unit: string
}

export interface IRTableStyle {
  layout?: string
  borderModel?: string
  textAlign?: string
  verticalAlign?: string
  borderColor?: string
  borderWidth?: IRMeasure
  backgroundColor?: string
  cellPadding?: IRMeasure
}

export interface IRRowStyle {
  textAlign?: string
  verticalAlign?: string
  backgroundColor?: string
  borderColor?: string
  borderWidth?: IRMeasure
  borderTop?: IRMeasure
  borderRight?: IRMeasure
  borderBottom?: IRMeasure
  borderLeft?: IRMeasure
  height?: IRMeasure
}

export interface IRCellStyle {
  textAlign?: string
  verticalAlign?: string
  backgroundColor?: string
  borderTop?: IRMeasure
  borderRight?: IRMeasure
  borderBottom?: IRMeasure
  borderLeft?: IRMeasure
  paddingTop?: IRMeasure
  paddingRight?: IRMeasure
  paddingBottom?: IRMeasure
  paddingLeft?: IRMeasure
}

export interface IRFigure {
  kind: 'figure'
  id: NodeId
  caption: IRInline[]
  captionEn?: IRInline[]
  orientation: 'portrait' | 'landscape'
  /** 资源引用（dataURL 或资源 key，与现状一致） */
  src: string
  notes: IRNote[]
  resourceId?: NodeId
  imageWidth?: IRMeasure
  imageHeight?: IRMeasure
  alt?: string
  title?: string
  unit?: string
  descriptions?: IRFigureDescription[]
  groups?: IRFigureGroup[]
}

export interface IRFigureGroup {
  id: NodeId
  descriptions: IRFigureDescription[]
  resourceRefs: NodeId[]
}

export interface IRFigureDescription {
  id: NodeId
  content: IRInline[]
}

export interface IRResource {
  id: NodeId
  mediaType?: string
  name?: string
  encoding: 'dataUrl' | 'base64' | 'text'
  data: string
}

export interface IRFormula {
  kind: 'formula'
  id: NodeId
  latex: string
  /** 含脚注的公式主体原始行内数据，保留到 Resolver 校验；纯 LaTeX 时省略。 */
  sourceInlines?: IRInline[]
  /** 原始 MathML，作为可逆的权威表达保留；不以 LaTeX 反译结果替代。 */
  mathml?: string
  numbered: boolean
  /** 「式中：」键值对（NISO STS: disp-formula > legend > def-list） */
  whereList: { id: NodeId; term: IRInline[]; definition: IRInline[] }[]
  notes?: IRFormulaNote[]
}

export interface IRFormulaNote {
  id: NodeId
  content: IRInline[]
}

export interface IRInlineFormula {
  id: NodeId
  mathml?: string
  latex?: string
  source?: string
}

export interface IRNote { kind: 'note'; id: NodeId; content: IRBlock[] }
export interface IRExample { kind: 'example'; id: NodeId; content: IRBlock[] }

export interface IRTermEntry {
  kind: 'termEntry'
  id: NodeId
  level?: number
  term: IRInline[]
  termEn?: IRInline[]
  definition: IRBlock[]
  /** 最多一个定义、最多一个来源（对齐 ISO OSD/NISO STS 约束） */
  source?: IRInline[]
  notes: IRNote[]
  examples: IRExample[]
  /** TBX 语言集；一个 tig 可容纳多个独立术语变体及各自描述符。 */
  languageSets?: IRTermLanguageSet[]
  /** 旧生产schema允许术语嵌套；保留关系，避免转换时拍平。 */
  nestedEntries?: IRTermEntry[]
}

export interface IRTermLanguageSet {
  id: NodeId
  language: string
  groups: IRTermGroup[]
}

export interface IRTermGroup {
  id: NodeId
  terms: IRTermVariant[]
}

export interface IRTermVariant {
  id: NodeId
  content: IRInline[]
  descriptors: IRTermDescriptor[]
}

export interface IRTermDescriptor {
  id: NodeId
  kind: string
  value: IRInline[]
}

export interface IRBibEntry {
  kind: 'bibEntry'
  id: NodeId
  content: IRInline[]
  entryType?: string
  fields?: IRBibField[]
  identifiers?: IRBibIdentifier[]
  externalLink?: IRBibExternalLink
}

export interface IRBibField {
  id: NodeId
  name: string
  value: IRInline[]
}

export interface IRBibIdentifier {
  id: NodeId
  scheme: string
  value: string
}

export interface IRExternalLink {
  href: string
  title?: string
  target?: string
  rel?: string
}

/** Bibliography link display text is distinct from its URL/title. */
export interface IRBibExternalLink extends IRExternalLink {
  displayText?: string
}

export interface IRIndex {
  id: NodeId
  title?: IRInline[]
  groups: IRIndexGroup[]
}

export interface IRIndexGroup {
  id: NodeId
  label?: IRInline[]
  entries: IRIndexEntry[]
}

export interface IRIndexEntry {
  id: NodeId
  term: IRInline[]
  targets: NodeId[]
  seeAlso: NodeId[]
}

export interface IRWarning {
  kind: 'warning'
  id: NodeId
  content: IRBlock[]
}

export interface IRQuote {
  kind: 'quote'
  id: NodeId
  content: IRBlock[]
}

export interface IRCodeBlock {
  kind: 'code'
  id: NodeId
  language?: string
  text: string
}

export interface IRUnsupportedContent {
  nodeId: NodeId | null
  path: string
  nodeType: string
  reason: string
}

// ---------- 行内 ----------
export interface IRInline {
  text: string
  marks?: IRMark[]
  style?: IRInlineStyle
  formula?: IRInlineFormula
  /** 原位条文脚注：引用与内容共同移动/删除，编号由 Resolver 派生。 */
  footnote?: IRFootnote
}

export interface IRInlineStyle {
  fontFamily?: string
  fontSize?: string
  color?: string
  backgroundColor?: string
  letterSpacing?: string
  baseline?: string
  textTransform?: string
}
export interface IRFootnote { id: NodeId; content: IRInline[] }
export type IRMark =
  | { type: 'bold' } | { type: 'italic' } | { type: 'underline' }
  | { type: 'sub' } | { type: 'sup' }
  | { type: 'strike' } | { type: 'code' }
  | { type: 'variable'; kind?: string; name?: string }
  | ({ type: 'externalLink' } & IRExternalLink)
  /** 引用文本由 Resolver 解析，不存死文本 */
  | { type: 'crossRef'; targetId: NodeId; targetKind?: IRReferenceTargetKind }
  | { type: 'bibRef'; targetId: NodeId }
  | { type: 'termRef'; targetId: NodeId }
  | { type: 'tableFootnoteRef'; targetId: NodeId; id?: NodeId }

export type IRReferenceTargetKind =
  | 'chapter' | 'clause' | 'appendix' | 'figure' | 'table' | 'formula'
  | 'note' | 'example' | 'bibliography' | 'term' | 'index' | 'paragraph'

export interface IRProblem {
  code: 'hanging-paragraph' | 'dangling-xref' | 'heading-skip'
      | 'duplicate-id' | 'missing-id' | 'empty-section'
      | 'dangling-footnote' | 'unreferenced-footnote' | 'invalid-footnote'
      | 'unsupported-content' | 'dangling-resource' | 'dangling-index-target'
      | 'dangling-typed-ref'
  nodeId: NodeId | null
  severity: 'error' | 'warning'
  /** 中文，面向最终用户 */
  message: string
}

// ---------- Resolve 结果 ----------
export interface ResolveResult {
  doc: IRDoc
  labels: Record<NodeId, ResolvedLabel>
  problems: IRProblem[]
  /** 按正文出现顺序 */
  bibliographyOrder: NodeId[]
}
export interface ResolvedLabel {
  /** 人读编号："5.1.2" / "表A.1" / "注2" / "(3)" / "附录B" */
  label: string
  /** 导出 XML 用 ID，按 NISO 风格派生："sec_5.1.2" / "tab_A.1" / "formula_3" */
  xmlId: string
  /** 交叉引用处的展示文本："5.1.2" / "表A.1" / "公式(3)" */
  refText: string
}

// ---------- 编号策略（计划 2.4 节；gbT11Strategy 实现属 WP3） ----------
export interface NumberingStrategy {
  /** "5" */
  chapter(seq: number): string
  /** [5,1,2] -> "5.1.2"；附录内条的首元素为附录字母，如 ['A',1,2] -> "A.1.2" */
  clause(path: Array<number | string>): string
  /** 1 -> "附录A"（返回含"附录"前缀） */
  appendix(seq: number): string
  /** 1 -> "A" */
  appendixLetter(seq: number): string
  /** "图1" / "图A.1" */
  figure(seq: number, appendixLetter?: string): string
  /** "表1" / "表A.1" */
  table(seq: number, appendixLetter?: string): string
  /** "(1)" / "(A.1)" */
  formula(seq: number, appendixLetter?: string): string
  /** 注/示例：同一作用域内单条不编号，多条编号。"注：" / "注1：" */
  note(index: number, totalInScope: number): string
  /** "示例：" / "示例1：" */
  example(index: number, totalInScope: number): string
  /** "[1]" */
  bibEntry(seq: number): string
}
