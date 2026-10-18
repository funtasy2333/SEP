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
})
