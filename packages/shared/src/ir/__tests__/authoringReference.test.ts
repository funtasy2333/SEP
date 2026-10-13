/**
 * 写作说明文档（docs/wp9-authoring-reference.md）与实现的一致性：
 * 文档里的每个示例、上下文表、字段表、问题代码表、标记表都由本测试对着实现校验。
 * 文档是 WP9.3 `get_authoring_reference` 的唯一来源，改一边必须改另一边。
 */
import { describe, expect, it } from 'vitest'
// 通过 Vite 的 ?raw 读取文档文本：不引入任何 Node API（shared 的测试同样遵守不变式 1）
import reference from '../../../../../docs/wp9-authoring-reference.md?raw'
import {
  AUTHORING_ISSUE_CODES, AUTHORING_MARK_TYPES, AUTHORING_NODE_FIELDS, AUTHORING_NODE_KINDS,
  normalizeAuthoringFragment, type AuthoringNodeKind,
} from '../authoring'
import { fragmentContextRules, type AuthoringContext } from '../fragmentContext'
import { irFragmentToPm } from '../irToPm'
import { EXPECTED_ALLOWED, MINIMAL, pmRoundTrip, seqIds } from './authoringHelpers'

const markdown: string = reference

interface Example {
  index: number
  line: number
  context: AuthoringContext
  contextName: string
  json: unknown
  expectError?: { code: string; path: string }
}

function parseContext(name: string): AuthoringContext {
  if (name.startsWith('clause:')) return { parent: 'clause', level: Number(name.slice(7)) as 1 | 2 | 3 | 4 | 5 }
  return { parent: name } as AuthoringContext
}

function parseExamples(text: string): Example[] {
  const examples: Example[] = []
  const pattern = /^```json ses-example([^\n]*)\n([\s\S]*?)\n```$/gm
  for (const match of text.matchAll(pattern)) {
    const attrs = Object.fromEntries(
      match[1]!.trim().split(/\s+/).filter(Boolean).map(token => {
        const at = token.indexOf('=')
        return [token.slice(0, at), token.slice(at + 1)]
      }),
    ) as Record<string, string>
    const line = text.slice(0, match.index).split('\n').length
    expect(attrs.context, `第 ${line} 行的示例缺少 context=`).toBeTruthy()
    const example: Example = {
      index: examples.length, line, context: parseContext(attrs.context!), contextName: attrs.context!,
      json: JSON.parse(match[2]!),
    }
    if (attrs.expect === 'error') {
      expect(attrs.code && attrs.path, `第 ${line} 行的错误示例需要 code= 与 path=`).toBeTruthy()
      example.expectError = { code: attrs.code!, path: attrs.path! }
    } else {
      expect(attrs.expect ?? 'ok', `第 ${line} 行 expect 只能是 error`).toBe('ok')
    }
    examples.push(example)
  }
  return examples
}

/** 解析 Markdown 表格行（跳过表头与分隔行），返回各行的单元格文本。 */
function tableRows(lines: string[]): string[][] {
  return lines
    .filter(line => line.startsWith('|'))
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
    .filter(cells => cells.length > 0 && !cells.every(cell => /^-+$/.test(cell)))
    .slice(1) // 表头
}

function sectionLines(heading: RegExp): string[] {
  const lines = markdown.split('\n')
  const start = lines.findIndex(line => heading.test(line))
  expect(start, `找不到章节 ${heading}`).toBeGreaterThanOrEqual(0)
  const level = lines[start]!.match(/^#+/)![0].length
  const end = lines.findIndex((line, index) => index > start && /^#+ /.test(line) && line.match(/^#+/)![0].length <= level)
  return lines.slice(start + 1, end === -1 ? undefined : end)
}

const backticks = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map(match => match[1]!)

const examples = parseExamples(markdown)

describe('写作说明文档 / 示例', () => {
  it('文档包含示例，且上下文名称都有效', () => {
    expect(examples.length).toBeGreaterThanOrEqual(15)
    expect(examples.some(example => example.expectError)).toBe(true)
  })

  const valid = examples.filter(example => !example.expectError)
  const invalid = examples.filter(example => example.expectError)

  for (const example of valid) {
    it(`第 ${example.line} 行（${example.contextName}）：归一化、投影、往返读回均通过`, () => {
      const result = normalizeAuthoringFragment(example.json, example.context, { generateId: seqIds('doc') })
      if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2))
      const pm = irFragmentToPm(result.nodes, example.context)
      expect(pmRoundTrip(pm, example.context)).toEqual(result.nodes)
    })
  }

  for (const example of invalid) {
    it(`第 ${example.line} 行（${example.contextName}）：产生 ${example.expectError!.code} @ ${example.expectError!.path}`, () => {
      const result = normalizeAuthoringFragment(example.json, example.context, { generateId: seqIds('doc') })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.issues).toContainEqual(expect.objectContaining(example.expectError!))
      }
    })
  }

  it('正例覆盖全部可写节点种类、全部上下文（条至少覆盖 1 个层级）、全部标记类型', () => {
    const kinds = new Set<string>()
    const marks = new Set<string>()
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>
        if (typeof record.kind === 'string') kinds.add(record.kind)
        Object.values(record).forEach(walk)
      }
    }
    const collectMarks = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(collectMarks)
      else if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>
        if (Array.isArray(record.marks)) for (const mark of record.marks as { type: string }[]) marks.add(mark.type)
        Object.values(record).forEach(collectMarks)
      }
    }
    // 字符串简写（段落 / 文献条目）不带 kind：由归一化结果补全后统计
    for (const example of valid) {
      const result = normalizeAuthoringFragment(example.json, example.context, { generateId: seqIds('cov') })
      if (result.ok) walk(result.nodes)
      collectMarks(example.json)
    }
    for (const kind of AUTHORING_NODE_KINDS) expect(kinds.has(kind), `没有 ${kind} 的正例`).toBe(true)
    for (const type of AUTHORING_MARK_TYPES) expect(marks.has(type), `没有 ${type} 标记的正例`).toBe(true)
    const parents = new Set(valid.map(example => example.context.parent))
    for (const parent of ['foreword', 'introduction', 'body', 'chapter', 'clause', 'appendices', 'appendix', 'bibliography']) {
      expect(parents.has(parent as never), `没有 ${parent} 上下文的正例`).toBe(true)
    }
  })
})

describe('写作说明文档 / 上下文表', () => {
  it('每一行的父节点、层级范围、允许的 kind 与实现（规则函数与归一化结果）一致', () => {
    const rows = tableRows(sectionLines(/^## 3\./))
      .filter(cells => cells.length === 4 && cells[0]!.startsWith('`'))
    expect(rows.length).toBe(9)
    const covered = new Set<string>()
    for (const [first, , allowedCell, levelCell] of rows) {
      const parent = backticks(first!)[0]!
      const range = first!.match(/level\s*(\d)(?:\s*~\s*(\d))?/)
      const levels = parent === 'clause'
        ? Array.from({ length: Number(range![2] ?? range![1]) - Number(range![1]) + 1 }, (_, index) => Number(range![1]) + index)
        : [undefined]
      const documented = backticks(allowedCell!)
      for (const level of levels) {
        const context = (parent === 'clause' ? { parent, level } : { parent }) as AuthoringContext
        const name = parent === 'clause' ? `clause:${level}` : parent
        covered.add(name)
        expect([...documented].sort(), `${name} 的允许 kind`).toEqual([...EXPECTED_ALLOWED[name]!].sort())
        const rules = fragmentContextRules(context)
        // 子条/术语条目的层级列：— 表示不允许，1 表示固定为 1，level+1 表示父条层级加 1
        const documentedLevel = levelCell!.replace(/\s/g, '')
        if (documentedLevel === '—') expect(rules.childLevel).toBeUndefined()
        else if (documentedLevel === '1') expect(rules.childLevel).toBe(1)
        else {
          expect(documentedLevel).toBe('level+1')
          expect(rules.childLevel).toBe((level as number) + 1)
        }
        // 与归一化行为一致
        for (const kind of AUTHORING_NODE_KINDS) {
          const result = normalizeAuthoringFragment([MINIMAL[kind]], context, { generateId: seqIds('ctx') })
          expect(result.ok, `${name} × ${kind}`).toBe(documented.includes(kind))
        }
      }
    }
    expect([...covered].sort()).toEqual(Object.keys(EXPECTED_ALLOWED).sort())
  })
})

describe('写作说明文档 / 字段表', () => {
  const kindOfSection = (heading: string): AuthoringNodeKind[] =>
    backticks(heading).filter((name): name is AuthoringNodeKind => (AUTHORING_NODE_KINDS as readonly string[]).includes(name))

  const headings = markdown.split('\n').filter(line => /^### 4\.\d+ /.test(line))

  it('4.1~4.11 每个节点种类都有字段表', () => {
    expect(headings.map(kindOfSection).flat().sort()).toEqual([...AUTHORING_NODE_KINDS].sort())
  })

  for (const heading of headings) {
    const kinds = kindOfSection(heading)
    describe(heading.replace(/^### /, ''), () => {
      const rows = tableRows(sectionLines(new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)))
        .filter(cells => cells.length === 4 && cells[0]!.startsWith('`'))
      const fields = rows.map(cells => backticks(cells[0]!)[0]!)

      it('字段名与实现支持的顶层字段一致（不含 kind、id）', () => {
        for (const kind of kinds) {
          const implemented = AUTHORING_NODE_FIELDS[kind].filter(name => name !== 'kind' && name !== 'id')
          expect([...fields].sort(), kind).toEqual([...implemented].sort())
        }
      })

      it('「必填」列：必填字段缺失即 missing-field，且最小示例本身通过', () => {
        for (const kind of kinds) {
          const context = (['chapter', 'appendix', 'bibEntry'].includes(kind)
            ? { parent: kind === 'chapter' ? 'body' : kind === 'appendix' ? 'appendices' : 'bibliography' }
            : { parent: 'chapter' }) as AuthoringContext
          const minimal = MINIMAL[kind] as Record<string, unknown>
          expect(normalizeAuthoringFragment([minimal], context).ok).toBe(true)
          for (const cells of rows) {
            const field = backticks(cells[0]!)[0]!
            const required = cells[1] === '是'
            expect(['是', '否']).toContain(cells[1])
            if (required) {
              expect(field in minimal, `${kind} 的最小示例应包含必填字段 ${field}`).toBe(true)
              const { [field]: _removed, ...rest } = minimal
              const result = normalizeAuthoringFragment([rest], context)
              expect(result.ok).toBe(false)
              if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing-field', path: `fragment[0].${field}` }))
            }
          }
        }
      })

      it('「缺省」列写成单个字面量时，与归一化补齐的值一致', () => {
        for (const kind of kinds) {
          const context = (['chapter', 'appendix', 'bibEntry'].includes(kind)
            ? { parent: kind === 'chapter' ? 'body' : kind === 'appendix' ? 'appendices' : 'bibliography' }
            : { parent: 'chapter' }) as AuthoringContext
          const result = normalizeAuthoringFragment([MINIMAL[kind]], context, { generateId: seqIds('def') })
          expect(result.ok).toBe(true)
          if (!result.ok) return
          const node = result.nodes[0] as unknown as Record<string, unknown>
          for (const cells of rows) {
            const literal = cells[2]!.match(/^`([^`]*)`$/)
            if (!literal) continue
            const field = backticks(cells[0]!)[0]!
            let expected: unknown
            try { expected = JSON.parse(literal[1]!) } catch { expected = literal[1] }
            expect(node[field], `${kind}.${field} 的缺省`).toEqual(expected)
          }
        }
      })
    })
  }
})

describe('写作说明文档 / 问题代码与标记', () => {
  it('第 5 节的问题代码表与实现的代码清单一一对应', () => {
    const codes = tableRows(sectionLines(/^## 5\./))
      .filter(cells => cells.length === 2 && cells[0]!.startsWith('`'))
      .map(cells => backticks(cells[0]!)[0]!)
    expect([...codes].sort()).toEqual([...AUTHORING_ISSUE_CODES].sort())
  })

  it('第 2.2 节的标记表覆盖全部支持的标记类型，且不含不支持的类型', () => {
    const documented = tableRows(sectionLines(/^### 2\.2 /))
      .filter(cells => cells.length === 3)
      .flatMap(cells => backticks(cells[0]!))
    expect([...documented].sort()).toEqual([...AUTHORING_MARK_TYPES].sort())
  })

  it('文档声明的暂不支持项确实被拒绝', () => {
    const rejected = (kind: string, extra: Record<string, unknown>) => normalizeAuthoringFragment(
      [{ ...(MINIMAL[kind as AuthoringNodeKind] as object), ...extra }], { parent: 'chapter' })
    expect(rejected('paragraph', { content: [{ text: 'x', style: { color: 'red' } }] }).ok).toBe(false)
    expect(rejected('paragraph', { content: [{ text: 'x', formula: { id: 'f' } }] }).ok).toBe(false)
    expect(rejected('paragraph', { content: [{ text: 'x', footnote: { id: 'f', content: [] } }] }).ok).toBe(false)
    expect(rejected('paragraph', { content: [{ text: 'x', marks: [{ type: 'tableFootnoteRef', targetId: 't' }] }] }).ok).toBe(false)
    for (const kind of ['warning', 'quote', 'code']) {
      expect(normalizeAuthoringFragment([{ kind, content: [] }], { parent: 'chapter' }).ok).toBe(false)
    }
    expect(rejected('list', { listType: 'roman' }).ok).toBe(false)
  })
})
