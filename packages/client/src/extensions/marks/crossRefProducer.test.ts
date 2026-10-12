// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { irToPm, pmToIr, type IRDoc, type PMJsonNode } from '@ses/shared'
import { expect, it } from 'vitest'
import { createEditorExtensions } from '../editorExtensions'

function sourceDocument(): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{
      kind: 'chapter',
      id: 'chapter',
      secType: 'general',
      title: [{ text: '正文' }],
      children: [{
        kind: 'paragraph',
        id: 'reference',
        content: [{ text: '引用', marks: [{ type: 'crossRef', targetId: 'initial-target', targetKind: 'chapter' }] }],
      }],
    }],
    appendices: [],
    bibliography: [],
  }
}

function findTextNode(node: PMJsonNode, text: string): PMJsonNode | undefined {
  if (node.type === 'text' && node.text === text) return node
  for (const child of node.content ?? []) {
    const found = findTextNode(child, text)
    if (found) return found
  }
  return undefined
}

function editorWithReference(attrs: Record<string, unknown>): Editor {
  const content = irToPm(sourceDocument()) as PMJsonNode
  const textNode = findTextNode(content, '引用')
  const mark = textNode?.marks?.find(item => item.type === 'crossRef')
  if (!mark) throw new Error('测试文档没有 crossRef mark')
  mark.attrs = { ...(mark.attrs ?? {}), ...attrs }
  return new Editor({ extensions: createEditorExtensions(), content })
}

function referenceMark(node: PMJsonNode, text: string) {
  return findTextNode(node, text)?.marks?.find(mark => mark.type === 'crossRef')
}

function inlineWithText(value: unknown, text: string): { text: string; marks?: Array<Record<string, unknown>> } | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = inlineWithText(item, text)
      if (found) return found
    }
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (record.text === text && Array.isArray(record.marks)) {
    return record as { text: string; marks: Array<Record<string, unknown>> }
  }
  for (const child of Object.values(record)) {
    const found = inlineWithText(child, text)
    if (found) return found
  }
  return undefined
}

function textRange(editor: Editor, text: string): { from: number; to: number } {
  let range: { from: number; to: number } | undefined
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) range = { from: pos, to: pos + node.nodeSize }
  })
  if (!range) throw new Error('测试文档没有文字：' + text)
  return range
}

it('gives canonical targetId priority over refId and does not fall back from an empty targetId', () => {
  const canonical = editorWithReference({ targetId: 'canonical-target', refId: 'legacy-target', refType: 'chapter' })
  const empty = editorWithReference({ targetId: '', refId: 'legacy-target', refType: 'chapter' })
  try {
    const canonicalBefore = JSON.stringify(canonical.getJSON())
    const canonicalSource = canonical.getJSON() as PMJsonNode
    const canonicalRun = inlineWithText(pmToIr(canonicalSource).doc, '引用')
    expect(canonicalRun?.marks).toContainEqual(expect.objectContaining({
      type: 'crossRef',
      targetId: 'canonical-target',
      targetKind: 'chapter',
    }))
    const canonicalHtml = document.createElement('div')
    canonicalHtml.innerHTML = canonical.getHTML()
    expect(canonicalHtml.querySelector('[data-type="cross-ref"]')?.getAttribute('href')).toBe('#canonical-target')
    expect(JSON.stringify(canonical.getJSON())).toBe(canonicalBefore)

    const emptyBefore = JSON.stringify(empty.getJSON())
    const emptySource = empty.getJSON() as PMJsonNode
    const emptyHtml = document.createElement('div')
    emptyHtml.innerHTML = empty.getHTML()
    expect(emptyHtml.querySelector('[data-type="cross-ref"]')?.getAttribute('href')).toBeNull()
    expect(inlineWithText(pmToIr(emptySource).doc, '引用')?.marks ?? [])
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'crossRef' })]))
    expect(JSON.stringify(empty.getJSON())).toBe(emptyBefore)
  } finally {
    canonical.destroy()
    empty.destroy()
  }
})

it('updates a canonical mark on a selected range and keeps the new target after reload and pmToIr', () => {
  const editor = editorWithReference({ targetId: 'old-target', refId: 'stale-legacy-target', refType: 'chapter' })
  try {
    const { from, to } = textRange(editor, '引用')
    expect(editor.commands.setTextSelection({ from, to })).toBe(true)
    expect(editor.commands.setCrossRef({ targetId: 'new-target', refType: 'chapter' })).toBe(true)

    const saved = editor.getJSON() as PMJsonNode
    expect(referenceMark(saved, '引用')?.attrs).toMatchObject({ targetId: 'new-target', refId: null })

    const reloaded = new Editor({
      extensions: createEditorExtensions(),
      content: JSON.parse(JSON.stringify(saved)) as PMJsonNode,
    })
    try {
      reloaded.state.doc.check()
      const reopened = reloaded.getJSON() as PMJsonNode
      expect(referenceMark(reopened, '引用')?.attrs).toMatchObject({ targetId: 'new-target', refId: null })
      expect(inlineWithText(pmToIr(reopened).doc, '引用')?.marks).toContainEqual(expect.objectContaining({
        type: 'crossRef',
        targetId: 'new-target',
        targetKind: 'chapter',
      }))
    } finally {
      reloaded.destroy()
    }
  } finally {
    editor.destroy()
  }
})

it('keeps an empty canonical target over a conflicting legacy refId in selected and stored marks', () => {
  const selected = editorWithReference({ targetId: 'old-target', refId: 'old-legacy-target', refType: 'chapter' })
  const cursor = editorWithReference({ targetId: 'old-target', refId: 'old-legacy-target', refType: 'chapter' })
  try {
    const { from, to } = textRange(selected, '引用')
    expect(selected.commands.setTextSelection({ from, to })).toBe(true)
    expect(selected.commands.setCrossRef({
      targetId: '',
      refId: 'legacy-target',
      refType: 'chapter',
    })).toBe(true)

    const selectedSource = selected.getJSON() as PMJsonNode
    expect(referenceMark(selectedSource, '引用')?.attrs).toMatchObject({ targetId: '', refId: null })
    const selectedHtml = document.createElement('div')
    selectedHtml.innerHTML = selected.getHTML()
    expect(selectedHtml.querySelector('[data-type="cross-ref"]')?.getAttribute('href')).toBeNull()
    expect(inlineWithText(pmToIr(selectedSource).doc, '引用')?.marks ?? [])
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'crossRef' })]))

    const cursorPosition = textRange(cursor, '引用').from + 1
    expect(cursor.commands.setTextSelection(cursorPosition)).toBe(true)
    expect(cursor.commands.setCrossRef({
      targetId: '',
      refId: 'legacy-target',
      refType: 'chapter',
    })).toBe(true)
    expect(cursor.state.storedMarks?.find(mark => mark.type.name === 'crossRef')?.attrs)
      .toMatchObject({ targetId: '', refId: null })

    expect(cursor.commands.insertContent('新')).toBe(true)
    const cursorSource = cursor.getJSON() as PMJsonNode
    expect(referenceMark(cursorSource, '新')?.attrs).toMatchObject({ targetId: '', refId: null })
    expect(inlineWithText(pmToIr(cursorSource).doc, '新')?.marks ?? [])
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'crossRef' })]))
  } finally {
    selected.destroy()
    cursor.destroy()
  }
})

it('keeps legacy refId calls working through the cursor stored-mark path', () => {
  const editor = editorWithReference({ targetId: 'old-canonical-target', refId: null, refType: 'chapter' })
  try {
    const { from } = textRange(editor, '引用')
    expect(editor.commands.setTextSelection(from + 1)).toBe(true)
    expect(editor.commands.setCrossRef({ refId: 'legacy-updated-target', refType: 'chapter' })).toBe(true)
    expect(editor.state.storedMarks?.find(mark => mark.type.name === 'crossRef')?.attrs)
      .toMatchObject({ targetId: null, refId: 'legacy-updated-target' })

    expect(editor.commands.insertContent('新')).toBe(true)
    const saved = editor.getJSON() as PMJsonNode
    expect(referenceMark(saved, '新')?.attrs).toMatchObject({
      targetId: null,
      refId: 'legacy-updated-target',
      refType: 'chapter',
    })
    expect(inlineWithText(pmToIr(saved).doc, '新')?.marks).toContainEqual(expect.objectContaining({
      type: 'crossRef',
      targetId: 'legacy-updated-target',
      targetKind: 'chapter',
    }))
  } finally {
    editor.destroy()
  }
})
