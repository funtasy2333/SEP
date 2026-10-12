// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import { expect, it } from 'vitest'
import { createEditorExtensions } from './editorExtensions'

const schema = getSchema(createEditorExtensions())
const t = (text: string) => ({ type: 'text', text, marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: 'red' } }] })
function roundtrip(json: object) {
  const source = schema.nodeFromJSON(json)
  source.check()
  const container = document.createElement('div')
  container.append(DOMSerializer.fromSchema(schema).serializeFragment(source.content))
  const fromHtml = document.createElement('div')
  fromHtml.innerHTML = container.innerHTML
  const parsed = DOMParser.fromSchema(schema).parse(fromHtml)
  parsed.check()
  return parsed
}

it.each([
  ['titlePart', { nodeId: 'title', lang: 'zh-Hans', role: 'main' }],
  ['publisher', { nodeId: 'publisher', role: 'publisher', identifier: '机构代码' }],
  ['copyright', { nodeId: 'copyright', holder: '版权所有者', year: '2026', language: 'zh-Hans' }],
  ['identifierPart', { nodeId: 'id-part', kind: 'year', position: 2 }],
  ['tbxTermDescriptor', { nodeId: 'descriptor', type: 'subjectField' }],
] as const)('parses only %s editable content, excluding its visible label through repeated HTML', (type, attrs) => {
  let current: object = { type: 'doc', content: [{ type, attrs, content: [t('实际正文')] }] }
  for (let i = 0; i < 3; i++) {
    const parsed = roundtrip(current)
    const node = parsed.firstChild!
    expect(node.type.name).toBe(type)
    expect(node.attrs).toMatchObject(attrs)
    expect(node.textContent).toBe('实际正文')
    expect(node.firstChild?.marks.some(mark => mark.type.name === 'bold')).toBe(true)
    expect(node.firstChild?.marks.find(mark => mark.type.name === 'textStyle')?.attrs.color).toBe('red')
    current = parsed.toJSON()
  }
})

it('keeps bibliography field labels separate from field values', () => {
  let current: object = { type: 'doc', content: [{ type: 'bibliography', content: [
    { type: 'bibliographyTitle' }, { type: 'bibEntry', attrs: { nodeId: 'bib-entry' }, content: [
      { type: 'bibStructured', content: [{ type: 'bibField', attrs: { nodeId: 'bib-title', name: 'title' }, content: [t('实际文献题名')] }] },
    ] },
  ] }] }
  for (let i = 0; i < 3; i++) {
    const parsed = roundtrip(current)
    const field = parsed.firstChild!.child(1).firstChild!.firstChild!
    expect(field.type.name).toBe('bibField')
    expect(field.attrs).toMatchObject({ nodeId: 'bib-title', name: 'title' })
    expect(field.textContent).toBe('实际文献题名')
    current = parsed.toJSON()
  }
})

it('preserves structured child counts and IDs without parsing container headings into content', () => {
  const contents = [
    { type: 'standardIdentifier', attrs: { nodeId: 'identifier', scheme: 'GB/T', value: '编号显示' }, content: [
      { type: 'identifierPart', attrs: { nodeId: 'part', kind: 'number', position: 1 }, content: [t('1000')] },
    ] },
    { type: 'tbxLangSet', attrs: { nodeId: 'language', lang: 'zh-Hans' }, content: [
      { type: 'tbxTig', attrs: { nodeId: 'tig' }, content: [{ type: 'tbxTermVariant', attrs: { nodeId: 'variant' }, content: [
        { type: 'tbxTerm', content: [t('真实术语')] },
        { type: 'tbxTermDescriptor', attrs: { nodeId: 'desc', type: 'partOfSpeech' }, content: [t('名词')] },
      ] }] },
    ] },
    { type: 'indexBlock', attrs: { nodeId: 'index', title: '标题标签' }, content: [
      { type: 'indexGroup', attrs: { nodeId: 'group', label: '组标签' }, content: [{ type: 'indexEntry', attrs: { nodeId: 'entry' }, content: [
        { type: 'indexTerm', content: [t('真实索引词')] }, { type: 'indexTarget', attrs: { targetId: 'variant' } },
      ] }] },
    ] },
  ]
  let current: object = { type: 'doc', content: contents }
  for (let i = 0; i < 3; i++) {
    const parsed = roundtrip(current)
    expect(parsed.childCount, JSON.stringify(parsed.toJSON())).toBe(3)
    expect(parsed.child(0).textContent).toBe('1000')
    expect(parsed.child(0).childCount).toBe(1)
    expect(parsed.child(1).textContent).toBe('真实术语名词')
    expect(parsed.child(1).childCount).toBe(1)
    expect(parsed.child(2).textContent).toBe('真实索引词')
    expect(parsed.child(2).childCount).toBe(1)
    expect(parsed.child(2).firstChild!.childCount).toBe(1)
    expect(parsed.child(2).firstChild!.firstChild!.attrs.nodeId).toBe('entry')
    current = parsed.toJSON()
  }
})

it('accepts plain external title HTML without the editor content wrapper', () => {
  const container = document.createElement('div')
  container.innerHTML = '<p data-type="title-part" lang="en" role="main"><strong>Plain title</strong></p>'
  const parsed = DOMParser.fromSchema(schema).parse(container)
  expect(parsed.firstChild?.type.name).toBe('titlePart')
  expect(parsed.firstChild?.textContent).toBe('Plain title')
  expect(parsed.firstChild?.firstChild?.marks.some(mark => mark.type.name === 'bold')).toBe(true)
})

it.each(['2026', '0012', 'false', 'true'])('keeps textual metadata and reference attributes as strings: %s', value => {
  let current: object = { type: 'doc', content: [
    { type: 'metadataBlock', content: [
      { type: 'titlePart', attrs: { lang: value, role: value }, content: [t('题名')] },
      { type: 'standardIdentifier', attrs: { scheme: value, value }, content: [] },
      { type: 'language', attrs: { tag: value, usage: value } },
      { type: 'publisher', attrs: { role: value, identifier: value }, content: [t('机构')] },
      { type: 'adoption', attrs: { reference: value, degree: value, language: value } },
      { type: 'replacedStandard', attrs: { reference: value, relation: value } },
      { type: 'copyright', attrs: { holder: value, year: value, language: value }, content: [t('声明')] },
    ] },
    { type: 'stdParagraph', content: [
      { type: 'formulaInline', attrs: { latex: value, source: value } },
      { type: 'text', text: '引用', marks: [{ type: 'bibRef', attrs: { targetId: value } }] },
    ] },
  ] }
  const original = schema.nodeFromJSON(current)
  for (let i = 0; i < 3; i++) {
    const parsed = roundtrip(current)
    original.firstChild!.content.content.forEach((node, index) => {
      expect(parsed.firstChild!.child(index).attrs).toEqual(node.attrs)
    })
    expect(parsed.child(1).firstChild!.attrs.latex).toBe(value)
    expect(parsed.child(1).child(1).marks, JSON.stringify(parsed.child(1).toJSON())).toEqual(original.child(1).child(1).marks)
    expect(parsed.child(1).child(1).marks.find(mark => mark.type.name === 'bibRef')?.attrs.targetId).toBe(value)
    current = parsed.toJSON()
  }
})

it.each(['titlePart', 'publisher', 'copyright'])('keeps empty %s content empty instead of storing its label', type => {
  const parsed = roundtrip({ type: 'doc', content: [{ type, attrs: { lang: 'en', role: 'main', holder: '机构', year: '2026' } }] })
  expect(parsed.firstChild?.type.name).toBe(type)
  expect(parsed.firstChild?.childCount).toBe(0)
})

it.each([
  ['bibRef', { targetId: '0012' }],
  ['termRef', { targetId: 'false' }],
  ['crossRef', { targetId: '0012', refId: 'true', refType: 'formula', refText: '2026' }],
  ['externalLink', { href: 'https://example.org/source', title: '0012', target: '_self', rel: 'nofollow' }],
] as const)('preserves semantic %s marks instead of changing them into generic links', (type, attrs) => {
  let current: object = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: '真实引用', marks: [{ type, attrs }, { type: 'bold' }] },
  ] }] }
  const original = schema.nodeFromJSON(current)
  for (let i = 0; i < 3; i++) {
    const parsed = roundtrip(current)
    expect(parsed.firstChild!.firstChild!.marks).toEqual(original.firstChild!.firstChild!.marks)
    expect(parsed.textContent).toBe('真实引用')
    current = parsed.toJSON()
  }
})

it('preserves bibliography external-link atoms and leaves ordinary external anchors supported', () => {
  const json = { type: 'doc', content: [{ type: 'bibliography', content: [
    { type: 'bibliographyTitle' }, { type: 'bibEntry', content: [{ type: 'bibStructured', content: [
      { type: 'bibExternalLink', attrs: { href: 'https://example.org/bib', title: '0012', displayText: '在线来源', target: '_self', rel: 'nofollow' } },
    ] }] },
  ] }] }
  const parsed = roundtrip(json)
  const atom = parsed.firstChild!.child(1).firstChild!.firstChild!
  expect(atom.type.name).toBe('bibExternalLink')
  expect(atom.attrs).toEqual(schema.nodeFromJSON(json).firstChild!.child(1).firstChild!.firstChild!.attrs)
  const container = document.createElement('div')
  container.innerHTML = '<p><a href="https://example.org/plain">普通外链</a></p>'
  const plain = DOMParser.fromSchema(schema).parse(container)
  expect(plain.firstChild?.firstChild?.marks.find(mark => mark.type.name === 'link')?.attrs.href).toBe('https://example.org/plain')
})

it.each([
  '../references/source.html', 'urn:isbn:9780000000000', '#section-1',
  'mailto:author@example.org', 'tel:+861234567890',
  'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
  ' HTTPS://example.org/source ', 'https://example.org/a?x=1&y="quoted"',
  'line\rbreak\u0000payload', '',
])('preserves original semantic link href while filtering navigation: %j', href => {
  const attrs = { href, title: '来源', target: '_self', rel: 'nofollow' }
  let current: object = { type: 'doc', content: [
    { type: 'stdParagraph', content: [{ type: 'text', text: '外链', marks: [{ type: 'externalLink', attrs }] }] },
    { type: 'bibliography', content: [{ type: 'bibliographyTitle' }, { type: 'bibEntry', content: [
      { type: 'bibStructured', content: [{ type: 'bibExternalLink', attrs: { ...attrs, displayText: '文献链接' } }] },
    ] }] },
  ] }
  for (let i = 0; i < 3; i++) {
    const source = schema.nodeFromJSON(current)
    const container = document.createElement('div')
    container.append(DOMSerializer.fromSchema(schema).serializeFragment(source.content))
    const anchors = Array.from(container.querySelectorAll('a[data-type]'))
    expect(anchors).toHaveLength(2)
    for (const anchor of anchors) {
      const clickable = href.trim()
      const allowed = /^(https?:\/\/|mailto:|tel:)/i.test(clickable) && !/[\u0000-\u0020]/.test(clickable)
      expect(anchor.getAttribute('href')).toBe(allowed ? clickable : null)
    }
    const parsed = roundtrip(current)
    expect(parsed.child(0).firstChild!.marks.find(mark => mark.type.name === 'externalLink')?.attrs).toEqual(attrs)
    expect(parsed.child(1).child(1).firstChild!.firstChild!.attrs).toEqual({ ...attrs, displayText: '文献链接' })
    current = parsed.toJSON()
  }
})

it.each(['external-link', 'bib-external-link'])('reads ordinary tagged %s href when payload is absent or malformed', type => {
  for (const payload of ['', ' data-external-href="invalid-json"', ' data-external-href="123"']) {
    const container = document.createElement('div')
    container.innerHTML = `<p><a data-type="${type}" href="urn:test:source"${payload}>来源</a></p>`
    const parsed = DOMParser.fromSchema(schema).parse(container)
    const inline = parsed.firstChild!.firstChild!
    const attrs = type === 'external-link' ? inline.marks.find(mark => mark.type.name === 'externalLink')!.attrs : inline.attrs
    expect(attrs.href).toBe('urn:test:source')
  }
})
