// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../editorExtensions'
import { chapter, paragraph, text } from '@/validation/__fixtures__/phase6'
import {
  SEARCH_CURRENT_CLASS, SEARCH_MATCH_CLASS, SearchHighlight, clearSearch, findTextMatches, getSearchState, stepSearch,
} from './searchHighlight'

const editors: Editor[] = []
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()) })

function createEditor(content: unknown) {
  const editor = new Editor({ extensions: [...createEditorExtensions(), SearchHighlight], content: content as any })
  editors.push(editor)
  // StarterKit 的 trailingNode 会在第一笔事务时补一个末尾段落；应用里载入正文时已发生，这里先预热，避免误判为查找改了正文。
  editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
  return editor
}

const riskDoc = () => ({
  type: 'doc', content: [
    chapter('c1', '范围', 'scope',
      paragraph('p1', text('执业过程中面临多种风险因素，亟需建立')),
      paragraph('p2', text('应识别'), text('风', [{ type: 'bold' }]), text('险并评估。')),
      paragraph('p3', text('风险控制措施。'))),
  ],
})

describe('findTextMatches', () => {
  it('finds every occurrence in document order, including matches split across marks', () => {
    const editor = createEditor(riskDoc())
    const matches = findTextMatches(editor.state.doc, '风险')
    expect(matches).toHaveLength(3)
    expect(matches.map((match) => editor.state.doc.textBetween(match.from, match.to))).toEqual(['风险', '风险', '风险'])
    expect(matches[0].from).toBeLessThan(matches[1].from)
    expect(matches[1].from).toBeLessThan(matches[2].from)
  })

  it('returns nothing for an empty query or no match, and does not match across paragraphs', () => {
    const editor = createEditor(riskDoc())
    expect(findTextMatches(editor.state.doc, '')).toEqual([])
    expect(findTextMatches(editor.state.doc, '不存在')).toEqual([])
    expect(findTextMatches(editor.state.doc, '建立应识别')).toEqual([])
  })
})

describe('stepSearch (#76)', () => {
  it('steps forward through matches with wrap-around and never changes the document or selection', () => {
    const editor = createEditor(riskDoc())
    const before = JSON.stringify(editor.getJSON())
    const selection = editor.state.selection.toJSON()

    const first = stepSearch(editor.view, '风险')
    expect(first.state.current).toBe(0)
    expect(first.wrapped).toBe(false)
    expect(stepSearch(editor.view, '风险').state.current).toBe(1)
    expect(stepSearch(editor.view, '风险').state.current).toBe(2)
    const wrapped = stepSearch(editor.view, '风险')
    expect(wrapped.state.current).toBe(0)
    expect(wrapped.wrapped).toBe(true)

    expect(JSON.stringify(editor.getJSON())).toBe(before)
    expect(editor.state.selection.toJSON()).toEqual(selection)
    expect(editor.can().undo()).toBe(false)
  })

  it('steps backward with direction -1 and starts from the last match for a new query', () => {
    const editor = createEditor(riskDoc())
    expect(stepSearch(editor.view, '风险', -1).state.current).toBe(2)
    expect(stepSearch(editor.view, '风险', -1).state.current).toBe(1)
  })

  it('handles a single match and no match', () => {
    const editor = createEditor(riskDoc())
    const single = stepSearch(editor.view, '控制措施')
    expect(single.state.matches).toHaveLength(1)
    expect(single.state.current).toBe(0)
    const again = stepSearch(editor.view, '控制措施')
    expect(again.state.current).toBe(0)
    expect(again.wrapped).toBe(true)

    const none = stepSearch(editor.view, '不存在')
    expect(none.state.matches).toHaveLength(0)
    expect(none.state.current).toBe(-1)
  })

  it('renders highlight decorations with exactly one current match and clears them', () => {
    const editor = createEditor(riskDoc())
    stepSearch(editor.view, '风险')
    stepSearch(editor.view, '风险')
    expect(editor.view.dom.querySelectorAll(`.${SEARCH_CURRENT_CLASS}`).length).toBeGreaterThan(0)
    const current = [...editor.view.dom.querySelectorAll(`.${SEARCH_CURRENT_CLASS}`)].map((element) => element.textContent).join('')
    expect(current).toBe('风险')
    expect(editor.view.dom.querySelectorAll(`.${SEARCH_MATCH_CLASS}`).length).toBeGreaterThanOrEqual(3)

    clearSearch(editor.view)
    expect(getSearchState(editor.state).query).toBe('')
    expect(editor.view.dom.querySelectorAll(`.${SEARCH_MATCH_CLASS}`)).toHaveLength(0)
  })

  it('recomputes matches after the document is edited and stays near the current match', () => {
    const editor = createEditor(riskDoc())
    stepSearch(editor.view, '风险')
    stepSearch(editor.view, '风险') // current = 1 (second paragraph)
    const firstMatch = getSearchState(editor.state).matches[0]
    editor.view.dispatch(editor.state.tr.insertText('风险', firstMatch.from))
    const state = getSearchState(editor.state)
    expect(state.matches).toHaveLength(4)
    expect(editor.state.doc.textBetween(state.matches[state.current].from, state.matches[state.current].to)).toBe('风险')
    expect(state.current).toBe(2)
  })
})
