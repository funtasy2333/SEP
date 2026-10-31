import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { parseXml46687 } from '../parse'
import type { XmlDocument, XmlElement } from '../tree'
import { mapXml46687 } from './facade'
import { validateXml46687 } from './validate'

const minimal = readFileSync(resolve(process.cwd(), '../../schemas/gbt46687.2/samples/valid/01-minimal.xml'), 'utf8')

function prepare(source: string): { tree: XmlDocument; options: { nodeIdsByPath: Map<string, string>; resources: Map<string, { src: string; mediaType: string }> } } {
  const parsed = parseXml46687(source)
  expect(parsed.problems).toEqual([])
  const tree = parsed.tree!
  const nodeIdsByPath = new Map<string, string>()
  const visit = (element: XmlElement) => {
    nodeIdsByPath.set(element.position!.path, `id${nodeIdsByPath.size}`)
    for (const child of element.children) if (child.type === 'element') visit(child)
  }
  visit(tree.root)
  return { tree, options: { nodeIdsByPath, resources: new Map() } }
}

it('[M-4.3.2-15] [M-4.3.2-16] [M-4.3.2-17] [M-4.3.2-18] [M-G-03] [M-4.3.2-14] 无法保真的重复元数据在第二项定位并阻断映射', () => {
  const addition = [
    '      <comm-ref>委员会甲</comm-ref>',
    '      <comm-ref>委员会乙</comm-ref>',
    '      <permissions>',
    '        <copyright-statement>声明甲</copyright-statement>',
    '        <copyright-statement>声明乙</copyright-statement>',
    '        <copyright-year>2025</copyright-year>',
    '        <copyright-year>2026</copyright-year>',
    '        <copyright-holder>甲</copyright-holder>',
    '        <copyright-holder>乙</copyright-holder>',
    '      </permissions>',
    '      <custom-meta-group>',
    '        <custom-meta><meta-name>proposer</meta-name><meta-value>机构甲</meta-value></custom-meta>',
    '        <custom-meta><meta-name>proposer</meta-name><meta-value>机构乙</meta-value></custom-meta>',
    '        <custom-meta><meta-name>price-ref-pages</meta-name><meta-value>8</meta-value></custom-meta>',
    '        <custom-meta><meta-name>price-ref-pages</meta-name><meta-value>9</meta-value></custom-meta>',
    '      </custom-meta-group>',
  ].join('\n')
  const source = minimal.replace('    </std-meta>', `${addition}\n    </std-meta>`)
  const { tree, options } = prepare(source)

  expect(validateXml46687(tree).problems.filter(problem => problem.severity === 'error')).toEqual([])

  const result = mapXml46687(tree, options)
  expect(result.ir).toBeNull()
  const errors = result.problems.filter(problem => problem.severity === 'error')
  const bySourceLocation = [...errors].sort((left, right) => (left.xml?.line ?? 0) - (right.xml?.line ?? 0))
  expect(bySourceLocation.map(problem => [problem.code, problem.xml?.path])).toEqual([
    ['xml-content-model', '/standard[1]/front[1]/std-meta[1]/comm-ref[2]'],
    ['xml-content-model', '/standard[1]/front[1]/std-meta[1]/permissions[1]/copyright-statement[2]'],
    ['xml-content-model', '/standard[1]/front[1]/std-meta[1]/permissions[1]/copyright-year[2]'],
    ['xml-content-model', '/standard[1]/front[1]/std-meta[1]/permissions[1]/copyright-holder[2]'],
    ['xml-content-model', '/standard[1]/front[1]/std-meta[1]/custom-meta-group[1]/custom-meta[2]'],
    ['xml-content-model', '/standard[1]/front[1]/std-meta[1]/custom-meta-group[1]/custom-meta[4]'],
  ])
  expect(bySourceLocation.map(problem => problem.xml?.line)).toEqual([13, 16, 18, 20, 24, 26])
  expect(bySourceLocation.every(problem => problem.message.includes('重复') && problem.message.includes('无法保真'))).toBe(true)
})

it('[M-4.3.2-15] [M-4.3.2-16] [M-4.3.2-17] [M-4.3.2-18] [M-G-03] [M-4.3.2-14] 单值版权与委员会及不同自定义字段原样保留', () => {
  const addition = [
    '      <comm-ref>SAC/TC 1</comm-ref>',
    '      <permissions>',
    '        <copyright-statement>版权声明</copyright-statement>',
    '        <copyright-year>2026</copyright-year>',
    '        <copyright-holder>持有人</copyright-holder>',
    '      </permissions>',
    '      <custom-meta-group>',
    '        <custom-meta><meta-name>proposer</meta-name><meta-value>提案单位</meta-value></custom-meta>',
    '        <custom-meta><meta-name>applicant</meta-name><meta-value>申请单位</meta-value></custom-meta>',
    '        <custom-meta><meta-name>price-ref-pages</meta-name><meta-value>8</meta-value></custom-meta>',
    '        <custom-meta><meta-name>issue-date</meta-name><meta-value>2014-12-31</meta-value></custom-meta>',
    '        <custom-meta><meta-name>constructor</meta-name><meta-value>未知字段</meta-value></custom-meta>',
    '      </custom-meta-group>',
  ].join('\n')
  const source = minimal.replace('    </std-meta>', `${addition}\n    </std-meta>`)
  const { tree, options } = prepare(source)

  expect(validateXml46687(tree).problems.filter(problem => problem.severity === 'error')).toEqual([])

  const result = mapXml46687(tree, options)
  expect(result.ir).not.toBeNull()
  expect(result.ir?.meta).toMatchObject({
    technicalCommittee: 'SAC/TC 1',
    copyrights: [{ statement: [{ text: '版权声明' }], year: '2026', holder: [{ text: '持有人' }] }],
    proposer: '提案单位',
    applicant: '申请单位',
  })
  expect(result.problems.filter(problem => problem.severity === 'error')).toEqual([])
  expect(result.problems.filter(problem => problem.severity === 'warning' && problem.message.includes('自定义元数据')).length).toBe(3)
})
