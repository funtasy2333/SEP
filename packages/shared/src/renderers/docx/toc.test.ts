import { describe, expect, it } from 'vitest'
import type { IRAppendix, IRChapter, IRClause, IRDoc, IRTermEntry, NodeId, ResolvedLabel } from '../../ir/types'
import { buildStaticToc } from './toc'
import { renderDocxTraced } from './render'
import { assertChildOrder, assertWellFormed } from './__tests__/helpers/checks'
import { docxOutline } from './__tests__/helpers/outline'
import { parseXml, type XmlElement } from './__tests__/helpers/xmlTree'

const OPTS = {
  formulaOmml: {},
  images: {},
  stage: 'approval_draft' as const,
  createdAt: '2026-09-25T08:00:00.000Z',
}

function label(label: string, xmlId: string, refText = label): ResolvedLabel {
  return { label, xmlId, refText }
}

function tocFixture(): { doc: IRDoc; labels: Record<NodeId, ResolvedLabel> } {
  const nestedUnderTop: IRClause = {
    kind: 'clause', id: 'nested-under-top', level: 1, titled: true,
    title: [{ text: '二级条不入目次' }], children: [],
  }
  const topLevelOne: IRClause = {
    kind: 'clause', id: 'top-level-one', level: 5, titled: true,
    title: [
      { text: '结构 <& ' , marks: [{ type: 'bold' }] },
      { text: '引用', marks: [{ type: 'crossRef', targetId: 'ref-target' }] },
    ],
    children: [nestedUnderTop],
  }
  const untitled: IRClause = {
    kind: 'clause', id: 'untitled', level: 1, titled: false, title: [], children: [],
  }
  const topLevelTwo: IRClause = {
    kind: 'clause', id: 'top-level-two', level: 2, titled: true,
    title: [{ text: '重复标题' }], children: [],
  }
  const chapterOne: IRChapter = {
    kind: 'chapter', id: 'chapter-one', secType: 'general',
    title: [{ text: '重复标题' }], children: [topLevelOne, untitled, topLevelTwo],
  }
  const chapterTwo: IRChapter = {
    kind: 'chapter', id: 'chapter-two', secType: 'general',
    title: [{ text: '重复标题' }], children: [],
  }

  const termEntryOne: IRTermEntry = {
    kind: 'termEntry', id: 'terms-entry-one', term: [{ text: '术语条一' }],
    definition: [{ kind: 'paragraph', id: 'terms-definition-one', content: [{ text: '术语定义一' }] }],
    notes: [], examples: [],
  }
  const termEntryTwo: IRTermEntry = {
    kind: 'termEntry', id: 'terms-entry-two', term: [{ text: '术语条二' }],
    definition: [{ kind: 'paragraph', id: 'terms-definition-two', content: [{ text: '术语定义二' }] }],
    notes: [], examples: [],
  }
  const termsSupplement: IRClause = {
    kind: 'clause', id: 'terms-supplement', level: 1, titled: true,
    title: [{ text: '补充说明' }], children: [],
  }
  const termsChapter: IRChapter = {
    kind: 'chapter', id: 'terms-chapter', secType: 'terms',
    title: [{ text: '术语和定义' }], children: [termEntryOne, termEntryTwo, termsSupplement],
  }

  const nestedAppendixClause: IRClause = {
    kind: 'clause', id: 'nested-appendix-clause', level: 1, titled: true,
    title: [{ text: '附录二级条不入目次' }], children: [],
  }
  const appendixClause: IRClause = {
    kind: 'clause', id: 'appendix-clause', level: 4, titled: true,
    title: [{ text: '附录一级条' }], children: [nestedAppendixClause],
  }
  const appendixTermEntry: IRTermEntry = {
    kind: 'termEntry', id: 'appendix-term-entry', term: [{ text: '附录术语' }],
    definition: [{ kind: 'paragraph', id: 'appendix-term-definition', content: [{ text: '附录术语定义。' }] }],
    notes: [], examples: [],
  }
  const appendix: IRAppendix = {
    kind: 'appendix', id: 'appendix-a', normative: true,
    title: [{ text: '附录标题' }], children: [appendixTermEntry, appendixClause],
  }

  const doc: IRDoc = {
    schemaVersion: 1,
    meta: { standardType: 'gb', title: '测试文件', stdCode: 'GB/T 12345—2026' },
    front: {
      foreword: [{ kind: 'paragraph', id: 'foreword-p', content: [{ text: '前言正文' }] }],
      introduction: [{ kind: 'paragraph', id: 'introduction-p', content: [{ text: '引言正文' }] }],
    },
    body: [chapterOne, chapterTwo, termsChapter],
    appendices: [appendix],
    bibliography: [{ kind: 'bibEntry', id: 'bib-one', content: [{ text: '参考资料' }] }],
  }

  const labels: Record<NodeId, ResolvedLabel> = {
    'chapter-one': label('1', 'sec_1'),
    'top-level-one': label('1.1', 'sec_1.1'),
    'nested-under-top': label('1.1.1', 'sec_1.1.1'),
    untitled: label('1.2', 'sec_1.2'),
    'top-level-two': label('1.3', 'sec_1.3'),
    'chapter-two': label('2', 'sec_2'),
    'terms-chapter': label('3', 'sec_3'),
    'terms-entry-one': label('3.1', 'sec_3.1'),
    'terms-entry-two': label('3.2', 'sec_3.2'),
    'terms-supplement': label('3.3', 'sec_3.3'),
    'appendix-a': label('附录A', 'sec_A'),
    'appendix-term-entry': label('A.1', 'sec_A.1'),
    'appendix-clause': label('A.2', 'sec_A.2'),
    'nested-appendix-clause': label('A.2.1', 'sec_A.2.1'),
    'bib-one': label('[1]', 'bib_1'),
    'ref-target': label('3.1', 'sec_3.1', '目标&文本'),
  }
  return { doc, labels }
}

function targetKey(entry: ReturnType<typeof buildStaticToc>['entries'][number]): string {
  return entry.target.kind === 'node' ? entry.target.nodeId : entry.target.kind
}

describe('static DOCX TOC', () => {
  it('原生 TOC 包含缓存条目，正文 TC 标记保留完整编号、附录性质与一级条范围', () => {
    const { doc, labels } = tocFixture()
    const { pkg } = renderDocxTraced(doc, labels, OPTS)
    const instructions: string[] = []
    const visit = (element: XmlElement) => {
      if (element.name === 'w:instrText') {
        instructions.push(element.children.map(child => child.kind === 'text' ? child.text : '').join(''))
      }
      for (const child of element.children) if (child.kind === 'element') visit(child)
    }
    visit(parseXml(pkg.parts['word/document.xml']))
    expect(instructions.filter(code => code.trim().startsWith('TOC '))).toEqual([' TOC \\f C \\h \\z '])
    const sources = instructions.filter(code => code.trim().startsWith('TC '))
    expect(sources).toHaveLength(11)
    expect(sources).toContain(' TC "前言" \\f C \\l "1" ')
    expect(sources).toContain(' TC "1.1　结构 <& 目标&文本" \\f C \\l "2" ')
    expect(sources).toContain(' TC "附录A（规范性）　附录标题" \\f C \\l "1" ')
    expect(sources).toContain(' TC "A.1　附录术语" \\f C \\l "2" ')
    expect(sources.join('')).not.toContain('补充说明')
  })

  it('TC 标记转义标题中的引号和反斜线，不让标题文字成为域开关', () => {
    const { doc, labels } = tocFixture()
    doc.body[0]!.title = [{ text: '标题 "引用" \\n' }]
    const { pkg } = renderDocxTraced(doc, labels, OPTS)
    const expected = ' TC &quot;1　标题 \\&quot;引用\\&quot; \\\\n&quot; \\f C \\l &quot;1&quot; '
    expect(pkg.parts['word/document.xml']).toContain(expected)
  })

  it('未排版的页码明确显示待更新，并向导出调用方报告需要 Word 更新', () => {
    const { doc, labels } = tocFixture()
    const { pkg } = renderDocxTraced(doc, labels, OPTS)
    const xml = pkg.parts['word/document.xml']
    const cachedPages = [...xml.matchAll(/<w:fldChar w:fldCharType="separate"\/><\/w:r><w:r><w:t>(.*?)<\/w:t>/g)]
    expect(cachedPages.map(match => match[1])).toEqual(Array(11).fill('待更新'))
    expect(pkg.warnings.filter(w => w.code === 'toc-pages-pending')).toHaveLength(1)
  })

  it('collects headings by document depth and order, and resolves inline cross references', () => {
    const { doc, labels } = tocFixture()
    const toc = buildStaticToc(doc, labels)

    expect(toc.entries.map(targetKey)).toEqual([
      'foreword', 'introduction', 'chapter-one', 'top-level-one', 'top-level-two',
      'chapter-two', 'terms-chapter', 'appendix-a', 'appendix-term-entry', 'appendix-clause', 'bibliography',
    ])
    expect(toc.entries.map((entry) => entry.styleId)).toEqual([
      'TOC1', 'TOC1', 'TOC1', 'TOC2', 'TOC2', 'TOC1', 'TOC1', 'TOC1', 'TOC2', 'TOC2', 'TOC1',
    ])
    expect(toc.xml).toContain('结构 &lt;&amp; ')
    expect(toc.xml).toContain('目标&amp;文本')
    expect(toc.xml).toContain('<w:rPr><w:b/><w:bCs/></w:rPr>')
    expect(toc.xml).not.toContain('二级条不入目次')
    expect(toc.xml).not.toContain('附录二级条不入目次')
    expect(toc.xml).not.toContain('术语条一')
    expect(toc.xml).not.toContain('术语条二')
    expect(toc.xml).not.toContain('补充说明')
    expect(toc.xml).not.toContain('1.2') // 无标题条不进入目次
  })

  it('把附录直属术语 A.1 和有标题条 A.2 作为 TOC2，并锚定到各自正文目标', () => {
    const { doc, labels } = tocFixture()
    const toc = buildStaticToc(doc, labels)
    const appendixTermEntry = toc.entries.find(
      (entry) => entry.target.kind === 'node' && entry.target.nodeId === 'appendix-term-entry',
    )!
    const appendixEntry = toc.entries.find(
      (entry) => entry.target.kind === 'node' && entry.target.nodeId === 'appendix-clause',
    )!
    const { pkg } = renderDocxTraced(doc, labels, OPTS)
    const xml = pkg.parts['word/document.xml']
    const termBookmark = appendixTermEntry.bookmark
    const clauseBookmark = appendixEntry.bookmark
    const termParagraph = [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)]
      .map((match) => match[0])
      .find((paragraph) => paragraph.includes('<w:pStyle w:val="SesTermNum"/>') && paragraph.includes('附录术语'))

    expect(appendixTermEntry.styleId).toBe('TOC2')
    expect(appendixTermEntry.runsXml).toContain('A.1')
    expect(appendixTermEntry.runsXml).toContain('附录术语')
    expect(appendixEntry.styleId).toBe('TOC2')
    expect(appendixEntry.runsXml).toContain('A.2')
    expect(appendixEntry.runsXml).toContain('附录一级条')
    expect(termParagraph).toBeDefined()
    expect(termParagraph).toContain(`<w:bookmarkStart w:id="${termBookmark.id}" w:name="${termBookmark.name}"/>`)
    expect(termParagraph).toContain('附录术语')
    expect(termParagraph).toContain(`<w:bookmarkEnd w:id="${termBookmark.id}"/>`)

    for (const bookmark of [termBookmark, clauseBookmark]) {
      expect(toc.xml).toContain(`w:anchor="${bookmark.name}"`)
      expect(xml.match(new RegExp(`<w:bookmarkStart w:id="${bookmark.id}" w:name="${bookmark.name}"/>`, 'g'))).toHaveLength(1)
      expect(xml.match(new RegExp(`<w:bookmarkEnd w:id="${bookmark.id}"/>`, 'g'))).toHaveLength(1)
      expect(xml.match(new RegExp(`PAGEREF ${bookmark.name} \\\\h`, 'g'))).toHaveLength(1)
    }
  })

  it('术语和定义章中的术语条及补充说明条 3.3 均不生成 TOC2 或目次书签', () => {
    const { doc, labels } = tocFixture()
    const toc = buildStaticToc(doc, labels)
    const termsEntries = toc.entries.filter(
      (entry) => entry.target.kind === 'node' &&
        ['terms-entry-one', 'terms-entry-two', 'terms-supplement'].includes(entry.target.nodeId),
    )

    expect(termsEntries).toEqual([])
    expect(toc.entries.find((entry) => targetKey(entry) === 'terms-chapter')?.styleId).toBe('TOC1')
    expect(toc.bookmarksByNodeId.has('terms-entry-one')).toBe(false)
    expect(toc.bookmarksByNodeId.has('terms-entry-two')).toBe(false)
    expect(toc.bookmarksByNodeId.has('terms-supplement')).toBe(false)
    expect(toc.xml).not.toContain('3.3')
    expect(toc.xml).not.toContain('补充说明')
  })

  it('给同名标题分配不同目标书签，每个 PAGEREF 与源书签一一对应', () => {
    const { doc, labels } = tocFixture()
    const toc = buildStaticToc(doc, labels)
    const { pkg } = renderDocxTraced(doc, labels, OPTS)
    const xml = pkg.parts['word/document.xml']

    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
    expect(toc.entries.filter((entry) => entry.runsXml.includes('重复标题'))).toHaveLength(3)
    expect(new Set(toc.entries.filter((entry) => entry.runsXml.includes('重复标题')).map((entry) => entry.bookmark.name)).size).toBe(3)

    for (const entry of toc.entries) {
      const { id, name } = entry.bookmark
      expect(xml.match(new RegExp(`<w:bookmarkStart w:id="${id}" w:name="${name}"/>`, 'g'))).toHaveLength(1)
      expect(xml.match(new RegExp(`<w:bookmarkEnd w:id="${id}"/>`, 'g'))).toHaveLength(1)
      expect(xml.match(new RegExp(`PAGEREF ${name} \\\\h`, 'g'))).toHaveLength(1)
      expect(xml).toContain(`w:anchor="${name}"`)
    }
    expect(xml).not.toContain('> TOC \\o')
    expect(pkg.parts['word/settings.xml']).toContain('<w:updateFields w:val="true"/>')
  })

  it('大纲快照包含可见目次文字，不暴露 PAGEREF 指令', () => {
    const { doc, labels } = tocFixture()
    const { pkg } = renderDocxTraced(doc, labels, OPTS)
    const outline = docxOutline(pkg)

    expect(outline).toContain('TOC1 │ — │ 前言⇥')
    expect(outline).toContain('TOC2 │ — │ 1.1　结构 <& 目标&文本⇥')
    expect(outline).toContain('TOC1 │ — │ 附录A（规范性）　附录标题⇥')
    expect(outline).not.toContain('PAGEREF')
  })

  it('空文档只保留目次标题，且最后内容段 keepNext 后接唯一终结线', () => {
    const doc: IRDoc = {
      schemaVersion: 1,
      meta: { standardType: 'gb', title: '空文件', stdCode: 'GB/T 0—2026' },
      front: { foreword: [], introduction: [] }, body: [], appendices: [], bibliography: [],
    }
    const { pkg } = renderDocxTraced(doc, {}, OPTS)
    const xml = pkg.parts['word/document.xml']
    const paragraphs = [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)]
    const lastContent = [...paragraphs].reverse().find(
      (match) => !match[1].includes('<w:sectPr') && !match[1].includes('w:pStyle w:val="SesEndMark"'),
    )!
    const endMarkIndex = xml.indexOf('<w:pStyle w:val="SesEndMark"/>')

    expect(xml).not.toContain('PAGEREF')
    expect(pkg.warnings.some(w => w.code === 'toc-pages-pending')).toBe(false)
    expect(xml).not.toContain('<w:bookmarkStart')
    expect(lastContent[1]).toContain('<w:keepNext/>')
    expect(xml.match(/<w:pStyle w:val="SesEndMark"\/>/g)).toHaveLength(1)
    expect(endMarkIndex).toBeGreaterThan(lastContent.index!)
    expect(xml.lastIndexOf('<w:sectPr')).toBeGreaterThan(endMarkIndex)
    for (const paragraph of paragraphs) {
      if (paragraph[1].includes('<w:sectPr')) expect(paragraph[1]).not.toContain('<w:keepNext/>')
      if (paragraph[1].includes('SesEndMark')) expect(paragraph[1]).not.toContain('<w:keepNext/>')
      if (paragraph[1].includes('w:pStyle w:val="TOC')) expect(paragraph[1]).not.toContain('<w:keepNext/>')
    }
  })
})
