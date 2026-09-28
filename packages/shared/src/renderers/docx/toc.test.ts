import { describe, expect, it } from 'vitest'
import type { IRAppendix, IRChapter, IRClause, IRDoc, NodeId, ResolvedLabel } from '../../ir/types'
import { buildStaticToc } from './toc'
import { renderDocxTraced } from './render'
import { assertChildOrder, assertWellFormed } from './__tests__/helpers/checks'
import { docxOutline } from './__tests__/helpers/outline'

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

  const nestedAppendixClause: IRClause = {
    kind: 'clause', id: 'nested-appendix-clause', level: 1, titled: true,
    title: [{ text: '附录二级条不入目次' }], children: [],
  }
  const appendixClause: IRClause = {
    kind: 'clause', id: 'appendix-clause', level: 4, titled: true,
    title: [{ text: '附录一级条' }], children: [nestedAppendixClause],
  }
  const appendix: IRAppendix = {
    kind: 'appendix', id: 'appendix-a', normative: true,
    title: [{ text: '附录标题' }], children: [appendixClause],
  }

  const doc: IRDoc = {
    schemaVersion: 1,
    meta: { standardType: 'gb', title: '测试文件', stdCode: 'GB/T 12345—2026' },
    front: {
      foreword: [{ kind: 'paragraph', id: 'foreword-p', content: [{ text: '前言正文' }] }],
      introduction: [{ kind: 'paragraph', id: 'introduction-p', content: [{ text: '引言正文' }] }],
    },
    body: [chapterOne, chapterTwo],
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
    'appendix-a': label('附录A', 'sec_A'),
    'appendix-clause': label('A.1', 'sec_A.1'),
    'nested-appendix-clause': label('A.1.1', 'sec_A.1.1'),
    'bib-one': label('[1]', 'bib_1'),
    'ref-target': label('3.1', 'sec_3.1', '目标&文本'),
  }
  return { doc, labels }
}

function targetKey(entry: ReturnType<typeof buildStaticToc>['entries'][number]): string {
  return entry.target.kind === 'node' ? entry.target.nodeId : entry.target.kind
}

describe('static DOCX TOC', () => {
  it('collects headings by document depth and order, and resolves inline cross references', () => {
    const { doc, labels } = tocFixture()
    const toc = buildStaticToc(doc, labels)

    expect(toc.entries.map(targetKey)).toEqual([
      'foreword', 'introduction', 'chapter-one', 'top-level-one', 'top-level-two',
      'chapter-two', 'appendix-a', 'appendix-clause', 'bibliography',
    ])
    expect(toc.entries.map((entry) => entry.styleId)).toEqual([
      'TOC1', 'TOC1', 'TOC1', 'TOC2', 'TOC2', 'TOC1', 'TOC1', 'TOC2', 'TOC1',
    ])
    expect(toc.xml).toContain('结构 &lt;&amp; ')
    expect(toc.xml).toContain('目标&amp;文本')
    expect(toc.xml).toContain('<w:rPr><w:b/><w:bCs/></w:rPr>')
    expect(toc.xml).not.toContain('二级条不入目次')
    expect(toc.xml).not.toContain('附录二级条不入目次')
    expect(toc.xml).not.toContain('1.2') // 无标题条不进入目次
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
