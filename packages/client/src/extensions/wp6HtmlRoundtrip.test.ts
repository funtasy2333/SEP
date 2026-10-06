// @vitest-environment happy-dom
import { pmToIr, resolve, type PMJsonNode } from '@ses/shared'
import { getSchema } from '@tiptap/core'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions } from './editorExtensions'

const schema = getSchema(createEditorExtensions())
function htmlRoundtrip(json: object) {
  const source = schema.nodeFromJSON(json)
  source.check()
  const container = document.createElement('div')
  container.append(DOMSerializer.fromSchema(schema).serializeFragment(source.content))
  const parsedHtml = document.createElement('div')
  parsedHtml.innerHTML = container.innerHTML
  const reopened = DOMParser.fromSchema(schema).parse(parsedHtml)
  reopened.check()
  return { source, container, reopened }
}

const fields = {
  fontFamily: 'serif', fontSize: '14pt', color: 'red', backgroundColor: 'yellow',
  letterSpacing: '0.5px', baseline: 'super', textTransform: 'uppercase',
}
describe('production semantic HTML / clipboard roundtrip', () => {
  it.each(Object.entries(fields))('reads rendered CSS for textStyle.%s', (key, value) => {
    const { reopened } = htmlRoundtrip({ type: 'doc', content: [{ type: 'stdParagraph', content: [
      { type: 'text', text: '样式文字', marks: [{ type: 'textStyle', attrs: { [key]: value } }] },
    ] }] })
    expect(reopened.firstChild?.firstChild?.marks.find(mark => mark.type.name === 'textStyle')?.attrs[key]).toBe(value)
    expect(reopened.textContent).toBe('样式文字')
  })
  it('preserves all seven properties and adjacent bold text over repeated HTML parsing', () => {
    const json = { type: 'doc', content: [{ type: 'stdParagraph', content: [
      { type: 'text', text: '样式文字', marks: [{ type: 'textStyle', attrs: fields }, { type: 'bold' }] },
    ] }] }
    let current: object = json
    for (let i = 0; i < 3; i++) {
      const { reopened } = htmlRoundtrip(current)
      const marks = reopened.firstChild?.firstChild?.marks ?? []
      expect(marks.find(mark => mark.type.name === 'textStyle')?.attrs).toEqual(fields)
      expect(marks.some(mark => mark.type.name === 'bold')).toBe(true)
      current = reopened.toJSON()
    }
  })
  it.each(['tableCell', 'tableHeader'])('retains %s units and excludes visible unit badges from actual cell content', type => {
    let current: object = { type: 'doc', content: [{ type: 'stdTable', content: [
      { type: 'tableCaption' }, { type: 'table', content: [{ type: 'tableRow', content: [{
        type, attrs: { unit: 'mg/kg', colspan: 2, colwidth: [100, 120] },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '数值', marks: [{ type: 'italic' }] }] }],
      }] }] },
    ] }] }
    for (let i = 0; i < 3; i++) {
      const { reopened, container } = htmlRoundtrip(current)
      expect(container.querySelector('[data-unit]')?.getAttribute('data-unit')).toBe('mg/kg')
      const cell = reopened.firstChild?.child(1).firstChild?.firstChild
      expect(cell?.attrs.unit).toBe('mg/kg')
      expect(cell?.attrs.colspan).toBe(2)
      expect(cell?.attrs.colwidth).toEqual([100, 120])
      expect(cell?.textContent).toBe('数值')
      expect(cell?.firstChild?.firstChild?.marks.some(mark => mark.type.name === 'italic')).toBe(true)
      current = reopened.toJSON()
    }
  })
  it.each(['td', 'th'])('keeps plain external %s content with or without a data-unit', tag => {
    for (const unit of [null, 'mm']) {
      const container = document.createElement('div')
      container.innerHTML = `<table><tbody><tr><${tag}${unit ? ' data-unit="mm"' : ''}><p>外部数据</p></${tag}></tr></tbody></table>`
      const reopened = DOMParser.fromSchema(schema).parse(container)
      const cell = reopened.firstChild?.firstChild?.firstChild
      expect(cell?.attrs.unit).toBe(unit)
      expect(cell?.textContent).toBe('外部数据')
    }
  })
})

it('keeps cell and row numeric measures numeric across HTML', () => {
  const { reopened } = htmlRoundtrip({ type: 'doc', content: [{ type: 'table', content: [{
    type: 'tableRow', attrs: { height: 15, heightUnit: 'mm', borderWidth: 0.5, borderWidthUnit: 'pt' }, content: [{
      type: 'tableCell', attrs: { width: 24, widthUnit: 'mm', paddingTop: 2, paddingTopUnit: 'pt', borderLeft: 0.25, borderLeftUnit: 'pt' },
      content: [{ type: 'paragraph' }],
    }],
  }] }] })
  const row = reopened.firstChild?.firstChild
  expect(row?.attrs.height).toBe(15)
  expect(row?.attrs.borderWidth).toBe(0.5)
  expect(row?.firstChild?.attrs.width).toBe(24)
  expect(row?.firstChild?.attrs.paddingTop).toBe(2)
  expect(row?.firstChild?.attrs.borderLeft).toBe(0.25)
})

it('keeps explicit header row counts and unnumbered formulas typed when pasted from HTML', () => {
  const { reopened } = htmlRoundtrip({ type: 'doc', content: [
    { type: 'formula', attrs: { numbered: false }, content: [{ type: 'formulaContent', content: [{ type: 'text', text: 'x' }] }] },
    { type: 'stdTable', attrs: { headerRowCount: 0 }, content: [
      { type: 'tableCaption' }, { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph' }] }] }] },
    ] },
  ] })
  expect(reopened.firstChild?.attrs.numbered).toBe(false)
  expect(reopened.child(1).attrs.headerRowCount).toBe(0)
})


it.each([
  ['base64', 'AAEC+/=='],
  ['text', '资源中文 <tag> & "引号" \n第二行'],
  ['dataUrl', 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><text>图 &amp; 例</text></svg>'],
  ['text', ''],
  ['text', '特殊字符\r\n\t\u0000结束'],
])('retains %s figure resource payloads through repeated production HTML parsing', (encoding, data) => {
  let current: object = { type: 'doc', content: [{
    type: 'figureResource', attrs: { nodeId: 'resource-1', mediaType: 'image/svg+xml', name: '资源一', encoding, data },
  }] }
  for (let i = 0; i < 3; i++) {
    const { reopened, container } = htmlRoundtrip(current)
    expect(reopened.firstChild?.attrs).toMatchObject({ nodeId: 'resource-1', mediaType: 'image/svg+xml', name: '资源一', encoding, data })
    expect(container.querySelector('[data-type="figure-resource"]')?.getAttribute('data-resource-payload')).toBe(JSON.stringify(data))
    expect(reopened.textContent).toBe('')
    current = reopened.toJSON()
  }
})

it('reads an external resource without a payload as empty', () => {
  const container = document.createElement('div')
  container.innerHTML = '<div data-type="figure-resource" encoding="text">资源名称</div>'
  const reopened = DOMParser.fromSchema(schema).parse(container)
  reopened.check()
  expect(reopened.firstChild?.attrs.data).toBe('')
})


it('retains a figure resource association after clipboard HTML is loaded into the authoring model', () => {
  const data = 'data:image/png;base64,AAEC'
  const { reopened } = htmlRoundtrip({ type: 'doc', content: [
    { type: 'chapter', attrs: { nodeId: 'chapter-resource' }, content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
      { type: 'figure', attrs: { nodeId: 'figure-resource-owner' }, content: [
        { type: 'figureImage', attrs: { src: data, resourceId: 'resource-target' } },
        { type: 'figureCaption', content: [{ type: 'text', text: '资源图' }] },
      ] },
    ] },
    { type: 'figureResource', attrs: { nodeId: 'resource-target', encoding: 'dataUrl', data } },
  ] })
  const doc = pmToIr(reopened.toJSON() as PMJsonNode).doc
  expect(doc.resources).toContainEqual(expect.objectContaining({ id: 'resource-target', encoding: 'dataUrl', data }))
  expect(doc.body[0]?.children[0]).toMatchObject({ kind: 'figure', resourceId: 'resource-target' })
  expect(resolve(doc).problems.filter(problem => problem.code === 'dangling-resource')).toEqual([])
})
