// @vitest-environment happy-dom
/**
 * WP9.2e：PDF 请求构建与语义 HTML 导出迁入 @ses/io 后，client 输出与迁移前逐项相同的对照测试。
 *
 * 下面的 legacy* 函数是迁移前 client 实现的原样拷贝（extractToc 仍用浏览器 DOMParser，这里由 happy-dom 提供），
 * 作为对照基准；被测对象是 client 现在的薄壳（调用 @ses/io，目次提取不依赖 DOMParser）。
 * 语义 JSON 的对照由 jsonExporter.test.ts 的字节级 golden 承担。
 */
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import { extractPdfTocTargets } from '@ses/io'
import {
  irMetaFromDocumentMeta,
  pmToIr,
  renderHtml,
  resolve,
  type IRDocMeta,
  type PMJsonNode,
} from '@ses/shared'
import { fullRendererFixture } from '../../../shared/src/renderers/__tests__/fullRendererFixture'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { parseXmlToEditorJson } from './xmlParser'
import { exportSemanticHtml } from './htmlExporter'
import { buildPdfExportRequest, type PdfExportRequest, type PdfTocTarget } from './pdfExporter'

// ---------- 迁移前实现（原样拷贝，仅改名） ----------

/** 迁移前 pdfExporter.ts 的 extractToc。 */
function legacyExtractToc(html: string): PdfTocTarget[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const out: PdfTocTarget[] = []
  for (const li of Array.from(parsed.querySelectorAll('.ses-toc-item'))) {
    const pageEl = li.querySelector('.ses-toc-page')
    const textEl = li.querySelector('.ses-toc-text')
    const target = pageEl?.getAttribute('data-target') ?? ''
    const text = (textEl?.textContent ?? '').trim()
    if (!target || !text) continue
    const division: 'front' | 'body' =
      target === 'front_foreword' || target === 'front_intro' ? 'front' : 'body'
    out.push({ target, text, division })
  }
  return out
}

/** 迁移前 pdfExporter.ts 的 buildPdfExportRequest。 */
function legacyBuildPdfExportRequest(doc: PMNode, meta: Partial<IRDocMeta>): PdfExportRequest {
  const pmJson = doc.toJSON() as PMJsonNode
  const { doc: ir } = pmToIr(pmJson)

  if (meta.title !== undefined) ir.meta.title = meta.title
  if (meta.titleEn !== undefined) ir.meta.titleEn = meta.titleEn
  if (meta.stdCode !== undefined) ir.meta.stdCode = meta.stdCode
  if (meta.icsCode !== undefined) ir.meta.icsCode = meta.icsCode
  if (meta.ccsCode !== undefined) ir.meta.ccsCode = meta.ccsCode

  const { labels } = resolve(ir)
  const html = renderHtml(ir, labels, { variant: 'print' })

  return {
    html,
    toc: legacyExtractToc(html),
    docTitle: ir.meta.title ?? meta.title ?? '',
    filename: meta.title || '标准文件',
  }
}

/** 迁移前 htmlExporter.ts 的 exportSemanticHtml。 */
function legacyExportSemanticHtml(doc: PMNode): string {
  const pmJson = doc.toJSON() as PMJsonNode
  const { doc: ir } = pmToIr(pmJson)
  const { labels } = resolve(ir)
  return renderHtml(ir, labels, { variant: 'screen' })
}

// ---------- 对照文档 ----------

const schema = getSchema(createEditorExtensions())
const fixtureDir = resolvePath(process.cwd(), 'src/serializer/__fixtures__')

const text = (value: string): PMJsonNode => ({ type: 'text', text: value })
const paragraph = (nodeId: string, value: string): PMJsonNode => ({
  type: 'stdParagraph',
  attrs: { nodeId },
  content: [text(value)],
})

function nodeOf(content: unknown): PMNode {
  const node = schema.nodeFromJSON(content)
  node.check()
  return node
}

/** 前言、引言、章/条/附录/参考文献俱全；标题里带 & < > " 以及看起来像字符引用的文字。 */
function specialCharsDoc(chapterTitle: string, clauseTitle: string, appendixTitle: string): PMJsonNode {
  return {
    type: 'doc',
    content: [
      { type: 'foreword', attrs: { nodeId: 'fw' }, content: [paragraph('fw-p', '前言正文')] },
      { type: 'introduction', attrs: { nodeId: 'intro' }, content: [paragraph('in-p', '引言正文')] },
      {
        type: 'chapter',
        attrs: { nodeId: 'c1' },
        content: [
          { type: 'chapterTitle', content: [text(chapterTitle)] },
          paragraph('p1', '正文'),
          {
            type: 'clause',
            attrs: { nodeId: 'cl1', level: 1, hasTitle: true },
            content: [
              { type: 'clauseTitle', attrs: { level: 1 }, content: [text(clauseTitle)] },
              paragraph('p2', '条正文'),
              {
                type: 'clause',
                attrs: { nodeId: 'cl2', level: 2, hasTitle: true },
                content: [
                  { type: 'clauseTitle', attrs: { level: 2 }, content: [text(`${clauseTitle}（细则）`)] },
                  paragraph('p3', '细则正文'),
                ],
              },
            ],
          },
        ],
      },
      { type: 'chapter', attrs: { nodeId: 'c2' }, content: [{ type: 'chapterTitle', content: [text('第二章')] }, paragraph('p4', 'x')] },
      {
        type: 'appendix',
        attrs: { nodeId: 'a1', normative: true },
        content: [
          { type: 'appendixLabel', content: [text('（规范性）')] },
          { type: 'appendixTitle', content: [text(appendixTitle)] },
          paragraph('ap1', '附录正文'),
        ],
      },
      {
        type: 'appendix',
        attrs: { nodeId: 'a2', normative: false },
        content: [
          { type: 'appendixLabel', content: [text('（资料性）')] },
          { type: 'appendixTitle', content: [text(`${appendixTitle}（二）`)] },
          paragraph('ap2', '附录二正文'),
        ],
      },
      {
        type: 'bibliography',
        content: [
          { type: 'bibliographyTitle', content: [text('参考文献')] },
          { type: 'bibEntry', attrs: { nodeId: 'b1' }, content: [text('GB/T 1—2020 "标准" & <说明>')] },
        ],
      },
    ],
  }
}

function sampleStandardNode(): PMNode {
  const xml = readFileSync(resolvePath(fixtureDir, 'sample-standard.xml'), 'utf8')
  return nodeOf(parseXmlToEditorJson(xml, schema.topNodeType.name))
}

function allElementsNode(): PMNode {
  const content = fullRendererFixture() as unknown as Record<string, unknown>
  content.type = 'doc'
  delete content.attrs
  return nodeOf(content)
}

/** server 的导出夹具（编辑器 getJSON() 形态，含公式、表格、图、脚注），再补引言、附录、参考文献。 */
function serverFixtureNode(): PMNode {
  const fixture = JSON.parse(
    readFileSync(resolvePath(process.cwd(), '../server/src/export/__fixtures__/standard-document.json'), 'utf8'),
  ) as { content: PMJsonNode[] }
  const extra = specialCharsDoc('x', 'x', 'x').content!
  const pick = (type: string) => extra.filter((node) => node.type === type)
  const chapters = fixture.content.filter((node) => node.type === 'chapter')
  const head = fixture.content.filter((node) => node.type !== 'chapter')
  return nodeOf({
    ...fixture,
    content: [...head, ...pick('introduction'), ...chapters, ...pick('appendix'), ...pick('bibliography')],
  })
}

const SPECIAL_TITLES: ReadonlyArray<readonly [string, string, string]> = [
  ['范围 & 说明', '总则 < 要求', '附录 > 内容'],
  ['A "引号" B', '"首尾"', '"x" & "y"'],
  ['&amp; 原文就是字符引用', '&lt;b&gt; 与 &quot;', '&#38; &#x26;'],
  ['<script>alert(1)</script>', '<li class="ses-toc-item"><span class="ses-toc-text">伪造</span>', '</li></ol></nav>'],
  ['  首尾空白  ', '　全角空格　', ' 不换行空格 '],
  ['&&&&', '<<<<', '>>>>'],
]

const DOCS: ReadonlyArray<readonly [string, () => PMNode]> = [
  ['sample-standard.xml 导入结果', sampleStandardNode],
  ['全要素 fullRendererFixture', allElementsNode],
  ['server 导出夹具 + 引言/附录/参考文献', serverFixtureNode],
  ...SPECIAL_TITLES.map(
    ([chapter, clause, appendix], index) =>
      [`特殊字符标题 #${index + 1}`, () => nodeOf(specialCharsDoc(chapter, clause, appendix))] as const,
  ),
]

const META_CASES: ReadonlyArray<readonly [string, Partial<IRDocMeta>]> = [
  ['空 meta', {}],
  [
    '面板 meta（含特殊字符）',
    irMetaFromDocumentMeta({
      titleCn: '标准 & "名称" <甲>',
      titleEn: 'Title & <English>',
      standardNo: 'GB/T 99999—2026',
      icsCode: '01.120',
      ccsCode: 'A 00',
      standardType: 'national',
    }),
  ],
  ['标题为空串', { title: '' }],
]

describe('迁移前后 client 输出一致（对照迁移前实现）', () => {
  describe.each(DOCS)('%s', (_name, makeNode) => {
    it('print HTML 的目次：io 的无 DOMParser 提取与迁移前 DOMParser 提取完全相同，且非空', () => {
      const html = legacyBuildPdfExportRequest(makeNode(), {}).html
      const legacy = legacyExtractToc(html)
      expect(legacy.length).toBeGreaterThan(0)
      expect(extractPdfTocTargets(html)).toEqual(legacy)
    })

    it.each(META_CASES)('buildPdfExportRequest（%s）：html、toc、docTitle、filename 全部相同', (_metaName, meta) => {
      const node = makeNode()
      const before = JSON.stringify(node.toJSON())
      expect(buildPdfExportRequest(node, meta)).toEqual(legacyBuildPdfExportRequest(node, meta))
      expect(JSON.stringify(node.toJSON())).toBe(before)
    })

    it('exportSemanticHtml：字符串逐字相同', () => {
      const node = makeNode()
      expect(exportSemanticHtml(node)).toBe(legacyExportSemanticHtml(node))
    })
  })

  it('含前言/引言/附录/参考文献的文档，目次分区与转义文本符合预期（不只是两个实现互相一致）', () => {
    const node = nodeOf(specialCharsDoc('范围 & "A" <b>', '条 > 款', '附 <录>'))
    const { toc } = buildPdfExportRequest(node, {})
    expect(toc).toEqual([
      { target: 'front_foreword', text: '前言', division: 'front' },
      { target: 'front_intro', text: '引言', division: 'front' },
      { target: 'sec_1', text: '1　范围 & "A" <b>', division: 'body' },
      { target: 'sec_1.1', text: '1.1　条 > 款', division: 'body' },
      { target: 'sec_1.1.1', text: '1.1.1　条 > 款（细则）', division: 'body' },
      { target: 'sec_2', text: '2　第二章', division: 'body' },
      { target: 'sec_A', text: '附录A　（规范性）附 <录>', division: 'body' },
      { target: 'sec_B', text: '附录B　（资料性）附 <录>（二）', division: 'body' },
      { target: 'sec_bibliography', text: '参考文献', division: 'body' },
    ])
  })
})
