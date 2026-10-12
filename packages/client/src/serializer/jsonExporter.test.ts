// @vitest-environment happy-dom
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { Editor, getSchema } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { type PMJsonNode, renderSemanticJson } from '@ses/shared'
import { fullFixture } from '../../../shared/src/ir/__tests__/fixtures'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { parseXmlToEditorJson } from './xmlParser'
import { exportSemanticJson } from './jsonExporter'

const editors: Editor[] = []
const fixtureDir = resolvePath(process.cwd(), 'src/serializer/__fixtures__')

function createEditor(content: Record<string, unknown>): Editor {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({ element, extensions: createEditorExtensions(), content })
  editors.push(editor)
  return editor
}

function createSchemaDoc(content: Record<string, unknown>) {
  const schema = getSchema(createEditorExtensions())
  return schema.nodeFromJSON(content)
}

function readGolden(name: string): string {
  return readFileSync(resolvePath(fixtureDir, 'golden', `${name}.json.golden`), 'utf8')
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function makeAllElementsContent(): Record<string, unknown> {
  const content = fullFixture() as unknown as Record<string, unknown>
  content.type = 'doc'
  delete content.attrs
  return content
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    const element = editor.options.element
    editor.destroy()
    if (element instanceof HTMLElement) element.remove()
  }
})

describe('semantic JSON migration', () => {
  it('pins the pre-migration fixture and golden sources by SHA-256', () => {
    const manifest = JSON.parse(readFileSync(resolvePath(fixtureDir, 'golden/manifest.json'), 'utf8'))
    const sampleXml = readFileSync(resolvePath(fixtureDir, 'sample-standard.xml'))
    const allElementsSource = readFileSync(resolvePath(process.cwd(), '../shared/src/ir/__tests__/fixtures.ts'))

    expect(sha256(sampleXml)).toBe(manifest.sources['sample-standard'].sha256)
    expect(sha256(allElementsSource)).toBe(manifest.sources['all-elements'].sha256)
    expect(sha256(readGolden('sample-standard'))).toBe(manifest.goldens['sample-standard'].sha256)
    expect(sha256(readGolden('all-elements'))).toBe(manifest.goldens['all-elements'].sha256)
  })

  it('matches the legacy production exporter byte-for-byte for sample-standard.xml', () => {
    const schema = getSchema(createEditorExtensions())
    const xml = readFileSync(resolvePath(fixtureDir, 'sample-standard.xml'), 'utf8')
    const content = parseXmlToEditorJson(xml, schema.topNodeType.name) as unknown as Record<string, unknown>
    const doc = schema.nodeFromJSON(content)
    const before = doc.toJSON()
    const numberedTypesWithoutNodeId = new Set<string>()
    doc.descendants(node => {
      if (!['chapter', 'clause', 'termDef', 'appendix'].includes(node.type.name)
        || (typeof node.attrs.nodeId === 'string' && node.attrs.nodeId.length > 0)) return
      numberedTypesWithoutNodeId.add(node.type.name)
    })
    const actual = JSON.stringify(exportSemanticJson(doc), null, 2)

    expect(numberedTypesWithoutNodeId.size).toBeGreaterThan(0)
    expect(actual).toBe(readGolden('sample-standard'))
    expect(doc.toJSON()).toEqual(before)
    expect(actual).not.toContain('__ses_json_export__')
  })

  it('matches the legacy production exporter byte-for-byte for the all-elements fixture', () => {
    const doc = createSchemaDoc(makeAllElementsContent())
    const actual = JSON.stringify(exportSemanticJson(doc), null, 2)

    expect(actual).toBe(readGolden('all-elements'))
  })

  it('uses Resolver numbering for legacy counter edge cases', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'chapter',
          content: [
            { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
            {
              type: 'clause',
              attrs: { level: 2 },
              content: [{ type: 'clauseTitle', attrs: { level: 2 }, content: [{ type: 'text', text: '层级跳跃' }] }],
            },
          ],
        },
        { type: 'chapter', content: [{ type: 'chapterTitle', content: [{ type: 'text', text: '引用文件' }] }] },
        {
          type: 'chapter',
          content: [
            { type: 'chapterTitle', content: [{ type: 'text', text: '术语和定义' }] },
            {
              type: 'termDef',
              attrs: { level: 2 },
              content: [
                { type: 'termName', content: [{ type: 'text', text: '术语' }] },
                { type: 'termDefinition', content: [{ type: 'text', text: '定义' }] },
              ],
            },
          ],
        },
        ...Array.from({ length: 27 }, (_, index) => ({
          type: 'appendix',
          content: [
            { type: 'appendixLabel', content: [{ type: 'text', text: '（资料性）' }] },
            { type: 'appendixTitle', content: [{ type: 'text', text: `附录内容${index + 1}` }] },
          ],
        })),
      ],
    })
    const rendered = exportSemanticJson(editor.state.doc)
    const firstChapter = rendered.content?.[0]
    const skippedClause = firstChapter?.content?.find(node => node.type === 'clause')
    const thirdChapter = rendered.content?.[2]
    const termDef = thirdChapter?.content?.find(node => node.type === 'termDef')
    const lastAppendix = rendered.content?.at(-1)

    // The previous counter emitted 1.0.1 for a direct level-2 clause; Resolver
    // labels the actual first child 1.1 and reports its heading-skip diagnostic.
    expect(skippedClause).toMatchObject({ number: '1.1', path: '1.1' })
    // The previous counter emitted 3.0.1 for a level-2 term; the terms-section
    // Resolver numbers entries by sibling position, so this first entry is 3.1.
    expect(termDef).toMatchObject({ number: '3.1', path: '3.1' })
    // The previous char-code implementation emitted '[' for appendix 27;
    // Resolver's alphabetic sequence continues with AA.
    expect(lastAppendix).toMatchObject({ number: 'AA', path: '附录AA' })
  })

  it('retains production-schema marks on inline formula atoms', () => {
    const editor = createEditor({
      type: 'doc',
      content: [{
        type: 'chapter',
        content: [
          { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
          {
            type: 'stdParagraph',
            content: [{
              type: 'formulaInline',
              attrs: { latex: 'x', source: 'equation' },
              marks: [
                { type: 'variable', attrs: { kind: 'symbol', name: 'x' } },
                { type: 'textStyle', attrs: { color: '#123456', baseline: 'super' } },
              ],
            }],
          },
        ],
      }],
    })
    const rendered = exportSemanticJson(editor.state.doc)
    const paragraph = rendered.content?.[0]?.content?.find(node => node.type === 'stdParagraph')
    const formulaInline = paragraph?.content?.find(node => node.type === 'formulaInline')

    expect(formulaInline).toMatchObject({
      attrs: { latex: 'x', source: 'equation' },
    })
    expect(formulaInline?.marks).toEqual(expect.arrayContaining([
      { type: 'variable', attrs: { kind: 'symbol', name: 'x' } },
      { type: 'textStyle', attrs: { color: '#123456', baseline: 'super' } },
    ]))
    expect(formulaInline).not.toHaveProperty('number')
    expect(formulaInline).not.toHaveProperty('path')
  })

  it('preserves unknown PM fields, attrs, and marks without mutating the source', () => {
    const chapterAttrs = JSON.parse('{"nodeId":"chapter-1","futureAttr":{"value":"kept"},"__proto__":{"polluted":true}}') as Record<string, unknown>
    const futureMark = JSON.parse('{"type":"futureMark","attrs":{"futureMarkAttr":"kept"},"futureMarkField":9,"__proto__":{"polluted":true}}')
    const source = {
      type: 'doc',
      attrs: { futureDocAttr: { retained: true } },
      futureNodeField: ['kept', 7],
      content: [{
        type: 'chapter',
        attrs: chapterAttrs,
        futureChapterField: 'preserved',
        content: [{
          type: 'text',
          text: 'content',
          marks: [futureMark],
        }],
      }, {
        type: 'figure',
        attrs: { nodeId: 'figure-1' },
        content: [],
      }],
    } as unknown as PMJsonNode
    const before = structuredClone(source)
    const rendered = renderSemanticJson(source, {
      'chapter-1': { label: '6', xmlId: 'sec_6', refText: '第6章' },
      'figure-1': { label: '图9', xmlId: 'fig_9', refText: '图9' },
    })

    expect(rendered.attrs).toEqual({ futureDocAttr: { retained: true } })
    expect(rendered.futureNodeField).toEqual(['kept', 7])
    expect(rendered.content?.[0]).toMatchObject({
      number: '6',
      path: '6',
      futureChapterField: 'preserved',
      attrs: { nodeId: 'chapter-1', futureAttr: { value: 'kept' } },
    })
    expect(rendered.content?.[0]?.content?.[0]?.marks?.[0]).toMatchObject({
      type: 'futureMark',
      attrs: { futureMarkAttr: 'kept' },
      futureMarkField: 9,
    })
    const renderedAttrs = rendered.content?.[0]?.attrs
    const renderedMark = rendered.content?.[0]?.content?.[0]?.marks?.[0]
    expect(Object.prototype.hasOwnProperty.call(renderedAttrs, '__proto__')).toBe(true)
    expect(renderedAttrs?.['__proto__']).toEqual({ polluted: true })
    expect(Object.getPrototypeOf(renderedAttrs)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(renderedMark, '__proto__')).toBe(true)
    expect(renderedMark?.['__proto__']).toEqual({ polluted: true })
    expect(rendered.content?.[1]).not.toHaveProperty('number')
    expect(rendered.content?.[1]).not.toHaveProperty('path')
    expect(source).toEqual(before)
  })

  it('does not mistake prototype property names for legacy semantic node types', () => {
    const source = {
      type: 'doc',
      content: [
        { type: 'constructor' },
        { type: '__proto__' },
      ],
    } as unknown as PMJsonNode
    const rendered = renderSemanticJson(source, {})

    expect(rendered.content).toEqual([{ type: 'constructor' }, { type: '__proto__' }])
  })
})
