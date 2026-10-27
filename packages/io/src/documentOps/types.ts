/**
 * 文档操作引擎的公共类型（WP9.2c1）。
 *
 * 引擎是同构纯函数：入参与结果都是可 JSON 序列化的数据，服务端（REST/MCP）、命令行与编辑器内的
 * AI 侧边栏共用。输入文档是编辑器 `getJSON()` 形态的 ProseMirror JSON（根节点 `doc`）。
 */

import type {
  AuthoringContext,
  AuthoringIssueCode,
  IRFragmentNode,
  IRProblem,
  PMJsonNode,
} from '@ses/shared'

// ---------- 通用 ----------

/**
 * 文档顶层容器的名称，可作为 `insert`/`move` 的目标父节点。
 *
 * 这些名字是保留字：写作片段里的显式 id 不得与之相同（引擎会把它们当作已存在的 id，归一化时报 `id-conflict`），
 * 以免 `parent: 'body'` 既可能指容器、又可能指某个 id 为 `body` 的节点。
 */
export const DOCUMENT_CONTAINERS = ['foreword', 'introduction', 'body', 'appendices', 'bibliography'] as const
export type DocumentContainer = typeof DOCUMENT_CONTAINERS[number]

/** 可单独寻址（读取、替换、删除、移动、作为锚点）的节点种类，与写作片段的节点种类对应。 */
export type NodeKind = IRFragmentNode['kind']

/** 节点的父级：顶层容器，或章/条/附录节点。 */
export type ParentRef =
  | { container: DocumentContainer }
  | { nodeId: string; kind: 'chapter' | 'clause' | 'appendix' }

// ---------- 操作 ----------

/** 插入位置：父节点内容的开头（章/条/附录为标题之后）、末尾，或某个直接子节点之前/之后。 */
export type InsertPosition = 'start' | 'end' | { before: string } | { after: string }

/**
 * 在父节点内插入写作片段。
 * `parent` 为容器名（`foreword`/`introduction`/`body`/`appendices`/`bibliography`）或章/条/附录的 nodeId；
 * 前言、引言、参考文献容器不存在时按正确的根节点顺序创建。
 */
export interface InsertOperation {
  op: 'insert'
  parent: string
  position: InsertPosition
  /** 写作片段（节点数组），格式见 docs/wp9-authoring-reference.md */
  content: unknown
}

/**
 * 把一个节点替换为片段中的节点（可以是多个）。片段按被替换节点所在位置的上下文归一化。
 *
 * 写作片段只能表达 IR 的一部分。被替换的节点（或其后代）含有片段无法表达的内容
 * （表格样式与列宽、图的资源引用、MathML、TBX 语言集、行内脚注……）时，整体替换必然丢失它们，
 * 因此默认拒绝（`replace-loses-content`，reason 列出将丢失的项）。确认可以丢失时设 `acceptLoss: true`，
 * 操作才会执行，成功结果的 `warnings` 里保留说明。`readNode` 的 `replaceable`/`notReplaceable` 可事先查看。
 */
export interface ReplaceOperation {
  op: 'replace'
  nodeId: string
  content: unknown
  /** 显式接受整体替换造成的内容丢失；只允许出现在 replace 上，必须是布尔值，缺省为 false。 */
  acceptLoss?: boolean
}

/** 删除一个节点（连同其内容）。前言、引言、参考文献因此变空时，容器一并移除。 */
export interface DeleteOperation {
  op: 'delete'
  nodeId: string
}

/**
 * 把节点（连同其内容）移动到新的父节点与位置。目标上下文必须允许该节点；
 * 条移动后层级随新位置变化，其子条与术语条目按同一差值调整。
 */
export interface MoveOperation {
  op: 'move'
  nodeId: string
  parent: string
  position: InsertPosition
}

export type DocumentOperation = InsertOperation | ReplaceOperation | DeleteOperation | MoveOperation

export const DOCUMENT_OPERATION_NAMES = ['insert', 'replace', 'delete', 'move'] as const
export type DocumentOperationName = typeof DOCUMENT_OPERATION_NAMES[number]

// ---------- 问题 ----------

/**
 * 引擎自己产生的问题代码（写作片段的问题沿用 {@link AuthoringIssueCode}，含义见 shared 的 authoring.ts）：
 * - invalid-operations：operations 不是非空数组
 * - unknown-operation：op 不是 insert/replace/delete/move
 * - node-not-found：nodeId 在文档中不存在
 * - node-not-addressable：节点存在，但位于表、列项、术语条目等内部，不能单独寻址
 * - node-ambiguous：文档里有多个节点使用同一 nodeId，无法确定指哪一个
 * - invalid-parent：该节点不能作为父节点（只有章、条、附录与容器可以）
 * - invalid-context：节点所在层级超过 5 级，没有可用的上下文
 * - container-ambiguous：文档里有多个前言/引言/参考文献容器
 * - anchor-not-found：before/after 的锚点节点不存在，或其容器不存在
 * - anchor-not-in-parent：锚点不是目标父节点的直接子节点，或就是被移动的节点本身
 * - move-into-self：不能把节点移动到它自己或它的子孙之内
 * - level-overflow：移动后条的层级超过 5
 * - replace-loses-content：被替换的节点含有写作片段无法表达的内容，且操作没有 `acceptLoss: true`
 * - projection-failed：片段无法投影为生产文档节点
 * - invalid-document：入参不是 doc/standardDoc 根节点
 * - empty-document：全部操作执行后文档没有任何内容
 * - schema-invalid：宿主注入的 `validateContent` 判定文档不合法
 * - unsupported-content：操作使文档产生了新的、无法表达的内容
 */
export type EngineIssueCode =
  | 'invalid-operations' | 'unknown-operation' | 'node-not-found' | 'node-not-addressable'
  | 'node-ambiguous' | 'invalid-parent' | 'invalid-context' | 'container-ambiguous'
  | 'anchor-not-found' | 'anchor-not-in-parent' | 'move-into-self' | 'level-overflow'
  | 'replace-loses-content' | 'projection-failed' | 'invalid-document' | 'empty-document' | 'schema-invalid'
  | 'unsupported-content'

export type DocumentOperationIssueCode = AuthoringIssueCode | EngineIssueCode

export interface DocumentOperationIssue {
  /** 出问题的操作序号（从 0 起）；整批级问题（如最终校验失败且无法归属）省略。 */
  operationIndex?: number
  /** 问题位置，如 `operations[2].content[0].children[1].title`；整批级问题为 `operations` 或 `document`。 */
  path: string
  code: DocumentOperationIssueCode
  /** 中文原因，面向 AI 与最终用户。 */
  reason: string
  /** 相关节点 id（已知时）。 */
  nodeId?: string
}

/** 不阻止写入、但值得调用方知道的情况（目前只有：`acceptLoss` 接受了 replace 造成的内容丢失）。 */
export interface DocumentOperationWarning {
  operationIndex: number
  /** replace-loses-content：操作带 `acceptLoss: true`，被替换的节点含有写作片段无法表达的内容，这些内容已丢失。 */
  code: 'replace-loses-content'
  reason: string
  nodeId: string
}

// ---------- 宿主注入的内容校验 ----------

export interface ContentValidationFailure {
  message: string
  /** 宿主的问题代码（原样回显，引擎不解释）。 */
  code?: string
  /** 出错位置（如 JSON Pointer）。 */
  path?: string
  /** 出错节点的 nodeId；若是本批某个操作新写入的节点，问题会归属到该操作。 */
  nodeId?: string
}

/**
 * 宿主校验结果。`ok: true` 时可带回规范化后的文档（例如补齐缺失 nodeId、生产 schema 序列化后的形态），
 * 引擎用它作为最终文档；省略则沿用校验前的文档。
 */
export type ContentValidationResult =
  | { ok: true; content?: PMJsonNode }
  | ({ ok: false } & ContentValidationFailure)

/**
 * 生产 schema 校验与 nodeId 规范化。`@ses/io` 是同构包，不能依赖只在 client/server 可用的编辑器 schema，
 * 因此由宿主注入：校验通过返回 `{ ok: true }`（可带规范化后的文档），不通过返回 `{ ok: false, message, ... }`。
 * 宿主不应抛异常表达“文档不合法”；意外异常会原样向上传播。
 */
export type ContentValidator = (content: PMJsonNode) => ContentValidationResult

export interface ApplyDocumentOperationsOptions {
  /** 生产 schema 校验 + nodeId 规范化；未注入时跳过。 */
  validateContent?: ContentValidator
  /** nodeId 生成器，默认 shared 的 `generateNodeId`；测试可注入确定性序列。 */
  generateId?: () => string
}

// ---------- 结果 ----------

/** 单个操作对文档的影响，供调用方后续引用新节点。 */
export interface OperationEffect {
  index: number
  op: DocumentOperationName
  /** 本操作写入文档的节点 id（insert/replace 的片段节点，含其中可寻址的后代），按文档顺序。 */
  inserted: string[]
  /** 本操作从文档移除的节点 id（delete/replace 的目标节点及其可寻址的后代），按文档顺序。 */
  removed: string[]
  /** 被移动的节点 id（move）。 */
  moved: string[]
  /** move 时层级随之改变的条与术语条目 id（含被移动节点本身）。 */
  levelChanged?: string[]
  /** 本操作新建的容器（前言、引言、参考文献原本不存在时）。 */
  createdContainer?: DocumentContainer
  /** 本操作移除的容器（前言、引言、参考文献因删除/移出而变空时）。 */
  removedContainer?: DocumentContainer
}

/** Resolver 问题；`introduced` 表示执行前不存在、由本批操作新引入。 */
export interface DocumentProblem extends IRProblem {
  introduced: boolean
}

export interface ApplyDocumentOperationsSuccess {
  ok: true
  /** 新文档。不修改入参，但与入参共享未改动的子树，调用方应视为只读。 */
  doc: PMJsonNode
  operations: OperationEffect[]
  /** 新文档的全部 Resolver 问题，不因此拒绝写入（悬空引用等由文档校验报告）。 */
  problems: DocumentProblem[]
  warnings: DocumentOperationWarning[]
}

export interface ApplyDocumentOperationsFailure {
  ok: false
  /** 全部问题；整批不生效。 */
  issues: DocumentOperationIssue[]
}

export type ApplyDocumentOperationsResult =
  | ApplyDocumentOperationsSuccess
  | ApplyDocumentOperationsFailure

// ---------- 结构树 ----------

export type OutlineKind = 'chapter' | 'clause' | 'appendix' | 'termEntry' | 'table' | 'figure' | 'formula'

export interface OutlineItem {
  nodeId: string
  kind: OutlineKind
  /** Resolver 编号：章 `5`、条 `5.1`、附录 `附录A`、术语 `3.1`、表 `表1`、图 `图A.1`、公式 `(1)`；不编号的公式省略。 */
  number?: string
  /** 标题纯文本；表、图为题注，公式为 LaTeX 摘要（最多 60 字符），术语条目为术语。 */
  title: string
  /** 条的层级（1~5）。 */
  level?: number
  /** 章的角色（scope/norm-refs/terms/general）。 */
  secType?: string
  /** 附录是否规范性。 */
  normative?: boolean
  /** 直接子块中未单独列出的数量（段落、列项、注、示例等）；仅章、条、附录有。 */
  blockCount?: number
  /** 子项；仅章、条、附录有（可能为空数组）。 */
  children?: OutlineItem[]
}

/** 前言、引言：是否存在、块数量，以及其中的表、图、公式；引言还列出其中的条（编号 0.1、0.2…，带子条）。 */
export interface FrontMatterOutline {
  present: boolean
  blockCount: number
  items: OutlineItem[]
}

export interface DocumentOutline {
  foreword: FrontMatterOutline
  introduction: FrontMatterOutline
  /** 正文各章。 */
  body: OutlineItem[]
  appendices: OutlineItem[]
  /** 参考文献只给条目数；条目 id 用 {@link readContainer} 读取。 */
  bibliography: { present: boolean; entryCount: number }
}

// ---------- 读取节点 ----------

export interface NotReplaceableReason {
  code:
    | 'unsupported-field' | 'unsupported-kind' | 'unsupported-content' | 'authoring-invalid'
    | 'not-lossless' | 'projection-failed' | 'no-context'
  /** 中文说明，指出哪些内容会在整体替换时丢失或为何不能替换。 */
  message: string
  /** 首个出现位置（相对该节点的 IR，如 `ir.rows[0].cells[1].style`）。 */
  path?: string
  /** 同类问题出现的次数（合并同名字段后）。 */
  count?: number
}

export interface ReadNodeInfo {
  nodeId: string
  kind: NodeKind
  /** Resolver 编号（如 `5.1`、`附录A`、`表1`、`注2：`）；无编号省略。 */
  number?: string
  parent: ParentRef
  /** 在父节点子序列（IR 的 children，或容器内的节点序列）中的位置，从 0 起。 */
  index: number
  /** 同一父节点下的兄弟节点总数（含自身）。 */
  siblingCount: number
  /** 若要替换该节点，片段应使用的上下文（等于父节点的上下文）；层级超过 5 时省略。 */
  context?: AuthoringContext
  /** 节点的 IR。`replaceable` 为 true 时可原样作为 `content: [ir]` 回传替换，文档保持不变。 */
  ir: IRFragmentNode
  /** 能否用返回的 IR 无损地整体替换。 */
  replaceable: boolean
  /** `replaceable` 为 false 时的原因；整体替换会丢失其中写作片段不支持的内容。 */
  notReplaceable?: NotReplaceableReason[]
}

export type ReadNodeResult =
  | { ok: true; node: ReadNodeInfo }
  | { ok: false; code: 'node-not-found' | 'node-not-addressable' | 'node-ambiguous'; reason: string }

/** 前言、引言、参考文献容器的内容（用于取得其中节点的 id）；引言的节点 = 引言块之后接引言中的条。 */
export interface ReadContainerInfo {
  container: 'foreword' | 'introduction' | 'bibliography'
  /** 容器是否存在于文档中；不存在时 `nodes` 为空。 */
  exists: boolean
  /** 向该容器插入内容时使用的上下文。 */
  context: AuthoringContext
  nodes: IRFragmentNode[]
}

export type ReadContainerResult =
  | { ok: true; container: ReadContainerInfo }
  | { ok: false; code: 'container-ambiguous' | 'invalid-container'; reason: string }
