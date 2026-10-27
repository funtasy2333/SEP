import { describe, expect, it } from 'vitest'
import { MATHML_NS, xmlAttr, xmlElement, qname } from '../../xml46687/tree'
import { EMPTY_OPTIONS, appendix, chapter, clause, codesOf, find, labelsOf, makeDoc, para, renderOk, run } from './xml46687Kit'
import { exportXml46687 } from '../xml46687'
import { assignMathIds, assignPendingIds, checkOutputTree } from '../xml46687Parts/ids'
import { createRenderSession } from '../xml46687Parts/dispatch'
import { el, getAttr, setAttr } from '../xml46687Parts/context'
import type { IRDoc } from '../../ir/types'

/**
 * id 的登记、后置赋值（P3）与收尾检查（P4）（WP8.2 设计 §3.2～§3.4）。
 * P4 的 error 用手写的输出树直接喂 `checkOutputTree`，也有一部分通过传入被改过的 labels 走整条管线。
 */

const mml = (local: string, attrs: Array<[string, string]> = [], children: Array<ReturnType<typeof xmlElement>> = []) =>
  xmlElement(qname(MATHML_NS, local, 'mml'), attrs.map(([name, value]) => xmlAttr(name, value)), children)

const sessionFor = (doc: IRDoc = makeDoc([chapter('ch1', '范围', [para('p1', '正文')], 'scope')]), options = EMPTY_OPTIONS) =>
  createRenderSession(doc, labelsOf(doc), options)

describe('“仅被引用时写 id”（P3①，设计 §3.2）', () => {
  it('[M-E-23] 被引用的元素补写 id（置于第一个属性）；没有被引用的不写；id 与实际写出的引用一一对应', () => {
    const doc = makeDoc([chapter('ch1', '范围', [
      { kind: 'note', id: 'n1', content: [para('n1.p0', '甲')] },
      { kind: 'note', id: 'n2', content: [para('n2.p0', '乙')] },
      para('p1', '见', run('注2', { type: 'crossRef', targetId: 'n2', targetKind: 'note' })),
    ], 'scope')])
    const { xml } = renderOk(doc)
    expect(xml.match(/non-normative-note id="/g)).toHaveLength(1)
    expect(xml).toContain('<non-normative-note id="note_2">')
    expect(xml).toContain('rid="note_2"')
  })

  it('同一目标被引用多次只补写一次；前向引用（引用在目标之前）与后向引用同样成立', () => {
    const doc = makeDoc([chapter('ch1', '范围', [
      para('p0', run('注1', { type: 'crossRef', targetId: 'n1', targetKind: 'note' })),
      { kind: 'note', id: 'n1', content: [para('n1.p0', '甲')] },
      para('p2', run('注1', { type: 'crossRef', targetId: 'n1', targetKind: 'note' })),
    ], 'scope')])
    const { xml } = renderOk(doc)
    expect(xml.match(/<non-normative-note id="note_1">/g)).toHaveLength(1)
    expect(xml.match(/rid="note_1"/g)).toHaveLength(2)
  })

  it('被纯文本容器丢弃的引用不会让目标白白带上 id（只有渲染器真正写出的引用才算）', () => {
    const session = sessionFor(makeDoc([chapter('ch1', '范围', [
      { kind: 'note', id: 'n1', content: [para('n1.p0', '甲')] },
      para('p1', run('注', { type: 'crossRef', targetId: 'n1', targetKind: 'note' })),
    ], 'scope')]))
    const { ctx, ids } = session
    ctx.renderInlines([run('注', { type: 'crossRef', targetId: 'n1', targetKind: 'note' })], { path: 'x' }, 'text')
    expect(ids.emitted.has('n1')).toBe(false)
    ctx.renderInlines([run('注', { type: 'crossRef', targetId: 'n1', targetKind: 'note' })], { path: 'x' }, 'p')
    expect(ids.emitted.has('n1')).toBe(true)
  })

  it('xml-label-missing：被引用而 labels 没有 xmlId 的待补元素，P3 报 error（路径取登记时的 IR 路径）', () => {
    const doc = makeDoc([chapter('ch1', '范围', [para('p1', '正文')], 'scope')])
    const session = sessionFor(doc)
    const element = el('non-normative-note')
    session.ctx.registerPendingId('ghost', element, { path: 'doc.body[0].children[3]', nodeId: 'ghost' })
    session.ctx.emitRef('ghost')
    assignPendingIds(session.ctx, session.ids)
    expect(getAttr(element, 'id')).toBeUndefined()
    expect(find(session.ctx.problems, 'xml-label-missing')).toHaveLength(1)
    expect(find(session.ctx.problems, 'xml-label-missing')[0]).toMatchObject({ severity: 'error', nodeId: 'ghost', path: 'doc.body[0].children[3]' })
  })

  it('setAttr 让 id 总是第一个属性，其余按固定次序（id、*-type、rid、…、xlink:href、specific-use）', () => {
    const element = el('xref', { 'ref-type': 'sec', rid: 'sec_1' })
    setAttr(element, 'id', 'x')
    expect(element.attrs.map(attr => attr.name.local)).toEqual(['id', 'ref-type', 'rid'])
    const link = el('ext-link', { 'xlink:href': 'https://a.test/', 'ext-link-type': 'uri' })
    expect(link.attrs.map(attr => attr.name.local)).toEqual(['ext-link-type', 'href'])
  })
})

describe('mml:math 的 id 后置赋值（P3②，设计 §3.3）', () => {
  it('按输出文档序给根上的 mml:math 编 mml_m<k>（从 1 起，行间与行内合并计数）；原有 id 被丢弃', () => {
    const block = mml('math', [['id', 'old'], ['display', 'block']])
    const inline = mml('math', [['id', 'mml_m99']])
    const third = mml('math')
    const root = el('standard', undefined, [el('sec', undefined, [el('disp-formula', undefined, [block]), el('p', undefined, [el('inline-formula', undefined, [inline])]), el('p', undefined, [el('inline-formula', undefined, [third])])])])
    expect(assignMathIds(root)).toBe(3)
    expect([block, inline, third].map(node => getAttr(node, 'id'))).toEqual(['mml_m1', 'mml_m2', 'mml_m3'])
    expect(getAttr(block, 'display')).toBe('block')
  })

  it('嵌套在另一个 mml:math 内的 math 不计数；没有公式时返回 0', () => {
    const inner = mml('math')
    const outer = mml('math', [], [mml('semantics', [], [inner])])
    expect(assignMathIds(el('standard', undefined, [el('p', undefined, [outer])]))).toBe(1)
    expect(getAttr(inner, 'id')).toBeUndefined()
    expect(assignMathIds(el('standard'))).toBe(0)
  })
})

describe('P4 收尾检查（设计 §3.4）', () => {
  const check = (root: ReturnType<typeof el>, options = EMPTY_OPTIONS, doc?: IRDoc) => {
    const session = sessionFor(doc, options)
    checkOutputTree(session.ctx, root)
    return session.ctx.problems
  }

  it('合法且唯一的 id、可解析的 rid 与 target：没有问题', () => {
    const root = el('standard', undefined, [
      el('sec', { id: 'sec_1' }, [el('p', undefined, [el('xref', { 'ref-type': 'sec', rid: 'sec_1' }, ['1']), el('tbx:entailedTerm', { target: 'sec_1' })])]),
    ])
    expect(check(root)).toEqual([])
  })

  it('xml-id-invalid：id 不是合法的 NCName', () => {
    for (const bad of ['1abc', 'a b', 'a:b', '']) {
      const problems = check(el('standard', undefined, [el('sec', { id: bad === '' ? undefined : bad })]))
      if (bad === '') expect(problems).toEqual([])
      else expect(codesOf(problems, 'error'), bad).toContain('xml-id-invalid')
    }
  })

  it('xml-id-duplicate：全树 id 唯一，报告两个持有者（元素名与位置）', () => {
    const problems = check(el('standard', undefined, [el('sec', { id: 'dup' }), el('app', { id: 'dup' })]))
    expect(find(problems, 'xml-id-duplicate')).toHaveLength(1)
    expect(find(problems, 'xml-id-duplicate')[0]!.message).toContain('<sec>')
    expect(find(problems, 'xml-id-duplicate')[0]!.message).toContain('<app>')
    expect(find(problems, 'xml-id-duplicate')[0]).toMatchObject({ severity: 'error', path: 'xml:/standard[1]/app[1]' })
  })

  it('xml-rid-unresolved：rid 与 tbx:entailedTerm 的 target 在输出树里找不到对应的 id', () => {
    const problems = check(el('standard', undefined, [
      el('sec', { id: 'sec_1' }),
      el('p', undefined, [el('xref', { 'ref-type': 'sec', rid: 'sec_9' }, ['9']), el('tbx:entailedTerm', { target: 'term_9' }, ['术语'])]),
    ]))
    expect(find(problems, 'xml-rid-unresolved')).toHaveLength(2)
    expect(find(problems, 'xml-rid-unresolved')[0]!.message).toContain('sec_9')
    expect(find(problems, 'xml-rid-unresolved')[1]!.message).toContain('term_9')
  })

  it('xml-ext-id-leak：以 ext_ 开头（及 Formula…、id-<uuid>、p-<n>）的 id / rid / target 不得进入 XML', () => {
    const leaked = ['ext_61', 'Formula1', 'id-1a2b3c4d-5e6f', 'p-125']
    for (const value of leaked) {
      const asId = check(el('standard', undefined, [el('sec', { id: value })]))
      expect(codesOf(asId, 'error'), `id ${value}`).toContain('xml-ext-id-leak')
      const asRid = check(el('standard', undefined, [el('sec', { id: 'sec_1' }), el('xref', { 'ref-type': 'sec', rid: value }, ['x'])]))
      expect(codesOf(asRid, 'error'), `rid ${value}`).toContain('xml-ext-id-leak')
    }
  })

  it('经整条管线：labels 里的 xmlId 重复、非法、带 ext_ 前缀时导出失败（xml-null）', () => {
    const doc = makeDoc([chapter('ch1', '范围', [para('p1', '正文')], 'scope'), chapter('ch2', '技术要求', [para('p2', '正文')])])
    const labels = labelsOf(doc)
    const withLabel = (id: string, xmlId: string) => ({ ...labels, [id]: { ...labels[id]!, xmlId } })
    const duplicate = exportXml46687(doc, withLabel('ch2', labels['ch1']!.xmlId), EMPTY_OPTIONS)
    expect(duplicate.xml).toBeNull()
    expect(find(duplicate.problems, 'xml-id-duplicate')).toHaveLength(1)
    expect(codesOf(exportXml46687(doc, withLabel('ch2', 'ext_61_62'), EMPTY_OPTIONS).problems, 'error')).toContain('xml-ext-id-leak')
    expect(codesOf(exportXml46687(doc, withLabel('ch2', '1 bad id'), EMPTY_OPTIONS).problems, 'error')).toContain('xml-id-invalid')
  })
})

describe('P4 资源清单核对（设计 §3.4、§4.3）', () => {
  const figureDoc = (): IRDoc => makeDoc([chapter('ch1', '范围', [{ kind: 'figure', id: 'fig-1', caption: [{ text: '图题' }], orientation: 'portrait', src: 'res-1', notes: [] }], 'scope')])
  const graphic = (href: string) => el('standard', undefined, [el('graphic', { 'xlink:href': href, 'content-type': 'image' })])
  const manifest = (...entries: Array<{ href: string; key: string }>) => ({
    ...EMPTY_OPTIONS,
    resources: { version: 1 as const, entries: entries.map(entry => ({ ...entry, fileName: `${entry.href}.png`, mediaType: 'image/png', source: 'resource' as const })) },
  })
  const check = (doc: IRDoc, root: ReturnType<typeof el>, options: typeof EMPTY_OPTIONS) => {
    const session = sessionFor(doc, options)
    checkOutputTree(session.ctx, root)
    return session.ctx.problems
  }

  it('清单有对应条目且资源键一致：没有问题', () => {
    expect(check(figureDoc(), graphic('fig_1'), manifest({ href: 'fig_1', key: 'res-1' }))).toEqual([])
  })

  it('resource-missing：IR 里的图片引用在清单里没有条目；路径与节点取 IR 里的图', () => {
    const problems = check(figureDoc(), graphic('fig_1'), EMPTY_OPTIONS)
    expect(find(problems, 'resource-missing')).toHaveLength(1)
    expect(find(problems, 'resource-missing')[0]).toMatchObject({ severity: 'error', nodeId: 'fig-1', path: 'doc.body[0].children[0]' })
  })

  it('resource-mismatch：清单条目的资源键与 IR 的资源键不符', () => {
    const problems = check(figureDoc(), graphic('fig_1'), manifest({ href: 'fig_1', key: 'other' }))
    expect(find(problems, 'resource-mismatch')).toHaveLength(1)
    expect(find(problems, 'resource-mismatch')[0]).toMatchObject({ severity: 'error', nodeId: 'fig-1' })
  })

  it('树里出现 IR 之外的 href 且清单没有条目：补报 resource-missing（XML 路径）', () => {
    const problems = check(figureDoc(), graphic('inl_9'), manifest({ href: 'fig_1', key: 'res-1' }))
    expect(find(problems, 'resource-missing').map(problem => problem.path)).toEqual(['xml:/standard[1]/graphic[1]'])
  })

  it('resource-unused（info）：清单里没被文档使用的条目', () => {
    const problems = check(figureDoc(), graphic('fig_1'), manifest({ href: 'fig_1', key: 'res-1' }, { href: 'fig_7', key: 'extra' }))
    expect(find(problems, 'resource-unused')).toHaveLength(1)
    expect(find(problems, 'resource-unused')[0]).toMatchObject({ severity: 'info' })
    expect(find(problems, 'resource-unused')[0]!.message).toContain('fig_7')
  })
})

describe('整条管线的 id 方案', () => {
  it('[M-E-01] [M-E-04] 章/条/附录的 id 取 Resolver 的 xmlId；前言/引言/参考文献的常量 id 与之不冲突', () => {
    const doc = makeDoc([chapter('ch1', '范围', [clause('c1', 1, '条', [para('p1', '正文')])], 'scope')], {
      front: { foreword: [para('fw', '前言')], introduction: [para('in', '引言')] },
      appendices: [appendix('app-a', false, '附录', [para('a-p', '正文')])],
    })
    const { xml } = renderOk(doc)
    const ids = [...xml.matchAll(/ id="([^"]+)"/g)].map(match => match[1])
    expect(ids).toEqual(['sec_foreword', 'sec_intro', 'sec_1', 'sec_1.1', 'sec_A'])
    expect(new Set(ids).size).toBe(ids.length)
  })
})
