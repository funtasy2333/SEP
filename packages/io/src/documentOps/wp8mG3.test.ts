import { describe, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '@ses/shared'
import { applyDocumentOperations } from './apply'
import { readNode } from './readNode'
import { chapter, clone, deepFreeze, doc, figure, node, para, seqIds, text } from './testFixtures'

/**
 * WP8.M G3：图例 legend（M-8.5-01～06）、图注 notes（M-8.2-11）、图中示例 examples（M-8.4-03）、行内图 image（M-8.3-02）
 * 在 documentOps 里的表现：IR 能读出这些结构，但写作片段本阶段不放开写作入口，所以含它们的节点不能被静默整体替换，
 * 否则整体替换会悄悄丢掉图例 / 图注 / 示例 / 行内图。删除与移动不受影响。
 */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const legend = node('figureLegend', { nodeId: 'lg-1' }, [
  node('figureLegendTitle', undefined, [text('图例')]),
  node('whereItem', { nodeId: 'lg-1-i1' }, [node('whereTerm', undefined, [text('1')]), node('whereDefinition', undefined, [text('主电路')])]),
])

function documentWithFigures(): PMJsonNode {
  return doc(chapter('ch-1', '图的说明',
    para('p-1', text('引语。')),
    para('p-img', text('图标'), node('inlineImage', { src: PNG, resourceId: null, alt: '图标', size: 'S' }), text('。')),
    figure('fig-plain', '普通图'),
    figure('fig-legend', '带图例的图', {}, [legend]),
    figure('fig-note', '带图注的图', {}, [node('note', { nodeId: 'fig-note-n1' }, [text('图注。')])]),
    figure('fig-example', '带示例的图', {}, [node('example', { nodeId: 'fig-example-e1' }, [text('图中示例。')])]),
    para('p-tail', text('结语。')),
  ))
}

const source = deepFreeze(documentWithFigures())

describe('[M-8.5-01] documentOps：含图例的图不能被写作片段静默整体替换', () => {
  it('readNode：IR 带 legend（项复用 IRDefItem）；该图标为不可整体替换，原因指向“图例”；普通图不受影响', () => {
    const result = readNode(source, 'fig-legend')
    if (!result.ok) throw new Error(result.reason)
    expect(result.node.ir).toMatchObject({ kind: 'figure', legend: { id: 'lg-1', title: [{ text: '图例' }], items: [{ id: 'lg-1-i1' }] } })
    expect(result.node.replaceable).toBe(false)
    expect(result.node.notReplaceable).toEqual([expect.objectContaining({
      code: 'unsupported-field', path: 'ir.legend', message: expect.stringContaining('图例'),
    })])
    const plain = readNode(source, 'fig-plain')
    if (!plain.ok) throw new Error(plain.reason)
    expect(plain.node.replaceable).toBe(true)
  })

  it('replace 默认被拒绝（replace-loses-content），文档不变；acceptLoss 才执行并留下警告，图例随之丢失', () => {
    const operations = [{ op: 'replace', nodeId: 'fig-legend', content: [{ kind: 'figure', caption: '新图', src: PNG }] }]
    const refused = applyDocumentOperations(clone(source), operations, { generateId: seqIds() })
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.issues).toEqual([expect.objectContaining({ code: 'replace-loses-content', nodeId: 'fig-legend' })])
      expect(refused.issues[0]!.reason).toContain('legend')
    }
    const accepted = applyDocumentOperations(clone(source), [{ ...operations[0]!, acceptLoss: true }], { generateId: seqIds() })
    expect(accepted.ok).toBe(true)
    if (accepted.ok) {
      expect(accepted.warnings.map(item => item.code)).toEqual(['replace-loses-content'])
      expect(JSON.stringify(accepted.doc)).not.toContain('figureLegend')
    }
  })

  it('删除含图例的图不受限制（整体删除不丢失“未被告知”的内容）', () => {
    const result = applyDocumentOperations(clone(source), [{ op: 'delete', nodeId: 'fig-legend' }], { generateId: seqIds() })
    expect(result.ok).toBe(true)
    if (result.ok) expect(JSON.stringify(result.doc)).not.toContain('figureLegend')
  })

  it('不触及图例的其它操作保持图例：替换同章的普通图后，带图例的图原样保留', () => {
    const result = applyDocumentOperations(clone(source), [{ op: 'replace', nodeId: 'fig-plain', content: [{ kind: 'figure', caption: '改写', src: PNG }] }], { generateId: seqIds() })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const figures = pmToIr(result.doc).doc.body[0]!.children.filter(child => child.kind === 'figure')
      expect(figures.map(figure => figure.kind === 'figure' ? [figure.id, figure.legend?.id ?? null] : null)).toContainEqual(['fig-legend', 'lg-1'])
    }
  })
})

describe('[M-8.2-11][M-8.4-03] documentOps：含图注 / 图中示例的图同样不可整体替换', () => {
  it('readNode：图注、图中示例读进 IR（notes / examples），整体替换会丢失，标为不可替换', () => {
    const noted = readNode(source, 'fig-note')
    if (!noted.ok) throw new Error(noted.reason)
    expect(noted.node.ir).toMatchObject({ kind: 'figure', notes: [{ kind: 'note', id: 'fig-note-n1' }] })
    expect(noted.node.replaceable).toBe(false)
    expect(noted.node.notReplaceable?.some(reason => reason.path === 'ir.notes')).toBe(true)

    const exampled = readNode(source, 'fig-example')
    if (!exampled.ok) throw new Error(exampled.reason)
    expect(exampled.node.ir).toMatchObject({ kind: 'figure', examples: [{ kind: 'example', id: 'fig-example-e1' }] })
    expect(exampled.node.replaceable).toBe(false)
    expect(exampled.node.notReplaceable).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'ir.examples', message: expect.stringContaining('图中示例') })]))
  })

  it('图内的注 / 示例不是可单独寻址的块（它们是图的一部分）：按 id 读不到', () => {
    for (const id of ['fig-note-n1', 'fig-example-e1', 'lg-1', 'lg-1-i1']) {
      expect(readNode(source, id).ok, id).toBe(false)
    }
  })

  it('图内的注不占用章内的块位置：章的子节点序列与位置不受图注影响', () => {
    const result = readNode(source, 'p-tail')
    if (!result.ok) throw new Error(result.reason)
    expect(result.node).toMatchObject({ index: 6, siblingCount: 7 })
  })
})

describe('[M-8.3-02] documentOps：含行内图的段落不能被写作片段静默整体替换', () => {
  it('readNode：IR 的 run 带 image；该段落标为不可整体替换，原因指向“行内图”', () => {
    const result = readNode(source, 'p-img')
    if (!result.ok) throw new Error(result.reason)
    expect(result.node.ir).toMatchObject({ kind: 'paragraph', content: [{ text: '图标' }, { text: '', image: { src: PNG, alt: '图标', size: 'S' } }, { text: '。' }] })
    expect(result.node.replaceable).toBe(false)
    expect(result.node.notReplaceable).toEqual([expect.objectContaining({
      code: 'unsupported-field', message: expect.stringContaining('行内图'),
    })])
    const plain = readNode(source, 'p-1')
    if (!plain.ok) throw new Error(plain.reason)
    expect(plain.node.replaceable).toBe(true)
  })

  it('replace 默认被拒绝，文档不变；acceptLoss 才执行并留下警告，行内图随之丢失', () => {
    const operations = [{ op: 'replace', nodeId: 'p-img', content: [{ kind: 'paragraph', content: '新的段落。' }] }]
    const refused = applyDocumentOperations(clone(source), operations, { generateId: seqIds() })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.issues).toEqual([expect.objectContaining({ code: 'replace-loses-content', nodeId: 'p-img' })])
    const accepted = applyDocumentOperations(clone(source), [{ ...operations[0]!, acceptLoss: true }], { generateId: seqIds() })
    expect(accepted.ok).toBe(true)
    if (accepted.ok) expect(JSON.stringify(accepted.doc)).not.toContain('inlineImage')
  })

  it('写入的片段不能携带行内图（写作入口本阶段不放开）：unsupported-field，文档不变', () => {
    const result = applyDocumentOperations(clone(source), [{ op: 'insert', parent: 'ch-1', position: 'end', content: [{ kind: 'paragraph', content: [{ text: '', image: { src: PNG } }] }] }], { generateId: seqIds() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some(issue => issue.code === 'unsupported-field' && issue.path.endsWith('.image'))).toBe(true)
  })
})
