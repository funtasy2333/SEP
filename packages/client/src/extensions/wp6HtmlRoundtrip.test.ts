// @vitest-environment happy-dom
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
  const reopened = DOMParser.fromSchema(schema).parse(container)
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
