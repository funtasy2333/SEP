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
  meta: IRDocMeta
  front: { foreword: IRBlock[]; introduction: IRBlock[] }
  body: IRChapter[]
  appendices: IRAppendix[]
  bibliography: IRBibEntry[]
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
  | IRFormula | IRNote | IRExample

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
}
export interface IRTableRow {
  id: NodeId
  cells: { id: NodeId; colspan: number; rowspan: number; header: boolean; content: IRBlock[] }[]
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
}

export interface IRFormula {
  kind: 'formula'
  id: NodeId
  latex: string
  /** 含脚注的公式主体原始行内数据，保留到 Resolver 校验；纯 LaTeX 时省略。 */
  sourceInlines?: IRInline[]
  numbered: boolean
  /** 「式中：」键值对（NISO STS: disp-formula > legend > def-list） */
  whereList: { id: NodeId; term: IRInline[]; definition: IRInline[] }[]
}

export interface IRNote { kind: 'note'; id: NodeId; content: IRBlock[] }
export interface IRExample { kind: 'example'; id: NodeId; content: IRBlock[] }

export interface IRTermEntry {
  kind: 'termEntry'
  id: NodeId
  term: IRInline[]
  termEn?: IRInline[]
  definition: IRBlock[]
  /** 最多一个定义、最多一个来源（对齐 ISO OSD/NISO STS 约束） */
  source?: IRInline[]
  notes: IRNote[]
  examples: IRExample[]
}

export interface IRBibEntry { kind: 'bibEntry'; id: NodeId; content: IRInline[] }

// ---------- 行内 ----------
export interface IRInline {
  text: string
  marks?: IRMark[]
  /** 原位条文脚注：引用与内容共同移动/删除，编号由 Resolver 派生。 */
  footnote?: IRFootnote
}
export interface IRFootnote { id: NodeId; content: IRInline[] }
export type IRMark =
  | { type: 'bold' } | { type: 'italic' } | { type: 'underline' }
  | { type: 'sub' } | { type: 'sup' }
  /** 引用文本由 Resolver 解析，不存死文本 */
  | { type: 'crossRef'; targetId: NodeId }
  | { type: 'tableFootnoteRef'; targetId: NodeId }

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
export interface IRProblem {
  code: 'hanging-paragraph' | 'dangling-xref' | 'heading-skip'
      | 'duplicate-id' | 'missing-id' | 'empty-section'
      | 'dangling-footnote' | 'unreferenced-footnote' | 'invalid-footnote'
  nodeId: NodeId | null
  severity: 'error' | 'warning'
  /** 中文，面向最终用户 */
  message: string
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
