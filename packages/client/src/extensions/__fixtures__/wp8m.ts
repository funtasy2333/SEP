import type { PMJsonNode } from '@ses/shared'
import { createG1Fixture } from './wp8m-g1'
import { createWp8mG2Fixture } from './wp8m-g2'
import { createWp8mG3Fixture } from './wp8m-g3'
import { createWp8mG4Fixture } from './wp8m-g4'
import { createWp8mG5Fixture } from './wp8m-g5'
import { createG6Fixture, createG6IntroductionNode } from './wp8m-g6'
import { createG7NoteFixture } from './wp8m-g7'
import { createWp8mG8Fixture } from './wp8m-g8'

/**
 * WP8.M M-Z 全要素 fixture（docs/wp8.m/design.md §4.9 第 1 项）：把 G1～G8 的全部新结构汇总进一篇生产 PM 文档。
 * 不改 wp6.ts，也不改各组的 wp8m-g*.ts：本文件只从各组 fixture 里按 nodeId 取出节点再重新编排，
 * 所以各组 nodeId 前缀（g1-…g8-）仍保证全文唯一。IR 原生版本见 shared/src/ir/__tests__/wp8mFixtures.ts，
 * 两者的内容逐节点对应（client 的 wp8mIntegration.test.ts 断言 `pmToIr(本 fixture)` 与 IR 原生版本深度相等）。
 *
 * 文档结构（括号内为覆盖的组/矩阵行）：
 *   foreword  noteBlock 多块注（G7 M-5.6-05）
 *   introduction 条 0.1（0.1.1、0.1.2）、0.2、无题条 0.3（G6 M-4.3.4-02/-03）
 *   第 1 章 范围          引用行内图、缩略语、术语、引言条的段落（G2 M-10.1.1-04、G3 M-8.3-02、G5、G6）
 *   第 2 章 规范性引用文件  引导语 + 清单（std×3 + 带脚注的 mixed）（G1 M-4.4.2.3-02/-03/-04、M-4.4.2.3.2-01、M-E-06）
 *   第 3 章 术语和定义      带领域的术语、嵌套术语（G5 M-9.2.9-01、M-9.2.1-05）
 *   第 4 章 符号和缩略语    缩略语表（G2 M-10.1.4-01/-03/-04/-05）
 *   第 5 章 总体要求        正文 stdRef / mixedCitation（G1 M-10.2-01/-02、M-10.1.7-01）
 *   第 6 章 图的说明        图例、图注、图中示例、行内图（G3 M-8.5-01～06、M-8.2-11、M-8.4-03）
 *   第 7 章 技术要求        列项引用（G4 M-10.1.5-01/-02）
 *   第 8 章 技术要求        罗马列项、单段/多块注与示例、单元格内多块注（G7 M-5.7-04、M-5.6-05）
 *   第 9 章 表的版式        名义列宽与分边边框样式（G8 M-6.1-03、M-6.3.3.1-01，M-C.1-02 的模型层）
 *   附录 A（缩略语）、附录 B（图）、附录 C（术语）；参考文献（自定义标题“参考书目”，M-4.5.3-02）；图资源
 */

function find(root: PMJsonNode, nodeId: string): PMJsonNode | undefined {
  if (root.attrs?.nodeId === nodeId) return root
  for (const child of root.content ?? []) {
    const found = find(child, nodeId)
    if (found) return found
  }
  return undefined
}

/** 取出某组 fixture 里 nodeId 对应的节点；找不到说明各组 fixture 变了，直接报错，不静默跳过。 */
function pick(root: PMJsonNode, nodeId: string): PMJsonNode {
  const found = find(root, nodeId)
  if (!found) throw new Error(`wp8m 全要素 fixture：在组 fixture 中找不到节点 ${nodeId}`)
  return found
}

function topLevel(root: PMJsonNode, type: string): PMJsonNode[] {
  return (root.content ?? []).filter(node => node.type === type)
}

/** 全要素 fixture 中各部分的 nodeId（供测试按名取用）。 */
export const WP8M_IDS = {
  scope: 'g1-ch1',
  normRefs: 'g1-ch2',
  terms: 'g5-terms',
  abbreviations: 'g2-abbr-ch',
  requirements: 'g1-ch3',
  figures: 'g3-fig-ch',
  listRefs: 'g4-ch1',
  notes: 'g7-ch1',
  tables: 'g8-body',
  appendices: ['g2-app-a', 'g3-app-a', 'g5-app-a'],
} as const

export function createWp8mFixture(): PMJsonNode {
  const g1 = createG1Fixture()
  const g2 = createWp8mG2Fixture()
  const g3 = createWp8mG3Fixture()
  const g4 = createWp8mG4Fixture()
  const g5 = createWp8mG5Fixture()
  const g6 = createG6Fixture()
  const g7 = createG7NoteFixture()
  const g8 = createWp8mG8Fixture()

  // 范围章：G1 的范围章，再接各组范围章里的引用段（缩略语引用、行内图 + 图引用、引言条引用）和一段术语引用。
  // 术语引用只用 crossRef(term)：G5 组 fixture 里的 termRef mark 是 WP6 既有 mark，HTML/DOCX 一直不放行，
  // 带进来会让全要素 fixture 的输出边界结论混入与 WP8.M 无关的阻断。
  const scope = pick(g1, WP8M_IDS.scope)
  scope.content = [
    ...scope.content!,
    pick(g2, 'g2-scope-p'),
    pick(g3, 'g3-scope-p'),
    {
      type: 'stdParagraph',
      attrs: { nodeId: 'wp8m-term-ref' },
      content: [
        { type: 'text', text: '术语见' },
        { type: 'text', text: '协会', marks: [{ type: 'crossRef', attrs: { targetId: 'g5-t1', refType: 'term' } }] },
        { type: 'text', text: '，领域术语见' },
        { type: 'text', text: '技术规范', marks: [{ type: 'crossRef', attrs: { targetId: 'g5-t331', refType: 'term' } }] },
        { type: 'text', text: '。' },
      ],
    },
    pick(g6, 'g6-ch1-c1-p'),
  ]

  // 术语章：去掉含嵌套术语的 g5-t4（嵌套术语条目 nestedEntries 是 WP6 既有口径，HTML/DOCX 一直不放行；
  // 嵌套条目的 term_<编号> 由 G5 组测试覆盖）。
  const terms = pick(g5, WP8M_IDS.terms)
  terms.content = terms.content!.filter(node => node.attrs?.nodeId !== 'g5-t4')

  // 表章：去掉同时带编辑器拖拽列宽（cell.columnWidths）的 g8-tbl-px——HTML 从不消费 px 列宽，会混入与 WP8.M 无关的阻断；
  // 名义列宽与 px 列宽两条通路并存由 G8 组测试覆盖。
  const tables = pick(g8, WP8M_IDS.tables)
  tables.content = tables.content!.filter(node => node.attrs?.nodeId !== 'g8-tbl-px')

  const appendices = [pick(g2, 'g2-app-a'), pick(g3, 'g3-app-a'), pick(g5, 'g5-app-a')]
  const [bibliography] = topLevel(g1, 'bibliography')
  const [resource] = topLevel(g3, 'figureResource')
  if (!bibliography || !resource) throw new Error('wp8m 全要素 fixture：缺少参考文献或图资源')

  return {
    type: 'doc',
    attrs: { extensionVersion: 1 },
    content: [
      { type: 'foreword', content: [pick(g7, 'g7-fw-note')] },
      createG6IntroductionNode(),
      scope,
      pick(g1, WP8M_IDS.normRefs),
      terms,
      pick(g2, WP8M_IDS.abbreviations),
      pick(g1, WP8M_IDS.requirements),
      pick(g3, WP8M_IDS.figures),
      pick(g4, WP8M_IDS.listRefs),
      pick(g7, WP8M_IDS.notes),
      tables,
      ...appendices,
      bibliography,
      resource,
    ],
  }
}

/** 全要素 fixture 必须出现的新 PM 节点类型（设计 §3.3 的 12 个新节点；NoteBlock / ExampleBlock 在 G7）。 */
export const WP8M_NEW_NODE_TYPES = [
  'normRefList', 'normRefStd', 'normRefStdRef', 'normRefStdTitle', 'normRefMixed',
  'defList', 'figureLegend', 'figureLegendTitle', 'inlineImage', 'termSubjectField', 'noteBlock', 'exampleBlock',
] as const

/** 全要素 fixture 必须出现的新 mark（设计 §3.3）。 */
export const WP8M_NEW_MARK_TYPES = ['stdRef', 'mixedCitation'] as const
