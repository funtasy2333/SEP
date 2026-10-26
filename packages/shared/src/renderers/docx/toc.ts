/**
 * 固定目次条目与页码域（docs/wp7-docx-delivery.md §7）。
 *
 * 目次条目在导出时按 IR/Resolver 生成；页码由逐条 PAGEREF 域在 Word 中计算。每个目标都用
 * 顺序分配的稳定书签名，源段落由 nodeId 或前置部分槽位直接关联，不按标题文字反查。
 */

import type { IRChapterChild, IRClause, IRClauseChild, IRDoc, NodeId, ResolvedLabel } from '../../ir/types'
import type { DocxBookmark } from './types'
import { escapeXmlAttr, escapeXmlText, pPr } from './xml'
import { plainRun, renderInlines } from './body/inline'

const IDEOGRAPHIC_SPACE = '　'

export type TocTarget =
  | { kind: 'node'; nodeId: NodeId }
  | { kind: 'foreword' }
  | { kind: 'introduction' }
  | { kind: 'bibliography' }

export interface TocEntry {
  styleId: 'TOC1' | 'TOC2'
  target: TocTarget
  bookmark: DocxBookmark
  runsXml: string
}

export interface StaticToc {
  entries: TocEntry[]
  xml: string
  bookmarksByNodeId: ReadonlyMap<NodeId, DocxBookmark>
  forewordBookmark?: DocxBookmark
  introductionBookmark?: DocxBookmark
  bibliographyBookmark?: DocxBookmark
}

function labelRuns(label: string | undefined): string {
  return label ? plainRun(label) + plainRun(IDEOGRAPHIC_SPACE) : ''
}

function pagerefField(bookmark: DocxBookmark): string {
  return (
    `<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> PAGEREF ${escapeXmlText(bookmark.name)} \\h </w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>待更新</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
  )
}

function renderEntry(entry: TocEntry): string {
  const ppr = pPr([['pStyle', `<w:pStyle w:val="${entry.styleId}"/>`]])
  const link =
    `<w:hyperlink w:anchor="${escapeXmlAttr(entry.bookmark.name)}" w:history="1">` +
    `${entry.runsXml}</w:hyperlink>`
  return `<w:p>${ppr}${link}<w:r><w:tab/></w:r>${pagerefField(entry.bookmark)}</w:p>`
}

/**
 * 收录前言、引言、章、一级有题条、附录、参考文献。条的层级按实际嵌套深度计算，忽略
 * IRClause.level（它用于诊断标题层级问题）；同级条与其后代始终按 IR 文档顺序展开。
 */
export function buildStaticToc(doc: IRDoc, labels: Record<NodeId, ResolvedLabel>): StaticToc {
  const entries: TocEntry[] = []
  const bookmarksByNodeId = new Map<NodeId, DocxBookmark>()
  let forewordBookmark: DocxBookmark | undefined
  let introductionBookmark: DocxBookmark | undefined
  let bibliographyBookmark: DocxBookmark | undefined
  let nextId = 0

  const add = (target: TocTarget, styleId: TocEntry['styleId'], runsXml: string): DocxBookmark => {
    nextId += 1
    const bookmark = { id: nextId, name: `SesToc${String(nextId).padStart(6, '0')}` }
    entries.push({ styleId, target, bookmark, runsXml })
    if (target.kind === 'node') bookmarksByNodeId.set(target.nodeId, bookmark)
    else if (target.kind === 'foreword') forewordBookmark = bookmark
    else if (target.kind === 'introduction') introductionBookmark = bookmark
    else bibliographyBookmark = bookmark
    return bookmark
  }

  if (doc.front.foreword.length > 0) add({ kind: 'foreword' }, 'TOC1', plainRun('前言'))
  if (doc.front.introduction.length > 0) add({ kind: 'introduction' }, 'TOC1', plainRun('引言'))

  const visitClause = (clause: IRClause, depth: number): void => {
    if (depth === 1 && clause.titled) {
      const prefix = labelRuns(labels[clause.id]?.label)
      add({ kind: 'node', nodeId: clause.id }, 'TOC2', prefix + renderInlines(clause.title, labels))
    }
    for (const child of clause.children) {
      if (child.kind === 'clause') visitClause(child, depth + 1)
    }
  }

  const visitContainer = (children: readonly (IRChapterChild | IRClauseChild)[]): void => {
    for (const child of children) {
      if (child.kind === 'clause') visitClause(child, 1)
    }
  }

  for (const chapter of doc.body) {
    add(
      { kind: 'node', nodeId: chapter.id },
      'TOC1',
      labelRuns(labels[chapter.id]?.label) + renderInlines(chapter.title, labels),
    )
    // 术语章中的 termEntry 和补充说明条（如 3.3）均不作为目次二级条目。
    if (chapter.secType !== 'terms') visitContainer(chapter.children)
  }

  for (const appendix of doc.appendices) {
    add(
      { kind: 'node', nodeId: appendix.id },
      'TOC1',
      plainRun(labels[appendix.id]?.label ?? '') +
        plainRun(appendix.normative ? '（规范性）' : '（资料性）') +
        plainRun(IDEOGRAPHIC_SPACE) +
        renderInlines(appendix.title, labels),
    )
    for (const child of appendix.children) {
      if (child.kind === 'clause') visitClause(child, 1)
      else if (child.kind === 'termEntry') {
        add(
          { kind: 'node', nodeId: child.id },
          'TOC2',
          labelRuns(labels[child.id]?.label) + renderInlines(child.term, labels),
        )
      }
    }
  }

  if (doc.bibliography.length > 0) {
    add({ kind: 'bibliography' }, 'TOC1', plainRun('参考文献'))
  }

  return {
    entries,
    xml: entries.map(renderEntry).join(''),
    bookmarksByNodeId,
    forewordBookmark,
    introductionBookmark,
    bibliographyBookmark,
  }
}
