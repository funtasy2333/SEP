import { describe, expect, it } from 'vitest'
import { readContainer, readNode } from './readNode'
import {
  chapter, clause, clone, deepFreeze, doc, node, para, richDocument, text, termDef,
} from './testFixtures'
import type { ReadNodeInfo } from './types'

const pm = deepFreeze(richDocument())

function read(nodeId: string, source = pm): ReadNodeInfo {
  const result = readNode(source, nodeId)
  if (!result.ok) throw new Error(`${result.code}: ${result.reason}`)
  return result.node
}

describe('readNode：位置、编号与替换上下文', () => {
  it('返回 IR、编号、父节点、位置与替换上下文', () => {
    const info = read('cl-422')
    expect(info).toMatchObject({
      nodeId: 'cl-422', kind: 'clause', number: '4.2.2',
      parent: { nodeId: 'cl-42', kind: 'clause' }, index: 1, siblingCount: 2,
      context: { parent: 'clause', level: 1 },
    })
    expect(info.ir).toMatchObject({ kind: 'clause', id: 'cl-422', level: 2, titled: true })
  })

  it.each([
    ['fw-p1', { container: 'foreword' }, { parent: 'foreword' }, 0],
    ['fw-note', { container: 'foreword' }, { parent: 'foreword' }, 1],
    ['intro-p1', { container: 'introduction' }, { parent: 'introduction' }, 0],
    ['ch-terms', { container: 'body' }, { parent: 'body' }, 2],
    ['term-2', { nodeId: 'ch-terms', kind: 'chapter' }, { parent: 'chapter' }, 2],
    ['cl-41', { nodeId: 'ch-4', kind: 'chapter' }, { parent: 'chapter' }, 0],
    ['list-1', { nodeId: 'cl-41', kind: 'clause' }, { parent: 'clause', level: 1 }, 1],
    ['p-4211', { nodeId: 'cl-421', kind: 'clause' }, { parent: 'clause', level: 2 }, 0],
    ['tbl-1', { nodeId: 'cl-422', kind: 'clause' }, { parent: 'clause', level: 2 }, 0],
    ['app-b', { container: 'appendices' }, { parent: 'appendices' }, 1],
    ['cl-a2', { nodeId: 'app-a', kind: 'appendix' }, { parent: 'appendix' }, 1],
    ['fig-a1', { nodeId: 'cl-a2', kind: 'clause' }, { parent: 'clause', level: 1 }, 0],
    ['bib-3', { container: 'bibliography' }, { parent: 'bibliography' }, 2],
  ])('%s：父节点、上下文与位置', (nodeId, parent, context, index) => {
    const info = read(nodeId)
    expect(info.parent).toEqual(parent)
    expect(info.context).toEqual(context)
    expect(info.index).toBe(index)
  })

  it('编号来自 Resolver：章、条、术语、表、图、公式、附录内重新编号、注、参考文献', () => {
    const numbers = Object.fromEntries(
      ['ch-4', 'cl-421', 'term-3', 'tbl-1', 'fig-1', 'f-1', 'tbl-a1', 'f-a1', 'app-a', 'n-41b', 'p-411'].map(id => [id, read(id).number]),
    )
    expect(numbers).toEqual({
      'ch-4': '4', 'cl-421': '4.2.1', 'term-3': '3.3', 'tbl-1': '表1', 'fig-1': '图1', 'f-1': '(1)',
      'tbl-a1': '表A.1', 'f-a1': '(A.1)', 'app-a': '附录A', 'n-41b': '注2：', 'p-411': undefined,
    })
  })

  it('返回的 IR 与结果一样可 JSON 往返，且不修改入参', () => {
    const info = read('tbl-1')
    expect(JSON.parse(JSON.stringify(info))).toEqual(info)
  })

  it('层级超过 5 的条下没有可用的替换上下文', () => {
    let deepest = para('p-deep', text('深层段落'))
    for (let level = 6; level >= 1; level -= 1) deepest = clause(`c${level}`, level, `第${level}级`, deepest)
    const deep = doc(chapter('ch', '范围', deepest))
    expect(read('c6', deep).context).toEqual({ parent: 'clause', level: 5 })
    const inner = read('p-deep', deep)
    expect(inner.context).toBeUndefined()
    expect(inner.replaceable).toBe(false)
    expect(inner.notReplaceable?.[0]).toMatchObject({ code: 'no-context' })
  })
})

describe('readNode：不可整体替换的节点', () => {
  const reasonsOf = (nodeId: string) => read(nodeId).notReplaceable ?? []

  it('普通节点可以替换', () => {
    for (const id of ['fw-p1', 'p-411', 'list-1', 'n-41a', 'tbl-1', 'fig-1', 'f-1', 'term-1', 'cl-41', 'cl-421', 'app-b', 'bib-1', 'ch-refs']) {
      const info = read(id)
      expect(info.replaceable, `${id}：${JSON.stringify(info.notReplaceable)}`).toBe(true)
      expect(info.notReplaceable).toBeUndefined()
    }
  })

  it('表格列宽：指出字段、位置与数量', () => {
    const info = read('tbl-styled')
    expect(info.replaceable).toBe(false)
    expect(reasonsOf('tbl-styled')).toEqual([{
      code: 'unsupported-field',
      message: '单元格含有写作片段不支持的内容：「columnWidths」（列宽），整体替换会丢失它（共 2 处）',
      path: 'ir.rows[0].cells[0].columnWidths',
      count: 2,
    }])
  })

  it('图的资源引用与尺寸', () => {
    expect(reasonsOf('fig-res').map(reason => reason.message)).toEqual([
      '图含有写作片段不支持的内容：「resourceId」（图资源引用），整体替换会丢失它',
      '图含有写作片段不支持的内容：「imageWidth」（图片宽度），整体替换会丢失它',
    ])
  })

  it('公式 MathML、TBX 语言集、结构化文献、行内脚注', () => {
    expect(reasonsOf('f-mathml')[0]).toMatchObject({ code: 'unsupported-field', path: 'ir.mathml' })
    expect(reasonsOf('term-3')[0]).toMatchObject({ code: 'unsupported-field', path: 'ir.languageSets' })
    expect(reasonsOf('term-3')[0]!.message).toContain('TBX 语言集')
    expect(reasonsOf('bib-3')[0]).toMatchObject({ code: 'unsupported-field', path: 'ir.identifiers' })
    expect(reasonsOf('scope-p1')[0]).toMatchObject({ code: 'unsupported-field', path: 'ir.content[1].footnote' })
  })

  it('警告块等写作片段不支持的块种类', () => {
    const info = read('warn-1')
    expect(info.kind).toBe('warning')
    expect(info.replaceable).toBe(false)
    expect(info.notReplaceable![0]).toMatchObject({ code: 'unsupported-kind' })
  })

  it('包含不可替换内容的祖先节点同样标出，并列出全部类别', () => {
    const codes = reasonsOf('ch-4').map(reason => reason.code)
    expect(codes).toContain('unsupported-field')
    expect(codes).toContain('unsupported-kind')
    expect(reasonsOf('cl-42').length).toBe(reasonsOf('ch-4').length)
    // 其它章不受影响
    expect(read('ch-refs').replaceable).toBe(true)
  })

  it('IR 读不到的内容（unsupportedContent）也算作会丢失', () => {
    const source = doc(chapter('ch', '范围',
      clause('with-rule', 1, '含分隔线', para('p1', text('正文')), node('horizontalRule')),
      clause('plain', 1, '普通条', para('p2', text('正文')))))
    const info = read('with-rule', source)
    expect(info.replaceable).toBe(false)
    expect(info.notReplaceable![0]).toMatchObject({ code: 'unsupported-content' })
    expect(info.notReplaceable![0]!.message).toContain('horizontalRule')
    expect(read('plain', source).replaceable).toBe(true)
  })

  it('写作片段本身不接受的内容给出原因：术语没有定义、条层级与位置不符', () => {
    const source = doc(chapter('ch', '术语和定义',
      termDef('t-empty', '术语', ''),
      clause('c-skip', 3, '跳级条', para('p', text('正文')))))
    const empty = read('t-empty', source)
    expect(empty.replaceable).toBe(false)
    expect(empty.notReplaceable![0]).toMatchObject({ code: 'authoring-invalid' })
    expect(empty.notReplaceable![0]!.message).toContain('定义')
    const skip = read('c-skip', source)
    expect(skip.replaceable).toBe(false)
    expect(skip.notReplaceable![0]!.message).toContain('层级')
  })
})

describe('readNode：找不到的节点', () => {
  it('不存在的 id', () => {
    expect(readNode(pm, 'nope')).toMatchObject({ ok: false, code: 'node-not-found' })
  })

  it('存在但位于表、列项、术语条目内部，不能单独寻址，并指出所属节点', () => {
    const inTable = readNode(pm, 'tbl-1-r1c1')
    expect(inTable).toMatchObject({ ok: false, code: 'node-not-addressable' })
    expect(inTable.ok === false && inTable.reason).toContain('表「tbl-1」')
    const inList = readNode(pm, 'li-1')
    expect(inList.ok === false && inList.reason).toContain('列项「list-1」')
    const inTerm = readNode(pm, 'term-1-note')
    expect(inTerm.ok === false && inTerm.reason).toContain('术语条目「term-1」')
  })

  it('派生 id 与容器名都不是节点', () => {
    expect(readNode(pm, 'li-1.p0')).toMatchObject({ ok: false, code: 'node-not-found' })
    expect(readNode(pm, 'foreword')).toMatchObject({ ok: false, code: 'node-not-found' })
  })

  it('重复的 id 拒绝定位', () => {
    const source = clone(richDocument())
    const dup = para('p-411', text('重复'))
    source.content!.splice(4, 0, chapter('ch-dup', '重复章', dup))
    expect(readNode(source, 'p-411')).toMatchObject({ ok: false, code: 'node-ambiguous' })
  })
})

describe('readContainer', () => {
  it('读取前言、引言、参考文献，取得其中节点的 id', () => {
    const foreword = readContainer(pm, 'foreword')
    expect(foreword).toMatchObject({ ok: true, container: { container: 'foreword', exists: true, context: { parent: 'foreword' } } })
    expect(foreword.ok && foreword.container.nodes.map(item => item.id)).toEqual(['fw-p1', 'fw-note'])
    const bibliography = readContainer(pm, 'bibliography')
    expect(bibliography.ok && bibliography.container.nodes.map(item => item.id)).toEqual(['bib-1', 'bib-2', 'bib-3'])
  })

  it('容器不存在时 exists 为 false', () => {
    const result = readContainer(doc(chapter('c', '范围', para('p', text('x')))), 'introduction')
    expect(result).toMatchObject({ ok: true, container: { exists: false, nodes: [] } })
  })

  it('body 与 appendices 不能整体读取', () => {
    const result = readContainer(pm, 'body')
    expect(result).toMatchObject({ ok: false, code: 'invalid-container' })
    expect(result.ok === false && result.reason).toContain('结构树')
    expect(readContainer(pm, 'nope')).toMatchObject({ ok: false, code: 'invalid-container' })
  })

  it('多个同类容器无法确定', () => {
    const source = doc(node('foreword', undefined, [para('a', text('x'))]), node('foreword', undefined, [para('b', text('y'))]))
    expect(readContainer(source, 'foreword')).toMatchObject({ ok: false, code: 'container-ambiguous' })
  })
})
