/**
 * 写作片段的插入上下文（WP9.2b）。
 *
 * 片段是「插入到某个位置」的一组节点；上下文说明该位置的父节点，据此决定允许的节点种类
 * 与条/术语条目的层级。归一化（authoring.ts）与片段投影（irToPm.ts 的 irFragmentToPm）共用本表，
 * 避免两处对「哪里能放什么」各说各话。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 *
 * ## 规则依据
 *
 * 生产 PM schema（packages/client/src/extensions/nodes/*.ts 的 `content` 表达式）里，几乎所有
 * 自定义节点都声明了 `group: 'block'`（含 chapter、clause、appendix、termDef、coverPage……），因此
 * `foreword`/`introduction`/表格单元格的 `block+`，以及章/条/附录末尾的 `| block` 分支，在 schema
 * 层面几乎不设限。真正有约束力的是：
 *   1. schema 里的结构化表达式（章/条/附录必须以标题节点开头、`bibliography` 为
 *      `bibliographyTitle bibEntry+`、`note`/`example`/列项为 `inline*` 等）；
 *   2. IR 类型（types.ts）与 pmToIr 的读取方式——凡 IR 没有对应类型的位置，pmToIr 会把内容记入
 *      `unsupportedContent` 并由 Resolver 阻断输出，等于「放进去也读不回来」；
 *   3. Resolver 的层级语义（resolve.ts `visitSectionChildren`：章/附录的直接子条为 1 级，条的
 *      子条为父级 +1，最高 5 级）。
 *
 * | 父节点      | 生产 PM 内容表达式                                                      | IR 依据                                           | 片段允许                    |
 * |-------------|-------------------------------------------------------------------------|---------------------------------------------------|-----------------------------|
 * | foreword    | `block+`                                                                | `IRDoc.front.foreword: IRBlock[]`                 | 块                          |
 * | introduction| `block+`                                                                | `IRDoc.front.introduction: IRBlock[]`             | 块                          |
 * | body        | `doc`: `block+`；`standardDoc`: `chapter+`                              | `IRDoc.body: IRChapter[]`                         | 章                          |
 * | chapter     | `chapterTitle (clause \| stdParagraph \| … \| block)*`                  | `IRChapterChild = IRClause \| IRBlock \| IRTermEntry` | 1 级条、块、术语条目     |
 * | clause (L)  | `clauseTitle (clause \| stdParagraph \| … \| block)*`                   | `IRClauseChild`；level 1..5                       | L+1 级条（L<5）、块、术语条目（L<5） |
 * | appendices  | `standardDoc`: `appendix*`；`doc`: `block+`                             | `IRDoc.appendices: IRAppendix[]`                  | 附录                        |
 * | appendix    | `appendixLabel appendixTitle (clause \| stdParagraph \| … \| block)*`   | `IRAppendix.children: IRClauseChild[]`            | 1 级条、块、术语条目        |
 * | bibliography| `bibliographyTitle bibEntry+`                                           | `IRDoc.bibliography: IRBibEntry[]`                | 参考文献条目                |
 *
 * 术语条目（termDef）的 `level` 属性在编辑器里由人选择（斜杠菜单「一/二/三级术语条」），Resolver
 * 的编号只看位置、不读该值。写作片段的缺省值与条对齐（`childLevel`：章/附录下为 1，L 级条下为
 * L+1），使显示层级与编号路径深度一致；显式给出的 1~5 的值原样保留（与条不同，不要求一致）。
 */
import type {
  IRAppendix, IRBibEntry, IRBlock, IRChapter, IRClause, IRTermEntry,
} from './types'

/** 片段中可出现的 IR 节点（投影的输入、归一化的输出）。 */
export type IRFragmentNode =
  | IRChapter | IRAppendix | IRClause | IRBlock | IRTermEntry | IRBibEntry

/** 条的层级（与 IRClause.level 一致）。 */
export type FragmentLevel = 1 | 2 | 3 | 4 | 5

/** 片段的插入位置：父节点类型（条需给出父条自身的层级）。 */
export type AuthoringContext =
  /** 前言正文（`IRDoc.front.foreword`） */
  | { parent: 'foreword' }
  /** 引言正文（`IRDoc.front.introduction`） */
  | { parent: 'introduction' }
  /** 文档顶层的章序列（`IRDoc.body`） */
  | { parent: 'body' }
  /** 章内部 */
  | { parent: 'chapter' }
  /** 条内部；`level` 为该父条自身的层级（1~5） */
  | { parent: 'clause'; level: FragmentLevel }
  /** 文档顶层的附录序列（`IRDoc.appendices`） */
  | { parent: 'appendices' }
  /** 附录内部 */
  | { parent: 'appendix' }
  /** 参考文献列表（`IRDoc.bibliography`） */
  | { parent: 'bibliography' }

export interface FragmentContextRules {
  /** 是否允许块（段落、列项、表、图、公式、注、示例……） */
  blocks: boolean
  chapter: boolean
  appendix: boolean
  clause: boolean
  termEntry: boolean
  bibEntry: boolean
  /** 子条与子术语条目在该位置的层级；不允许条与术语条目时省略。 */
  childLevel?: FragmentLevel
}

const NO_RULES: FragmentContextRules = {
  blocks: false, chapter: false, appendix: false, clause: false, termEntry: false, bibEntry: false,
}

const PARENT_LABELS = {
  foreword: '前言',
  introduction: '引言',
  body: '正文章序列',
  chapter: '章',
  clause: '条',
  appendices: '附录序列',
  appendix: '附录',
  bibliography: '参考文献',
} as const

const PARENTS = Object.keys(PARENT_LABELS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 校验上下文本身（来自 MCP 的 JSON 不可信）；合法返回 undefined，否则返回中文原因。 */
export function validateAuthoringContext(context: unknown): string | undefined {
  if (!isRecord(context) || typeof context.parent !== 'string' || !PARENTS.includes(context.parent)) {
    return `上下文的 parent 必须是 ${PARENTS.join('、')} 之一`
  }
  const allowedKeys = context.parent === 'clause' ? ['parent', 'level'] : ['parent']
  const extra = Object.keys(context).find(key => !allowedKeys.includes(key))
  if (extra) return `上下文含有未知字段「${extra}」`
  if (context.parent === 'clause') {
    const level = context.level
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 5) {
      return '条上下文必须给出父条的层级 level（1~5 的整数）'
    }
  }
  return undefined
}

/** 上下文的中文名称，用于诊断信息。 */
export function describeAuthoringContext(context: AuthoringContext): string {
  return context.parent === 'clause'
    ? `${context.level} 级条`
    : PARENT_LABELS[context.parent]
}

/**
 * 该上下文允许的节点种类与子层级。上下文必须已通过 {@link validateAuthoringContext}。
 * 这里按 IR 类型表达（块 = 全部 IRBlock）；写作片段另行收窄可写的块种类（见 authoring.ts）。
 */
export function fragmentContextRules(context: AuthoringContext): FragmentContextRules {
  switch (context.parent) {
    case 'foreword':
    case 'introduction':
      return { ...NO_RULES, blocks: true }
    case 'body':
      return { ...NO_RULES, chapter: true }
    case 'appendices':
      return { ...NO_RULES, appendix: true }
    case 'chapter':
    case 'appendix':
      return { ...NO_RULES, blocks: true, clause: true, termEntry: true, childLevel: 1 }
    case 'clause':
      // 5 级条再往下没有可表示的层级：不能再嵌套条或术语条目，只能放块。
      return context.level >= 5
        ? { ...NO_RULES, blocks: true }
        : { ...NO_RULES, blocks: true, clause: true, termEntry: true, childLevel: (context.level + 1) as FragmentLevel }
    case 'bibliography':
      return { ...NO_RULES, bibEntry: true }
  }
}
