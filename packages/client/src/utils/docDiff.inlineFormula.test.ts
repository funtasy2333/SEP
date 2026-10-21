import { describe, expect, it } from 'vitest'
import { docToText } from './docDiff'

describe('版本对比：行内公式', () => {
  it('段落文字中的行内公式输出为 $latex$，公式改动可见', () => {
    const doc = (latex: string) => ({ type: 'doc', content: [{ type: 'chapter', content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: '要求' }] },
      { type: 'stdParagraph', content: [{ type: 'text', text: '当' }, { type: 'formulaInline', attrs: { latex } }, { type: 'text', text: '大于 1 时' }] },
    ] }] })
    expect(docToText(doc('q_{V}'))).toContain('当$q_{V}$大于 1 时')
    expect(docToText(doc('q_{V}'))).not.toBe(docToText(doc('q_{m}')))
  })

  it('公式的式中、自由文本式中与公式注都进入对比文本，只改这些内容时也能看出差异', () => {
    const t = (text: string) => ({ type: 'text', text })
    const doc = (term: string, definition: string, description = '', note = '') => ({ type: 'doc', content: [{ type: 'chapter', content: [
      { type: 'chapterTitle', content: [t('计算')] },
      { type: 'formula', content: [
        { type: 'formulaContent', content: [t('q_{V}=Av')] },
        ...(description ? [{ type: 'formulaDescription', content: [t(description)] }] : []),
        ...(note ? [{ type: 'formulaNote', content: [t(note)] }] : []),
        { type: 'whereList', content: [{ type: 'whereItem', content: [
          { type: 'whereTerm', content: [{ type: 'formulaInline', attrs: { latex: term } }] },
          { type: 'whereDefinition', content: [t(definition)] },
        ] }] },
      ] },
    ] }] })
    const base = docToText(doc('q_{V}', '体积流量'))
    expect(base).toContain('$q_{V}$——体积流量')
    expect(docToText(doc('q_{m}', '体积流量'))).not.toBe(base)
    expect(docToText(doc('q_{V}', '质量流量'))).not.toBe(base)
    expect(docToText(doc('q_{V}', '体积流量', '式中：A——面积。'))).not.toBe(base)
    expect(docToText(doc('q_{V}', '体积流量', '', '适用于常温。'))).not.toBe(base)
  })
})
