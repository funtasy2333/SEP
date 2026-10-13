import { afterAll, describe, expect, it } from 'vitest'
import {
  AUTHORING_ISSUE_CODES, AUTHORING_NODE_KINDS, normalizeAuthoringFragment,
  type AuthoringIssue, type AuthoringNormalizeOptions,
} from '../authoring'
import type { AuthoringContext, IRFragmentNode } from '../fragmentContext'
import { fragmentContextRules, validateAuthoringContext } from '../fragmentContext'
import { pmToIr } from '../pmToIr'
import {
  ALL_CONTEXTS, EXPECTED_ALLOWED, MINIMAL, PNG_DATA_URL, seqIds,
} from './authoringHelpers'

const CHAPTER: AuthoringContext = { parent: 'chapter' }

function normalizeOk(
  input: unknown, context: AuthoringContext = CHAPTER, options: AuthoringNormalizeOptions = {},
): IRFragmentNode[] {
  const result = normalizeAuthoringFragment(input, context, { generateId: seqIds(), ...options })
  if (!result.ok) throw new Error(`应当通过，实际问题：\n${JSON.stringify(result.issues, null, 2)}`)
  return result.nodes
}

function normalizeFail(
  input: unknown, context: AuthoringContext = CHAPTER, options: AuthoringNormalizeOptions = {},
): AuthoringIssue[] {
  const result = normalizeAuthoringFragment(input, context, { generateId: seqIds(), ...options })
  if (result.ok) throw new Error(`应当失败，实际通过：\n${JSON.stringify(result.nodes, null, 2)}`)
  expect(result.issues.length).toBeGreaterThan(0)
  return result.issues
}

const seenCodes = new Set<string>()

/** 断言存在 code 与 path 都匹配的问题。 */
function expectIssue(issues: AuthoringIssue[], code: string, path: string): AuthoringIssue {
  const found = issues.find(issue => issue.code === code && issue.path === path)
  if (found) seenCodes.add(code)
  if (!found) throw new Error(`缺少问题 ${code} @ ${path}，实际：\n${issues.map(i => `${i.path} [${i.code}] ${i.reason}`).join('\n')}`)
  expect(found.reason).toMatch(/[一-龥]/)
  return found
}

function withoutIds<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, child) => key === 'id' && typeof child === 'string' ? '#' : child)) as T
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

const para = (text: string) => ({ kind: 'paragraph', id: '#', content: [{ text }] })

describe('normalizeAuthoringFragment / 入口与上下文', () => {
  it('单个节点也必须放进数组', () => {
    const issues = normalizeFail({ kind: 'paragraph', content: '甲' })
    expectIssue(issues, 'invalid-type', 'fragment')
  })

  it('空片段被拒绝，并提示用删除操作', () => {
    const issues = normalizeFail([])
    expectIssue(issues, 'empty-fragment', 'fragment')
    expect(issues[0]!.reason).toContain('删除')
  })

  it('无效上下文：未知 parent、条缺层级、层级越界、多余字段、非对象', () => {
    for (const context of [
      { parent: 'section' }, { parent: 'clause' }, { parent: 'clause', level: 0 }, { parent: 'clause', level: 6 },
      { parent: 'clause', level: 1.5 }, { parent: 'chapter', level: 1 }, null, 'chapter',
    ]) {
      const issues = normalizeFail(['甲'], context as never)
      expect(issues).toHaveLength(1)
      expectIssue(issues, 'invalid-context', 'context')
      expect(validateAuthoringContext(context)).toBeTypeOf('string')
    }
    for (const { context } of ALL_CONTEXTS) expect(validateAuthoringContext(context)).toBeUndefined()
  })

  it('rootPath 改变所有问题路径的根', () => {
    const issues = normalizeFail([{ kind: 'paragraph' }, { kind: 'list', items: [] }], CHAPTER, { rootPath: 'operations[2].content' })
    expectIssue(issues, 'missing-field', 'operations[2].content[0].content')
    expectIssue(issues, 'empty-value', 'operations[2].content[1].items')
    expect(issues.every(issue => issue.path.startsWith('operations[2].content'))).toBe(true)
  })

  it('不修改输入对象（冻结的输入也能归一化）', () => {
    const input = deepFreeze([
      '甲',
      { kind: 'list', items: ['乙', { content: [{ text: '丙', marks: [{ type: 'bold' }] }] }] },
      { kind: 'table', caption: '表', rows: [['a', { content: 'b', colspan: 1 }]], notes: ['注'] },
      { kind: 'clause', title: '条', children: ['子'] },
    ])
    const snapshot = JSON.stringify(input)
    expect(normalizeAuthoringFragment(input, CHAPTER).ok).toBe(true)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('一次报出全部问题，而不是停在第一个', () => {
    const issues = normalizeFail([
      { kind: 'paragraph', contnet: 'x' },
      { kind: 'formula' },
      { kind: 'bogus' },
      42,
    ])
    expectIssue(issues, 'unknown-field', 'fragment[0].contnet')
    expectIssue(issues, 'missing-field', 'fragment[0].content')
    expectIssue(issues, 'missing-field', 'fragment[1].latex')
    expectIssue(issues, 'unknown-kind', 'fragment[2].kind')
    expectIssue(issues, 'invalid-type', 'fragment[3]')
  })
})

afterAll(() => {
  // 每个公开的问题代码都至少有一条带路径断言的反例，清单里不留死代码。
  expect([...AUTHORING_ISSUE_CODES].filter(code => !seenCodes.has(code))).toEqual([])
})

describe('normalizeAuthoringFragment / 上下文规则表（每个上下文 × 每种 kind）', () => {
  for (const { name, context } of ALL_CONTEXTS) {
    it(`${name}：允许 ${EXPECTED_ALLOWED[name]!.join('、')}，其余 not-allowed-here`, () => {
      const allowed = new Set<string>(EXPECTED_ALLOWED[name])
      for (const kind of AUTHORING_NODE_KINDS) {
        const result = normalizeAuthoringFragment([MINIMAL[kind]], context, { generateId: seqIds() })
        if (allowed.has(kind)) {
          expect(result.ok, `${name} 应允许 ${kind}`).toBe(true)
        } else {
          expect(result.ok, `${name} 不应允许 ${kind}`).toBe(false)
          if (!result.ok) {
            expect(result.issues).toHaveLength(1)
            expect(result.issues[0]).toMatchObject({ code: 'not-allowed-here', path: 'fragment[0].kind' })
          }
        }
        // 实现与规则函数一致
        const rules = fragmentContextRules(context)
        const byRules = (AUTHORING_NODE_KINDS as readonly string[]).includes(kind)
          && (kind === 'chapter' ? rules.chapter
            : kind === 'appendix' ? rules.appendix
              : kind === 'clause' ? rules.clause
                : kind === 'termEntry' ? rules.termEntry
                  : kind === 'bibEntry' ? rules.bibEntry
                    : rules.blocks)
        expect(byRules).toBe(allowed.has(kind))
      }
    })
  }

  it('字符串：块位置是段落，参考文献中是文献条目，其余位置被拒绝', () => {
    expect(withoutIds(normalizeOk(['甲'], { parent: 'foreword' }))).toEqual([para('甲')])
    expect(withoutIds(normalizeOk(['甲'], { parent: 'bibliography' }))).toEqual([
      { kind: 'bibEntry', id: '#', content: [{ text: '甲' }] },
    ])
    for (const parent of ['body', 'appendices'] as const) {
      expectIssue(normalizeFail(['甲'], { parent }), 'not-allowed-here', 'fragment[0]')
    }
  })

  it('warning / quote / code 报 unsupported-kind，未知 kind 报 unknown-kind，kind 缺失或类型错报对应问题', () => {
    for (const kind of ['warning', 'quote', 'code']) {
      expectIssue(normalizeFail([{ kind, content: [] }]), 'unsupported-kind', 'fragment[0].kind')
    }
    expectIssue(normalizeFail([{ kind: 'section' }]), 'unknown-kind', 'fragment[0].kind')
    expectIssue(normalizeFail([{ content: 'x' }]), 'missing-field', 'fragment[0].kind')
    expectIssue(normalizeFail([{ kind: 3 }]), 'invalid-type', 'fragment[0].kind')
    expectIssue(normalizeFail([[]]), 'invalid-type', 'fragment[0]')
    expectIssue(normalizeFail([null]), 'invalid-type', 'fragment[0]')
  })

  it('嵌套位置按所在容器的规则检查：章内不能放章，条内放章/附录报错并给出路径', () => {
    const issues = normalizeFail([{ kind: 'chapter', title: '章', children: [{ kind: 'chapter', title: '内章' }, { kind: 'appendix', title: '附' }] }], { parent: 'body' })
    expectIssue(issues, 'not-allowed-here', 'fragment[0].children[0].kind')
    expectIssue(issues, 'not-allowed-here', 'fragment[0].children[1].kind')
  })
})

describe('normalizeAuthoringFragment / id', () => {
  it('省略的 id 用注入的生成器生成；给出的 id 原样保留', () => {
    const nodes = normalizeOk([{ kind: 'paragraph', content: '甲' }, { kind: 'paragraph', id: 'mine', content: '乙' }])
    expect(nodes.map(node => node.id)).toEqual(['g1', 'mine'])
  })

  it('默认使用 generateNodeId：12 位字母数字，互不相同', () => {
    const result = normalizeAuthoringFragment(
      [{ kind: 'table', caption: '', rows: [['a', 'b'], ['c', 'd']] }, { kind: 'list', items: ['x', 'y'] }], CHAPTER)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ids: string[] = []
    JSON.stringify(result.nodes, (key, value) => { if (key === 'id') ids.push(value as string); return value })
    expect(ids.length).toBeGreaterThan(10)
    for (const id of ids.filter(id => !id.includes('.'))) expect(id).toMatch(/^[A-Za-z0-9]{12}$/)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('id 必须是非空字符串', () => {
    for (const id of ['', 7, null, true, {}]) {
      expectIssue(normalizeFail([{ kind: 'paragraph', id, content: '甲' }]), 'invalid-id', 'fragment[0].id')
    }
  })

  it('片段内重复的 id 报 duplicate-id，指向后出现者并说明首次位置', () => {
    const issues = normalizeFail([
      { kind: 'paragraph', id: 'dup', content: '甲' },
      { kind: 'clause', id: 'c1', title: '条', children: [{ kind: 'paragraph', id: 'dup', content: '乙' }] },
    ])
    const issue = expectIssue(issues, 'duplicate-id', 'fragment[1].children[0].id')
    expect(issue.nodeId).toBe('dup')
    expect(issue.reason).toContain('fragment[0].id')
  })

  it('重复检查覆盖表行、单元格、列项项、式中项和派生的段落 id', () => {
    const issues = normalizeFail([
      { kind: 'table', id: 't', caption: '', rows: [{ id: 'r', cells: [{ id: 'c', content: 'x' }, { id: 'c', content: 'y' }] }] },
      { kind: 'list', items: [{ id: 'i', content: 'x' }, { id: 'i', content: 'y' }] },
      { kind: 'formula', latex: 'x', whereList: [{ id: 'w', term: 'a', definition: 'b' }, { id: 'w', term: 'c', definition: 'd' }] },
      { kind: 'note', id: 'n', content: '注' },
      { kind: 'paragraph', id: 'n.p0', content: '与注内派生段落同 id' },
    ])
    expectIssue(issues, 'duplicate-id', 'fragment[0].rows[0].cells[1].id')
    expectIssue(issues, 'duplicate-id', 'fragment[1].items[1].id')
    expectIssue(issues, 'duplicate-id', 'fragment[2].whereList[1].id')
    expectIssue(issues, 'duplicate-id', 'fragment[4].id')
  })

  it('与已有 id 冲突报 id-conflict（含派生的段落 id）；生成的 id 避开已有 id 和片段内显式 id', () => {
    const existing = new Set(['taken', 'n.p0'])
    const issues = normalizeFail([
      { kind: 'paragraph', id: 'taken', content: '甲' },
      { kind: 'note', id: 'n', content: '注' },
    ], CHAPTER, { existingIds: existing })
    const conflict = expectIssue(issues, 'id-conflict', 'fragment[0].id')
    expect(conflict.nodeId).toBe('taken')
    expectIssue(issues, 'id-conflict', 'fragment[1].content')

    // 生成器依次给出 g1(已有)、g2(片段里稍后出现的显式 id)、g3
    const nodes = normalizeOk(
      [{ kind: 'paragraph', content: '甲' }, { kind: 'paragraph', id: 'g2', content: '乙' }],
      CHAPTER, { existingIds: new Set(['g1']), generateId: seqIds() })
    expect(nodes.map(node => node.id)).toEqual(['g3', 'g2'])
  })

  it('同一 id 在已有集合中不冲突时可以复用（替换场景由调用方排除被替换子树的 id）', () => {
    const nodes = normalizeOk([{ kind: 'paragraph', id: 'keep', content: '新内容' }], CHAPTER, { existingIds: new Set(['other']) })
    expect(nodes[0]!.id).toBe('keep')
  })

  it('生成器持续给出重复值时抛错（编程错误，不是输入问题）', () => {
    expect(() => normalizeAuthoringFragment(['甲', '乙'], CHAPTER, { generateId: () => 'same' })).toThrow('nodeId')
  })
})

describe('normalizeAuthoringFragment / 行内内容', () => {
  const content = (inlines: unknown) => normalizeOk([{ kind: 'paragraph', content: inlines }])[0] as { content: unknown[] }

  it('字符串等价于 [{ text }]；数组中的字符串是纯文本片段；空字符串被丢弃', () => {
    expect(content('甲').content).toEqual([{ text: '甲' }])
    expect(content(['甲', '', { text: '乙', marks: [{ type: 'bold' }] }]).content).toEqual([
      { text: '甲' }, { text: '乙', marks: [{ type: 'bold' }] },
    ])
    expect(content('').content).toEqual([])
    expect(content([{ text: '甲', marks: [] }]).content).toEqual([{ text: '甲' }])
  })

  it('换行拆成独立的 { text: "\\n" }（与 pmToIr 读回形态一致），标记随之复制', () => {
    expect(content([{ text: 'a\nb', marks: [{ type: 'bold' }] }]).content).toEqual([
      { text: 'a', marks: [{ type: 'bold' }] },
      { text: '\n', marks: [{ type: 'bold' }] },
      { text: 'b', marks: [{ type: 'bold' }] },
    ])
    expect(content('a\n\nb').content).toEqual([{ text: 'a' }, { text: '\n' }, { text: '\n' }, { text: 'b' }])
  })

  it('相邻且标记完全相同的文字片段合并（与编辑器中的同一段文字一致）；换行与不同标记的片段不合并', () => {
    expect(content(['a', 'b', { text: 'c', marks: [{ type: 'bold' }] }, { text: 'd', marks: [{ type: 'bold' }] }, 'e']).content).toEqual([
      { text: 'ab' }, { text: 'cd', marks: [{ type: 'bold' }] }, { text: 'e' },
    ])
    expect(content([{ text: 'a', marks: [{ type: 'bold' }] }, { text: 'b', marks: [{ type: 'italic' }] }]).content).toEqual([
      { text: 'a', marks: [{ type: 'bold' }] }, { text: 'b', marks: [{ type: 'italic' }] },
    ])
    expect(content(['a\n', 'b']).content).toEqual([{ text: 'a' }, { text: '\n' }, { text: 'b' }])
    expect(content([{ text: 'x' }, { text: '\n' }, { text: 'y' }]).content).toEqual([{ text: 'x' }, { text: '\n' }, { text: 'y' }])
    // 同一引用目标的相邻片段在编辑器里就是一个引用，按同一段文字合并
    const ref = { type: 'crossRef', targetId: 't1' }
    expect(content([{ text: '表', marks: [ref] }, { text: '1', marks: [ref] }]).content).toEqual([{ text: '表1', marks: [ref] }])
  })

  it('支持的标记按 IR 原样保留', () => {
    const marks = [
      { type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'sub' }, { type: 'sup' }, { type: 'strike' },
    ]
    for (const mark of marks) expect(content([{ text: 'x', marks: [mark] }]).content).toEqual([{ text: 'x', marks: [mark] }])
    expect(content([{ text: 'x', marks: [{ type: 'code' }] }]).content).toEqual([{ text: 'x', marks: [{ type: 'code' }] }])
    const rich = [
      { type: 'variable', kind: 'quantity', name: 'm' },
      { type: 'externalLink', href: 'https://example.com/a?b=1', title: '示例', target: '_blank', rel: 'noopener' },
    ]
    expect(content([{ text: 'x', marks: rich }]).content).toEqual([{ text: 'x', marks: rich }])
    for (const mark of [
      { type: 'crossRef', targetId: 'tbl-1' },
      { type: 'crossRef', targetId: 'tbl-1', targetKind: 'table' },
      { type: 'bibRef', targetId: 'bib-1' },
      { type: 'termRef', targetId: 'term-1' },
    ]) expect(content([{ text: '引用', marks: [mark] }]).content).toEqual([{ text: '引用', marks: [mark] }])
  })

  it('交叉引用目标不存在时这里不报错（悬空引用由后续校验发现）', () => {
    expect(normalizeAuthoringFragment([{ kind: 'paragraph', content: [{ text: '见表', marks: [{ type: 'crossRef', targetId: 'nowhere' }] }] }], CHAPTER).ok).toBe(true)
  })

  it('行内问题：类型、缺 text、未知字段、IR 暂不支持的字段', () => {
    const at = (inlines: unknown) => normalizeFail([{ kind: 'paragraph', content: inlines }])
    expectIssue(at(5), 'invalid-type', 'fragment[0].content')
    expectIssue(at([5]), 'invalid-type', 'fragment[0].content[0]')
    expectIssue(at([{ marks: [] }]), 'missing-field', 'fragment[0].content[0].text')
    expectIssue(at([{ text: 3 }]), 'invalid-type', 'fragment[0].content[0].text')
    expectIssue(at([{ text: 'x', txt: 'y' }]), 'unknown-field', 'fragment[0].content[0].txt')
    expectIssue(at([{ text: 'x', style: { color: 'red' } }]), 'unsupported-field', 'fragment[0].content[0].style')
    expectIssue(at([{ text: '', formula: { id: 'f', latex: 'x' } }]), 'unsupported-field', 'fragment[0].content[0].formula')
    expectIssue(at([{ text: '', footnote: { id: 'f', content: [] } }]), 'unsupported-field', 'fragment[0].content[0].footnote')
    expectIssue(at([{ text: 'x', marks: 'bold' }]), 'invalid-type', 'fragment[0].content[0].marks')
  })

  it('标记问题：缺 type、未知 type、多余字段、必填字段缺失、枚举、链接', () => {
    const at = (marks: unknown[]) => normalizeFail([{ kind: 'paragraph', content: [{ text: 'x', marks }] }])
    expectIssue(at(['bold']), 'invalid-type', 'fragment[0].content[0].marks[0]')
    expectIssue(at([{}]), 'missing-field', 'fragment[0].content[0].marks[0].type')
    expectIssue(at([{ type: 'blink' }]), 'invalid-value', 'fragment[0].content[0].marks[0].type')
    expectIssue(at([{ type: 'bold', weight: 7 }]), 'unknown-field', 'fragment[0].content[0].marks[0].weight')
    expectIssue(at([{ type: 'crossRef' }]), 'missing-field', 'fragment[0].content[0].marks[0].targetId')
    expectIssue(at([{ type: 'crossRef', targetId: '' }]), 'invalid-type', 'fragment[0].content[0].marks[0].targetId')
    expectIssue(at([{ type: 'crossRef', targetId: 't', targetKind: 'page' }]), 'invalid-value', 'fragment[0].content[0].marks[0].targetKind')
    expectIssue(at([{ type: 'bibRef' }]), 'missing-field', 'fragment[0].content[0].marks[0].targetId')
    expectIssue(at([{ type: 'termRef', targetId: 3 }]), 'invalid-type', 'fragment[0].content[0].marks[0].targetId')
    expectIssue(at([{ type: 'variable', kind: 1 }]), 'invalid-type', 'fragment[0].content[0].marks[0].kind')
    expectIssue(at([{ type: 'externalLink' }]), 'missing-field', 'fragment[0].content[0].marks[0].href')
    expectIssue(at([{ type: 'tableFootnoteRef', targetId: 't' }]), 'unsupported-field', 'fragment[0].content[0].marks[0]')
    for (const href of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'ftp://example.com', 'https://a b', ' https://a.com']) {
      expectIssue(at([{ type: 'externalLink', href }]), 'invalid-value', 'fragment[0].content[0].marks[0].href')
    }
    for (const href of ['http://a.com', 'https://a.com/x', 'mailto:a@b.com', 'tel:+8610']) {
      expect(normalizeAuthoringFragment([{ kind: 'paragraph', content: [{ text: 'x', marks: [{ type: 'externalLink', href }] }] }], CHAPTER).ok).toBe(true)
    }
  })

  it('生产 schema 无法保留的组合：重复标记、code 与其他标记、空文本带标记、crossRef 含换行', () => {
    const at = (inline: unknown) => normalizeFail([{ kind: 'paragraph', content: [inline] }])
    expectIssue(at({ text: 'x', marks: [{ type: 'bold' }, { type: 'bold' }] }), 'inline-projection', 'fragment[0].content[0].marks[1]')
    expectIssue(at({ text: 'x', marks: [{ type: 'code' }, { type: 'bold' }] }), 'inline-projection', 'fragment[0].content[0].marks[0]')
    expectIssue(at({ text: '', marks: [{ type: 'bold' }] }), 'inline-projection', 'fragment[0].content[0].text')
    expectIssue(at({ text: '', marks: [{ type: 'crossRef', targetId: 't' }] }), 'inline-projection', 'fragment[0].content[0].text')
    expectIssue(at({ text: 'a\nb', marks: [{ type: 'crossRef', targetId: 't' }] }), 'inline-projection', 'fragment[0].content[0].text')
    expectIssue(at({ text: 'x', marks: [{ type: 'crossRef', targetId: 'a' }, { type: 'crossRef', targetId: 'b' }] }), 'inline-projection', 'fragment[0].content[0].marks[1]')
  })
})

describe('normalizeAuthoringFragment / 段落', () => {
  it('对象形态与字符串形态等价', () => {
    expect(withoutIds(normalizeOk([{ kind: 'paragraph', content: '甲' }]))).toEqual(withoutIds(normalizeOk(['甲'])))
  })

  it('缺少 content、未知字段、content 类型错误', () => {
    expectIssue(normalizeFail([{ kind: 'paragraph' }]), 'missing-field', 'fragment[0].content')
    expectIssue(normalizeFail([{ kind: 'paragraph', content: '甲', align: 'left' }]), 'unknown-field', 'fragment[0].align')
    expectIssue(normalizeFail([{ kind: 'paragraph', content: 3 }]), 'invalid-type', 'fragment[0].content')
  })
})

describe('normalizeAuthoringFragment / 列项', () => {
  it('缺省 dash、无 level；列项项可写字符串、行内数组或对象；段落 id 派生为 <项 id>.p0', () => {
    const nodes = normalizeOk([{
      kind: 'list',
      items: ['甲', [{ text: '乙', marks: [{ type: 'bold' }] }], { id: 'item3', content: '丙' }],
    }])
    expect(nodes).toEqual([{
      kind: 'list', id: 'g1', listType: 'dash',
      items: [
        { id: 'g2', content: [{ kind: 'paragraph', id: 'g2.p0', content: [{ text: '甲' }] }] },
        { id: 'g3', content: [{ kind: 'paragraph', id: 'g3.p0', content: [{ text: '乙', marks: [{ type: 'bold' }] }] }] },
        { id: 'item3', content: [{ kind: 'paragraph', id: 'item3.p0', content: [{ text: '丙' }] }] },
      ],
    }])
  })

  it('各 listType 的层级：number、dot 固定二级（写出 level: 2），其余一级（不写 level）', () => {
    for (const [listType, level] of [['dash', undefined], ['alpha', undefined], ['boxed', undefined], ['number', 2], ['dot', 2]] as const) {
      const [list] = normalizeOk([{ kind: 'list', listType, items: ['x'] }]) as [{ listType: string; level?: number }]
      expect(list.listType).toBe(listType)
      expect(list.level).toBe(level)
      expect('level' in list).toBe(level !== undefined)
    }
  })

  it('level 给出时必须与 listType 一致', () => {
    expect(normalizeAuthoringFragment([{ kind: 'list', listType: 'number', level: 2, items: ['x'] }], CHAPTER).ok).toBe(true)
    expectIssue(normalizeFail([{ kind: 'list', listType: 'number', level: 1, items: ['x'] }]), 'level-mismatch', 'fragment[0].level')
    expectIssue(normalizeFail([{ kind: 'list', level: 2, items: ['x'] }]), 'level-mismatch', 'fragment[0].level')
  })

  it('非法 listType（含生产不支持的罗马数字）、缺 items、空 items、项类型错误', () => {
    expectIssue(normalizeFail([{ kind: 'list', listType: 'roman', items: ['x'] }]), 'invalid-value', 'fragment[0].listType')
    expectIssue(normalizeFail([{ kind: 'list', listType: 'romanUpper', items: ['x'] }]), 'invalid-value', 'fragment[0].listType')
    expectIssue(normalizeFail([{ kind: 'list', listType: 'bullet', items: ['x'] }]), 'invalid-value', 'fragment[0].listType')
    expectIssue(normalizeFail([{ kind: 'list' }]), 'missing-field', 'fragment[0].items')
    expectIssue(normalizeFail([{ kind: 'list', items: [] }]), 'empty-value', 'fragment[0].items')
    expectIssue(normalizeFail([{ kind: 'list', items: 'x' }]), 'invalid-type', 'fragment[0].items')
    expectIssue(normalizeFail([{ kind: 'list', items: [3] }]), 'invalid-type', 'fragment[0].items[0]')
    expectIssue(normalizeFail([{ kind: 'list', items: [{ text: 'x' }] }]), 'unknown-field', 'fragment[0].items[0].text')
    expectIssue(normalizeFail([{ kind: 'list', items: [{ id: 'a' }] }]), 'missing-field', 'fragment[0].items[0].content')
  })

  it('列项不能嵌套列项，列项项内只能有一个段落，段落 id 只能是派生值', () => {
    expectIssue(normalizeFail([{ kind: 'list', items: [{ content: [{ kind: 'list', items: ['y'] }] }] }]), 'not-allowed-here', 'fragment[0].items[0].content')
    const issues = normalizeFail([{
      kind: 'list',
      items: [
        { id: 'a', content: [{ kind: 'paragraph', content: '1' }, { kind: 'paragraph', content: '2' }] },
        { id: 'b', content: [{ kind: 'paragraph', id: 'other', content: '3' }] },
      ],
    }])
    expectIssue(issues, 'not-allowed-here', 'fragment[0].items[0].content')
    expectIssue(issues, 'invalid-id', 'fragment[0].items[1].content[0].id')
    // 派生值本身可以显式写出
    expect(normalizeAuthoringFragment([{ kind: 'list', items: [{ id: 'a', content: [{ kind: 'paragraph', id: 'a.p0', content: '1' }] }] }], CHAPTER).ok).toBe(true)
  })
})

describe('normalizeAuthoringFragment / 表', () => {
  it('缺省值：orientation=portrait、headerRowCount=1、notes=[]；首行为表头；行与单元格补 id', () => {
    const [table] = normalizeOk([{ kind: 'table', caption: '表题', rows: [['甲', '乙'], ['丙', '丁']] }]) as [{
      orientation: string; headerRowCount: number; notes: unknown[]; caption: unknown[]
      rows: { id: string; cells: { header: boolean; colspan: number; rowspan: number; id: string; content: { kind: string }[] }[] }[]
    }]
    expect(table.orientation).toBe('portrait')
    expect(table.headerRowCount).toBe(1)
    expect(table.notes).toEqual([])
    expect(table.caption).toEqual([{ text: '表题' }])
    expect(table.rows.map(row => row.cells.map(cell => cell.header))).toEqual([[true, true], [false, false]])
    expect(table.rows.flatMap(row => row.cells).every(cell => cell.colspan === 1 && cell.rowspan === 1)).toBe(true)
    expect(table.rows.every(row => row.id && row.cells.every(cell => cell.id && cell.content[0]!.kind === 'paragraph'))).toBe(true)
    expect(table).not.toHaveProperty('captionEn')
  })

  it('header 缺省为「行号 < headerRowCount」，可在单元格上显式覆盖；headerRowCount 可为 0', () => {
    const [table] = normalizeOk([{
      kind: 'table', caption: '', headerRowCount: 2,
      rows: [['a', 'b'], [{ content: 'c', header: false }, 'd'], [{ content: 'e', header: true }, 'f']],
    }]) as [{ rows: { cells: { header: boolean }[] }[] }]
    expect(table.rows.map(row => row.cells.map(cell => cell.header))).toEqual([[true, true], [false, true], [true, false]])
    const [flat] = normalizeOk([{ kind: 'table', caption: '', headerRowCount: 0, rows: [['a']] }]) as [{ headerRowCount: number; rows: { cells: { header: boolean }[] }[] }]
    expect(flat.headerRowCount).toBe(0)
    expect(flat.rows[0]!.cells[0]!.header).toBe(false)
  })

  it('行可写 { id, cells }；单元格对象支持 id/colspan/rowspan/header/content', () => {
    const [table] = normalizeOk([{
      kind: 'table', caption: '', orientation: 'landscape',
      rows: [
        { id: 'row1', cells: [{ id: 'cell1', content: '合并', colspan: 2, rowspan: 1 }, { content: '纵', rowspan: 2 }] },
        { cells: ['x', 'y'] },
      ],
    }]) as [{ orientation: string; rows: { id: string; cells: { id: string; colspan: number; rowspan: number }[] }[] }]
    expect(table.orientation).toBe('landscape')
    expect(table.rows[0]!.id).toBe('row1')
    expect(table.rows[0]!.cells[0]).toMatchObject({ id: 'cell1', colspan: 2, rowspan: 1 })
    expect(table.rows[0]!.cells[1]).toMatchObject({ colspan: 1, rowspan: 2 })
  })

  it('单元格内容：字符串=段落；字符串数组=多个段落；行内片段数组=一个段落；块数组；空数组/空串=空段落', () => {
    const [table] = normalizeOk([{
      kind: 'table', caption: '', headerRowCount: 0,
      rows: [[
        '甲',
        { content: ['乙1', '乙2'] },
        { content: [{ text: '丙', marks: [{ type: 'bold' }] }, { text: '尾' }] },
        { content: [{ kind: 'paragraph', id: 'cp', content: '丁' }, { kind: 'list', items: ['戊'] }] },
        { content: [] },
        '',
      ]],
    }]) as [{ rows: { cells: { content: { kind: string; id: string; content?: unknown[] }[] }[] }[] }]
    const cells = table.rows[0]!.cells
    expect(cells.map(cell => cell.content.map(block => block.kind))).toEqual([
      ['paragraph'], ['paragraph', 'paragraph'], ['paragraph'], ['paragraph', 'list'], ['paragraph'], ['paragraph'],
    ])
    expect(cells[2]!.content[0]!.content).toEqual([{ text: '丙', marks: [{ type: 'bold' }] }, { text: '尾' }])
    expect(cells[3]!.content[0]!.id).toBe('cp')
    expect(cells[4]!.content[0]!.content).toEqual([])
    expect(cells[5]!.content[0]!.content).toEqual([])
  })

  it('表题可为空串；captionEn 非空时保留、空白时省略；表注可写字符串或 { content }', () => {
    const [table] = normalizeOk([{
      kind: 'table', caption: [{ text: '表', marks: [{ type: 'bold' }] }], captionEn: 'Table', rows: [['a']],
      notes: ['单条表注', { id: 'tn', content: '另一条' }, { kind: 'note', content: '带 kind' }],
    }]) as [{ caption: unknown[]; captionEn?: unknown[]; notes: { kind: string; id: string; content: { id: string }[] }[] }]
    expect(table.captionEn).toEqual([{ text: 'Table' }])
    expect(table.notes).toHaveLength(3)
    expect(table.notes.map(note => note.kind)).toEqual(['note', 'note', 'note'])
    expect(table.notes[1]).toMatchObject({ id: 'tn', content: [{ kind: 'paragraph', id: 'tn.p0' }] })
    const [blank] = normalizeOk([{ kind: 'table', caption: '', captionEn: '  ', rows: [['a']] }])
    expect(blank).not.toHaveProperty('captionEn')
  })

  it('表的字段问题：缺 caption/rows、空 rows、空行、行类型、orientation、headerRowCount、未知与暂不支持字段', () => {
    expectIssue(normalizeFail([{ kind: 'table', rows: [['a']] }]), 'missing-field', 'fragment[0].caption')
    expectIssue(normalizeFail([{ kind: 'table', caption: '' }]), 'missing-field', 'fragment[0].rows')
    expectIssue(normalizeFail([{ kind: 'table', caption: '', rows: [] }]), 'empty-value', 'fragment[0].rows')
    expectIssue(normalizeFail([{ kind: 'table', caption: '', rows: [[]] }]), 'empty-value', 'fragment[0].rows[0]')
    expectIssue(normalizeFail([{ kind: 'table', caption: '', rows: [{ id: 'r' }] }]), 'missing-field', 'fragment[0].rows[0].cells')
    expectIssue(normalizeFail([{ kind: 'table', caption: '', rows: ['a'] }]), 'invalid-type', 'fragment[0].rows[0]')
    expectIssue(normalizeFail([{ kind: 'table', caption: '', rows: 'a' }]), 'invalid-type', 'fragment[0].rows')
    expectIssue(normalizeFail([{ kind: 'table', caption: '', orientation: 'diagonal', rows: [['a']] }]), 'invalid-value', 'fragment[0].orientation')
    expectIssue(normalizeFail([{ kind: 'table', caption: '', headerRowCount: 2, rows: [['a']] }]), 'invalid-value', 'fragment[0].headerRowCount')
    expectIssue(normalizeFail([{ kind: 'table', caption: '', headerRowCount: -1, rows: [['a']] }]), 'invalid-value', 'fragment[0].headerRowCount')
    expectIssue(normalizeFail([{ kind: 'table', caption: '', headerRowCount: 1.5, rows: [['a']] }]), 'invalid-value', 'fragment[0].headerRowCount')
    expectIssue(normalizeFail([{ kind: 'table', caption: '', rows: [['a']], captin: 'x' }]), 'unknown-field', 'fragment[0].captin')
    expectIssue(normalizeFail([{ kind: 'table', caption: '', rows: [['a']], width: { value: 1, unit: 'cm' } }]), 'unsupported-field', 'fragment[0].width')
    expectIssue(normalizeFail([{ kind: 'table', caption: '', rows: [['a']], footnotes: [] }]), 'unsupported-field', 'fragment[0].footnotes')
  })

  it('单元格问题：类型、缺 content、colspan/rowspan 非法、header 类型、块种类受限', () => {
    const cell = (value: unknown) => normalizeFail([{ kind: 'table', caption: '', rows: [[value]] }])
    expectIssue(cell(5), 'invalid-type', 'fragment[0].rows[0][0]')
    expectIssue(cell(['a']), 'invalid-type', 'fragment[0].rows[0][0]')
    expectIssue(cell({ colspan: 2 }), 'missing-field', 'fragment[0].rows[0][0].content')
    expectIssue(cell({ content: 'a', colspan: 0 }), 'invalid-value', 'fragment[0].rows[0][0].colspan')
    expectIssue(cell({ content: 'a', rowspan: 1.5 }), 'invalid-value', 'fragment[0].rows[0][0].rowspan')
    expectIssue(cell({ content: 'a', colspan: 101 }), 'invalid-value', 'fragment[0].rows[0][0].colspan')
    expectIssue(cell({ content: 'a', header: 'yes' }), 'invalid-type', 'fragment[0].rows[0][0].header')
    expectIssue(cell({ content: 'a', width: 3 }), 'unknown-field', 'fragment[0].rows[0][0].width')
    expectIssue(cell({ content: [{ kind: 'table', caption: '', rows: [['x']] }] }), 'not-allowed-here', 'fragment[0].rows[0][0].content[0].kind')
    expectIssue(cell({ content: [{ kind: 'figure', caption: '', src: PNG_DATA_URL }] }), 'not-allowed-here', 'fragment[0].rows[0][0].content[0].kind')
    expectIssue(cell({ content: ['甲', { text: '行内' }] }), 'invalid-type', 'fragment[0].rows[0][0].content[1]')
    expectIssue(cell({ content: 7 }), 'invalid-type', 'fragment[0].rows[0][0].content')
  })

  it('网格检查：各行占用列数必须一致（含 colspan/rowspan），rowspan 不能越界，单元格不能重叠', () => {
    // 合法：表头横向合并 + 首列纵向合并
    expect(normalizeAuthoringFragment([{
      kind: 'table', caption: '', headerRowCount: 2,
      rows: [
        [{ content: 'A', rowspan: 2 }, { content: 'B', colspan: 2 }],
        ['b1', 'b2'],
        ['x', 'y', 'z'],
      ],
    }], CHAPTER).ok).toBe(true)
    // 行宽不一致
    const ragged = normalizeFail([{ kind: 'table', caption: '', rows: [['a', 'b'], ['c']] }])
    expectIssue(ragged, 'table-grid', 'fragment[0].rows[1]')
    expect(ragged[0]!.reason).toContain('第 2 行')
    // colspan 使某行更宽
    expectIssue(normalizeFail([{ kind: 'table', caption: '', rows: [['a', 'b'], [{ content: 'c', colspan: 2 }, 'd']] }]), 'table-grid', 'fragment[0].rows[1]')
    // rowspan 越过最后一行
    expectIssue(normalizeFail([{ kind: 'table', caption: '', rows: [[{ content: 'a', rowspan: 3 }, 'b'], ['c']] }]), 'table-grid', 'fragment[0].rows[0][0]')
    // 单元格与上方 rowspan 重叠：第二行 colspan=2 的格子压在被占用的第 1 列上
    const overlap = normalizeFail([{ kind: 'table', caption: '', rows: [['a', { content: 'b', rowspan: 2 }], [{ content: 'c', colspan: 2 }]] }])
    expectIssue(overlap, 'table-grid', 'fragment[0].rows[1][0]')
    // 行内格子数少但被 rowspan 补齐：合法
    expect(normalizeAuthoringFragment([{ kind: 'table', caption: '', rows: [['a', { content: 'b', rowspan: 2 }], ['c']] }], CHAPTER).ok).toBe(true)
  })

  it('网格问题的路径对应输入形态：行为 { cells } 对象时指向 cells[i]', () => {
    const issues = normalizeFail([{ kind: 'table', caption: '', rows: [{ cells: ['a', { content: 'b', rowspan: 5 }] }] }])
    expectIssue(issues, 'table-grid', 'fragment[0].rows[0].cells[1]')
  })
})

describe('normalizeAuthoringFragment / 图', () => {
  it('缺省 orientation=portrait、alt=""、notes=[]；data URL（PNG/JPEG/GIF）被接受', () => {
    const [figure] = normalizeOk([{ kind: 'figure', caption: '图题', src: PNG_DATA_URL }])
    expect(figure).toEqual({
      kind: 'figure', id: 'g1', caption: [{ text: '图题' }], orientation: 'portrait', src: PNG_DATA_URL, alt: '', notes: [],
    })
    for (const mime of ['png', 'jpeg', 'jpg', 'gif', 'PNG']) {
      expect(normalizeAuthoringFragment([{ kind: 'figure', caption: '', src: `data:image/${mime};base64,QUJD` }], CHAPTER).ok).toBe(true)
    }
    const [full] = normalizeOk([{ kind: 'figure', caption: '图', captionEn: 'Figure', orientation: 'landscape', src: PNG_DATA_URL, alt: '说明', notes: [] }]) as [{ orientation: string; alt: string; captionEn: unknown[] }]
    expect(full).toMatchObject({ orientation: 'landscape', alt: '说明', captionEn: [{ text: 'Figure' }] })
  })

  it('src 只接受图片 data URL：外链、其他类型、非 base64、坏 base64、缺失都被拒绝', () => {
    const at = (src: unknown) => normalizeFail([{ kind: 'figure', caption: '', src }])
    for (const src of [
      'https://example.com/a.png', 'http://localhost/a.png', '/a.png', 'a.png', 'file:///a.png', 'blob:abc',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/plain;base64,QUJD', 'data:image/png,rawdata', 'data:image/png;base64,',
      'data:image/png;base64,@@@@', 'data:image/png;base64,QUJDR',
    ]) {
      expectIssue(at(src), 'invalid-value', 'fragment[0].src')
    }
    expectIssue(at(5), 'invalid-type', 'fragment[0].src')
    expectIssue(normalizeFail([{ kind: 'figure', caption: '' }]), 'missing-field', 'fragment[0].src')
  })

  it('缺 caption、notes 非空、IR 暂不支持的字段、未知字段', () => {
    expectIssue(normalizeFail([{ kind: 'figure', src: PNG_DATA_URL }]), 'missing-field', 'fragment[0].caption')
    expectIssue(normalizeFail([{ kind: 'figure', caption: '', src: PNG_DATA_URL, notes: ['图中注'] }]), 'unsupported-field', 'fragment[0].notes')
    expectIssue(normalizeFail([{ kind: 'figure', caption: '', src: PNG_DATA_URL, notes: 'x' }]), 'invalid-type', 'fragment[0].notes')
    expectIssue(normalizeFail([{ kind: 'figure', caption: '', src: PNG_DATA_URL, imageWidth: { value: 1, unit: 'cm' } }]), 'unsupported-field', 'fragment[0].imageWidth')
    expectIssue(normalizeFail([{ kind: 'figure', caption: '', src: PNG_DATA_URL, size: 3 }]), 'unknown-field', 'fragment[0].size')
    expectIssue(normalizeFail([{ kind: 'figure', caption: '', src: PNG_DATA_URL, alt: 3 }]), 'invalid-type', 'fragment[0].alt')
    expectIssue(normalizeFail([{ kind: 'figure', caption: '', src: PNG_DATA_URL, orientation: 'tilted' }]), 'invalid-value', 'fragment[0].orientation')
  })
})

describe('normalizeAuthoringFragment / 公式', () => {
  it('缺省 numbered=true、whereList=[]；latex 去首尾空白', () => {
    expect(normalizeOk([{ kind: 'formula', latex: '  E=mc^2\n' }])).toEqual([
      { kind: 'formula', id: 'g1', latex: 'E=mc^2', numbered: true, whereList: [] },
    ])
  })

  it('numbered=false；whereList 补 id，term/definition 可带标记', () => {
    const [formula] = normalizeOk([{
      kind: 'formula', latex: 'x', numbered: false,
      whereList: [{ term: [{ text: 'x', marks: [{ type: 'variable' }] }], definition: '变量' }, { id: 'w2', term: 'y', definition: ['另一', '变量'] }],
    }])
    expect(formula).toEqual({
      kind: 'formula', id: 'g1', latex: 'x', numbered: false,
      whereList: [
        { id: 'g2', term: [{ text: 'x', marks: [{ type: 'variable' }] }], definition: [{ text: '变量' }] },
        { id: 'w2', term: [{ text: 'y' }], definition: [{ text: '另一变量' }] },
      ],
    })
  })

  it('latex 缺失/空/非字符串，numbered 类型，whereList 项问题，暂不支持字段', () => {
    expectIssue(normalizeFail([{ kind: 'formula' }]), 'missing-field', 'fragment[0].latex')
    expectIssue(normalizeFail([{ kind: 'formula', latex: '   ' }]), 'empty-value', 'fragment[0].latex')
    expectIssue(normalizeFail([{ kind: 'formula', latex: 5 }]), 'invalid-type', 'fragment[0].latex')
    expectIssue(normalizeFail([{ kind: 'formula', latex: 'x', numbered: 'yes' }]), 'invalid-type', 'fragment[0].numbered')
    expectIssue(normalizeFail([{ kind: 'formula', latex: 'x', whereList: 'x' }]), 'invalid-type', 'fragment[0].whereList')
    expectIssue(normalizeFail([{ kind: 'formula', latex: 'x', whereList: ['x'] }]), 'invalid-type', 'fragment[0].whereList[0]')
    expectIssue(normalizeFail([{ kind: 'formula', latex: 'x', whereList: [{ term: 'a' }] }]), 'missing-field', 'fragment[0].whereList[0].definition')
    expectIssue(normalizeFail([{ kind: 'formula', latex: 'x', whereList: [{ term: ' ', definition: 'b' }] }]), 'empty-value', 'fragment[0].whereList[0].term')
    expectIssue(normalizeFail([{ kind: 'formula', latex: 'x', whereList: [{ term: 'a', definition: 'b', unit: 'm' }] }]), 'unknown-field', 'fragment[0].whereList[0].unit')
    expectIssue(normalizeFail([{ kind: 'formula', latex: 'x', mathml: '<math/>' }]), 'unsupported-field', 'fragment[0].mathml')
    expectIssue(normalizeFail([{ kind: 'formula', latex: 'x', notes: [] }]), 'unsupported-field', 'fragment[0].notes')
  })
})

describe('normalizeAuthoringFragment / 注与示例', () => {
  it('内容可写字符串、行内数组、恰含一个 paragraph 的块数组；段落 id 派生为 <id>.p0', () => {
    for (const kind of ['note', 'example'] as const) {
      const expected = [{ kind, id: 'g1', content: [{ kind: 'paragraph', id: 'g1.p0', content: [{ text: '内容' }] }] }]
      expect(normalizeOk([{ kind, content: '内容' }])).toEqual(expected)
      expect(normalizeOk([{ kind, content: ['内容'] }])).toEqual(expected)
      expect(normalizeOk([{ kind, content: [{ text: '内容' }] }])).toEqual(expected)
      expect(normalizeOk([{ kind, content: [{ kind: 'paragraph', content: '内容' }] }])).toEqual(expected)
      expect(normalizeOk([{ kind, id: 'x', content: [{ kind: 'paragraph', id: 'x.p0', content: '内容' }] }])).toEqual([
        { kind, id: 'x', content: [{ kind: 'paragraph', id: 'x.p0', content: [{ text: '内容' }] }] },
      ])
    }
  })

  it('注/示例只能有一段：多个块、非段落块、错误的派生 id、缺 content 都被拒绝', () => {
    expectIssue(normalizeFail([{ kind: 'note', content: [{ kind: 'paragraph', content: '1' }, { kind: 'paragraph', content: '2' }] }]), 'not-allowed-here', 'fragment[0].content')
    expectIssue(normalizeFail([{ kind: 'example', content: [{ kind: 'list', items: ['x'] }] }]), 'not-allowed-here', 'fragment[0].content[0].kind')
    expectIssue(normalizeFail([{ kind: 'note', id: 'n', content: [{ kind: 'paragraph', id: 'bad', content: '1' }] }]), 'invalid-id', 'fragment[0].content[0].id')
    expectIssue(normalizeFail([{ kind: 'note' }]), 'missing-field', 'fragment[0].content')
    expectIssue(normalizeFail([{ kind: 'note', content: 5 }]), 'invalid-type', 'fragment[0].content')
    expectIssue(normalizeFail([{ kind: 'note', content: ['甲', { kind: 'paragraph', content: '乙' }] }]), 'invalid-type', 'fragment[0].content')
    expectIssue(normalizeFail([{ kind: 'note', content: '甲', title: 't' }]), 'unknown-field', 'fragment[0].title')
  })

  it('类型已由位置确定的数组里 kind 可省略，给出则必须一致', () => {
    expectIssue(normalizeFail([{ kind: 'table', caption: '', rows: [['a']], notes: [{ kind: 'example', content: '错' }] }]), 'invalid-value', 'fragment[0].notes[0].kind')
    expectIssue(normalizeFail([{ kind: 'table', caption: '', rows: [['a']], notes: [3] }]), 'invalid-type', 'fragment[0].notes[0]')
    expectIssue(normalizeFail([{ kind: 'table', caption: '', rows: [['a']], notes: '注' }]), 'invalid-type', 'fragment[0].notes')
  })
})

describe('normalizeAuthoringFragment / 条', () => {
  it('level 由插入位置推导：章/附录下为 1，L 级条下为 L+1，逐层递增', () => {
    const tree = [{ kind: 'clause', title: 'a', children: [{ kind: 'clause', title: 'b', children: [{ kind: 'clause', title: 'c' }] }] }]
    const levels = (context: AuthoringContext) => {
      const [a] = normalizeOk(tree, context) as [{ level: number; children: [{ level: number; children: [{ level: number }] }] }]
      return [a.level, a.children[0].level, a.children[0].children[0].level]
    }
    expect(levels({ parent: 'chapter' })).toEqual([1, 2, 3])
    expect(levels({ parent: 'appendix' })).toEqual([1, 2, 3])
    expect(levels({ parent: 'clause', level: 1 })).toEqual([2, 3, 4])
    expect(levels({ parent: 'clause', level: 2 })).toEqual([3, 4, 5])
  })

  it('超出 5 级的嵌套被拒绝，并提示已达最大层级', () => {
    const issues = normalizeFail([{ kind: 'clause', title: 'a', children: [{ kind: 'clause', title: 'b', children: [{ kind: 'clause', title: 'c' }] }] }], { parent: 'clause', level: 3 })
    expect(issues).toHaveLength(1)
    const issue = expectIssue(issues, 'not-allowed-here', 'fragment[0].children[0].children[0].kind')
    expect(issue.reason).toContain('最大层级')
  })

  it('显式 level 与推导值一致时通过，不一致报 level-mismatch（路径指向 level）', () => {
    expect(normalizeAuthoringFragment([{ kind: 'clause', level: 3, title: 'x' }], { parent: 'clause', level: 2 }).ok).toBe(true)
    const issues = normalizeFail([{ kind: 'clause', level: 3, title: 'x', children: [{ kind: 'clause', level: 2, title: 'y' }] }], { parent: 'clause', level: 1 })
    const mismatch = expectIssue(issues, 'level-mismatch', 'fragment[0].level')
    expect(mismatch.reason).toContain('应为 2')
    expectIssue(issues, 'level-mismatch', 'fragment[0].children[0].level')
    expectIssue(normalizeFail([{ kind: 'clause', level: '1', title: 'x' }]), 'level-mismatch', 'fragment[0].level')
  })

  it('titled 缺省为「标题非空」；无题条 title 为 []；空白标题视为无题', () => {
    const [titled, untitled, blank] = normalizeOk([
      { kind: 'clause', title: '有题' }, { kind: 'clause' }, { kind: 'clause', title: '   ' },
    ]) as { titled: boolean; title: unknown[] }[]
    expect(titled).toMatchObject({ titled: true, title: [{ text: '有题' }] })
    expect(untitled).toMatchObject({ titled: false, title: [] })
    expect(blank).toMatchObject({ titled: false, title: [] })
    const [explicit] = normalizeOk([{ kind: 'clause', titled: false }]) as { titled: boolean }[]
    expect(explicit!.titled).toBe(false)
  })

  it('titled 与 title 矛盾：titled=false 带标题、titled=true 无标题；类型错误', () => {
    expectIssue(normalizeFail([{ kind: 'clause', titled: false, title: '有标题' }]), 'invalid-value', 'fragment[0].titled')
    expectIssue(normalizeFail([{ kind: 'clause', titled: true }]), 'empty-value', 'fragment[0].titled')
    expectIssue(normalizeFail([{ kind: 'clause', titled: true, title: ' ' }]), 'empty-value', 'fragment[0].titled')
    expectIssue(normalizeFail([{ kind: 'clause', titled: 'yes', title: 'x' }]), 'invalid-type', 'fragment[0].titled')
  })

  it('children 缺省 []；子节点按条的层级检查；children 类型错误', () => {
    const [clause] = normalizeOk([{ kind: 'clause', title: 'x' }]) as { children: unknown[] }[]
    expect(clause!.children).toEqual([])
    expectIssue(normalizeFail([{ kind: 'clause', title: 'x', children: 'text' }]), 'invalid-type', 'fragment[0].children')
    expectIssue(normalizeFail([{ kind: 'clause', title: 'x', children: [{ kind: 'bibEntry', content: 'x' }] }]), 'not-allowed-here', 'fragment[0].children[0].kind')
    expectIssue(normalizeFail([{ kind: 'clause', title: 'x', chidren: [] }]), 'unknown-field', 'fragment[0].chidren')
  })

  it('children 中的字符串是段落，嵌套节点的问题带完整路径', () => {
    const [clause] = normalizeOk([{ kind: 'clause', title: 'x', children: ['正文', { kind: 'note', content: '注' }] }]) as { children: { kind: string }[] }[]
    expect(clause!.children.map(child => child.kind)).toEqual(['paragraph', 'note'])
    expectIssue(normalizeFail([{ kind: 'clause', title: 'x', children: [{ kind: 'clause', title: 'y', children: [{ kind: 'list', items: [] }] }] }]),
      'empty-value', 'fragment[0].children[0].children[0].items')
  })
})

describe('normalizeAuthoringFragment / 术语条目', () => {
  it('缺省值与层级推导；term/definition/source 为行内内容', () => {
    expect(normalizeOk([{
      kind: 'termEntry', term: '标准化', termEn: 'standardization', definition: '为了……的活动', source: 'GB/T 20000.1—2014，2.1.1',
    }])).toEqual([{
      kind: 'termEntry', id: 'g1', level: 1, term: [{ text: '标准化' }], termEn: [{ text: 'standardization' }],
      definition: [{ kind: 'paragraph', id: 'g2', content: [{ text: '为了……的活动' }] }],
      source: [{ text: 'GB/T 20000.1—2014，2.1.1' }], notes: [], examples: [],
    }])
    const [nested] = normalizeOk([{ kind: 'termEntry', term: 'a', definition: 'b' }], { parent: 'clause', level: 2 }) as { level: number }[]
    expect(nested!.level).toBe(3)
  })

  it('定义可写字符串、段落字符串数组、行内片段数组或段落对象数组', () => {
    const definition = (value: unknown) => (normalizeOk([{ kind: 'termEntry', term: 't', definition: value }])[0] as { definition: { kind: string; id: string; content: unknown[] }[] }).definition
    expect(definition('一段').map(block => block.content)).toEqual([[{ text: '一段' }]])
    expect(definition(['一段', '二段']).map(block => block.content)).toEqual([[{ text: '一段' }], [{ text: '二段' }]])
    expect(definition([{ text: '加粗', marks: [{ type: 'bold' }] }, { text: '尾' }]).map(block => block.content))
      .toEqual([[{ text: '加粗', marks: [{ type: 'bold' }] }, { text: '尾' }]])
    expect(definition([{ kind: 'paragraph', id: 'dp', content: '甲' }, '乙'])[0]!.id).toBe('dp')
  })

  it('notes / examples 缺省 []，元素可写字符串；termEn 空白时省略；level 显式值原样保留', () => {
    const [term] = normalizeOk([{
      kind: 'termEntry', term: 't', termEn: ' ', definition: 'd', notes: ['注一', '注二'], examples: ['例'], level: 3,
    }]) as { termEn?: unknown; notes: { kind: string }[]; examples: { kind: string }[]; level: number }[]
    expect(term).not.toHaveProperty('termEn')
    expect(term!.notes.map(note => note.kind)).toEqual(['note', 'note'])
    expect(term!.examples.map(example => example.kind)).toEqual(['example'])
    expect(term!.level).toBe(3)
  })

  it('问题：术语/定义缺失或为空、定义含非段落块、以「[来源」开头的后续定义段、level 非法、暂不支持字段', () => {
    expectIssue(normalizeFail([{ kind: 'termEntry', definition: 'd' }]), 'missing-field', 'fragment[0].term')
    expectIssue(normalizeFail([{ kind: 'termEntry', term: ' ', definition: 'd' }]), 'empty-value', 'fragment[0].term')
    expectIssue(normalizeFail([{ kind: 'termEntry', term: 't' }]), 'missing-field', 'fragment[0].definition')
    expectIssue(normalizeFail([{ kind: 'termEntry', term: 't', definition: '' }]), 'empty-value', 'fragment[0].definition')
    expectIssue(normalizeFail([{ kind: 'termEntry', term: 't', definition: [] }]), 'empty-value', 'fragment[0].definition')
    expectIssue(normalizeFail([{ kind: 'termEntry', term: 't', definition: [{ kind: 'list', items: ['x'] }] }]), 'not-allowed-here', 'fragment[0].definition[0].kind')
    expectIssue(normalizeFail([{ kind: 'termEntry', term: 't', definition: ['定义', '[来源：GB/T 1.1]'] }]), 'invalid-value', 'fragment[0].definition[1]')
    expectIssue(normalizeFail([{ kind: 'termEntry', term: 't', definition: ['定义', '［来源：GB/T 1.1］'] }]), 'invalid-value', 'fragment[0].definition[1]')
    expectIssue(normalizeFail([{ kind: 'termEntry', term: 't', definition: 'd', level: 6 }]), 'invalid-value', 'fragment[0].level')
    expectIssue(normalizeFail([{ kind: 'termEntry', term: 't', definition: 'd', nestedEntries: [] }]), 'unsupported-field', 'fragment[0].nestedEntries')
    expectIssue(normalizeFail([{ kind: 'termEntry', term: 't', definition: 'd', languageSets: [] }]), 'unsupported-field', 'fragment[0].languageSets')
    expectIssue(normalizeFail([{ kind: 'termEntry', term: 't', definition: 'd', defintion: 'x' }]), 'unknown-field', 'fragment[0].defintion')
    // 主定义可以以「[来源」开头之外的任意文字开头；只有后续段会被误读为来源
    expect(normalizeAuthoringFragment([{ kind: 'termEntry', term: 't', definition: '[来源不明的主定义' }], CHAPTER).ok).toBe(true)
  })
})

describe('normalizeAuthoringFragment / 章与附录', () => {
  const BODY: AuthoringContext = { parent: 'body' }

  it('secType 缺省按标题推断：范围/规范性引用文件/术语和定义，其余 general', () => {
    const secTypes = (titles: unknown[]) =>
      (normalizeOk(titles.map(title => ({ kind: 'chapter', title })), BODY) as { secType: string }[]).map(chapter => chapter.secType)
    expect(secTypes(['范围', '规范性引用文件', '术语和定义', '技术要求', ' 范围 ', '范围和目的', '术语', ''.padEnd(1, '章')]))
      .toEqual(['scope', 'norm-refs', 'terms', 'general', 'scope', 'general', 'general', 'general'])
    expect(secTypes([[{ text: '范', marks: [{ type: 'bold' }] }, { text: '围' }]])).toEqual(['scope'])
  })

  it('显式 secType 优先于推断；非法值被拒绝', () => {
    const [chapter] = normalizeOk([{ kind: 'chapter', title: '范围', secType: 'general' }], BODY) as { secType: string }[]
    expect(chapter!.secType).toBe('general')
    const [terms] = normalizeOk([{ kind: 'chapter', title: '词汇', secType: 'terms' }], BODY) as { secType: string }[]
    expect(terms!.secType).toBe('terms')
    expectIssue(normalizeFail([{ kind: 'chapter', title: '范围', secType: 'foreword' }], BODY), 'invalid-value', 'fragment[0].secType')
  })

  it('章标题必填且非空；children 缺省 []；子节点为 1 级条', () => {
    expectIssue(normalizeFail([{ kind: 'chapter' }], BODY), 'missing-field', 'fragment[0].title')
    expectIssue(normalizeFail([{ kind: 'chapter', title: '  ' }], BODY), 'empty-value', 'fragment[0].title')
    const [chapter] = normalizeOk([{ kind: 'chapter', title: '章', children: [{ kind: 'clause', title: '条' }, '正文'] }], BODY) as {
      children: { kind: string; level?: number }[]
    }[]
    expect(chapter!.children[0]).toMatchObject({ kind: 'clause', level: 1 })
    expect(normalizeOk([{ kind: 'chapter', title: '章' }], BODY)).toEqual([
      { kind: 'chapter', id: 'g1', secType: 'general', title: [{ text: '章' }], children: [] },
    ])
  })

  it('附录：normative 缺省 false；children 为 1 级条；标题必填', () => {
    const [plain, normative] = normalizeOk([
      { kind: 'appendix', title: '资料' }, { kind: 'appendix', title: '规范', normative: true, children: [{ kind: 'clause', title: '条' }] },
    ], { parent: 'appendices' }) as { normative: boolean; children: { level?: number }[] }[]
    expect(plain!.normative).toBe(false)
    expect(normative!.normative).toBe(true)
    expect(normative!.children[0]!.level).toBe(1)
    expectIssue(normalizeFail([{ kind: 'appendix' }], { parent: 'appendices' }), 'missing-field', 'fragment[0].title')
    expectIssue(normalizeFail([{ kind: 'appendix', title: ' ' }], { parent: 'appendices' }), 'empty-value', 'fragment[0].title')
    expectIssue(normalizeFail([{ kind: 'appendix', title: 'x', normative: 'true' }], { parent: 'appendices' }), 'invalid-type', 'fragment[0].normative')
  })

  it('章内的问题带完整路径', () => {
    const issues = normalizeFail([{ kind: 'chapter', title: '章', children: [{ kind: 'clause', level: 2, title: '跳级' }, { kind: 'paragraph' }] }], BODY)
    expectIssue(issues, 'level-mismatch', 'fragment[0].children[0].level')
    expectIssue(issues, 'missing-field', 'fragment[0].children[1].content')
  })

  it('与 pmToIr 的 secType 推断一致（对拍）', () => {
    const titles = ['范围', '规范性引用文件', '术语和定义', '技术要求', ' 范围 ', '范围和目的', '术语']
    const fromPm = pmToIr({
      type: 'doc',
      content: titles.map((title, index) => ({
        type: 'chapter', attrs: { nodeId: `c${index}` },
        content: [{ type: 'chapterTitle', content: [{ type: 'text', text: title }] }, { type: 'stdParagraph', attrs: { nodeId: `p${index}` }, content: [{ type: 'text', text: 'x' }] }],
      })),
    }).doc.body.map(chapter => chapter.secType)
    const fromAuthoring = (normalizeOk(titles.map(title => ({ kind: 'chapter', title })), BODY) as { secType: string }[]).map(chapter => chapter.secType)
    expect(fromAuthoring).toEqual(fromPm)
  })
})

describe('normalizeAuthoringFragment / 参考文献', () => {
  const BIB: AuthoringContext = { parent: 'bibliography' }

  it('条目可写字符串或 { content }；id 补齐', () => {
    expect(normalizeOk(['GB/T 1.1—2020', { kind: 'bibEntry', id: 'b2', content: [{ text: '书名', marks: [{ type: 'italic' }] }] }], BIB)).toEqual([
      { kind: 'bibEntry', id: 'g1', content: [{ text: 'GB/T 1.1—2020' }] },
      { kind: 'bibEntry', id: 'b2', content: [{ text: '书名', marks: [{ type: 'italic' }] }] },
    ])
  })

  it('条目内容必填且非空；其他块不能放在参考文献里；暂不支持字段', () => {
    expectIssue(normalizeFail([''], BIB), 'empty-value', 'fragment[0]')
    expectIssue(normalizeFail([{ kind: 'bibEntry' }], BIB), 'missing-field', 'fragment[0].content')
    expectIssue(normalizeFail([{ kind: 'bibEntry', content: ' ' }], BIB), 'empty-value', 'fragment[0].content')
    expectIssue(normalizeFail([{ kind: 'paragraph', content: 'x' }], BIB), 'not-allowed-here', 'fragment[0].kind')
    expectIssue(normalizeFail([{ kind: 'bibEntry', content: 'x', entryType: 'book' }], BIB), 'unsupported-field', 'fragment[0].entryType')
    expectIssue(normalizeFail([{ kind: 'bibEntry', content: 'x', author: 'y' }], BIB), 'unknown-field', 'fragment[0].author')
  })
})

describe('normalizeAuthoringFragment / 不动点', () => {
  it('归一化结果再次归一化得到相同结果（以自身 id 为准，已有 id 集合为空）', () => {
    const inputs: [unknown, AuthoringContext][] = [
      [[
        '段落', { kind: 'list', listType: 'number', items: ['a', { content: ['b'] }] },
        { kind: 'table', caption: '表', captionEn: 'T', rows: [['a', { content: 'b', colspan: 1 }], [{ content: ['x', 'y'] }, '']], notes: ['n'] },
        { kind: 'figure', caption: '图', src: PNG_DATA_URL },
        { kind: 'formula', latex: 'x', whereList: [{ term: 'x', definition: 'y' }] },
        { kind: 'note', content: [{ text: 'a\nb' }] }, { kind: 'example', content: 'e' },
        { kind: 'clause', title: 't', children: ['c', { kind: 'termEntry', term: 'a', definition: ['d1', 'd2'], source: 's', notes: ['n'], examples: ['e'] }] },
        { kind: 'clause' },
      ], { parent: 'chapter' }],
      [[{ kind: 'chapter', title: '范围', children: ['x'] }], { parent: 'body' }],
      [[{ kind: 'appendix', title: 'x', normative: true, children: [{ kind: 'clause', title: 'y' }] }], { parent: 'appendices' }],
      [['文献', { kind: 'bibEntry', content: '文献2' }], { parent: 'bibliography' }],
    ]
    for (const [input, context] of inputs) {
      const first = normalizeOk(input, context)
      const second = normalizeOk(first, context, { generateId: () => { throw new Error('不应再生成 id') } })
      expect(second).toEqual(first)
      expect(JSON.parse(JSON.stringify(first))).toEqual(first) // IR 可 JSON 往返
    }
  })
})
