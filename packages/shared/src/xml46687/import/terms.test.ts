import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { mapReferenceInline } from './refs'
import { parseXml46687 } from '../parse'
import type { XmlElement } from '../tree'
import { createImportContext } from './context'
import { mapCoreInline } from './inline'
import { mapTerm } from './terms'

it('[M-9.2.1-06] [M-9.2.3-01] [M-9.2.9-01] 保留多语言、术语变体、描述符和条目级领域', () => {
  const tree = parseXml46687('<term-sec xmlns:t="urn:iso:std:iso:30042:ed-1"><label>3.1</label><t:termEntry id="term"><t:langSet xml:lang="zh"><t:subjectField>领域</t:subjectField><t:definition>定义</t:definition><t:source>来源</t:source><t:tig><t:term>甲</t:term><t:partOfSpeech value="noun"/></t:tig><t:tig><t:term>乙</t:term></t:tig></t:langSet><t:langSet xml:lang="en"><t:tig><t:term>alpha</t:term><t:normativeAuthentication value="preferredTerm"/></t:tig></t:langSet></t:termEntry></term-sec>').tree!
  const ids = new Map<string, string>()
  const visit = (e: XmlElement) => { ids.set(e.position!.path, `n${ids.size}`); e.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: mapCoreInline })
  const snapshot = JSON.stringify(tree)
  const result = mapTerm(tree.root, ctx)!
  expect(result.id).toBe('n0')
  expect(result.subjectField).toEqual([{ text: '领域' }])
  expect(result.definition).toEqual([{ kind: 'paragraph', id: 'n5', content: [{ text: '定义' }] }])
  expect(result.source).toEqual([{ text: '来源' }])
  expect(result.languageSets?.map(s => [s.language, s.groups.length])).toEqual([['zh', 2], ['en', 1]])
  expect(result.languageSets?.[1]?.groups[0]?.terms[0]?.descriptors[0]).toMatchObject({ kind: 'normativeAuthorization', value: [{ text: 'preferredTerm' }] })
  expect(JSON.stringify(tree)).toBe(snapshot)
  expect(ctx.problems.filter(p => p.severity === 'error')).toEqual([])
})

it('[M-9.2.2-01] 全局定义数量不为一时报告错误', () => {
  const tree = parseXml46687('<term-sec xmlns:t="urn:iso:std:iso:30042:ed-1"><t:termEntry><t:langSet xml:lang="zh"><t:tig><t:term>甲</t:term></t:tig></t:langSet></t:termEntry></term-sec>').tree!
  const ids = new Map<string, string>()
  const visit = (e: XmlElement) => { ids.set(e.position!.path, `n${ids.size}`); e.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: mapCoreInline })
  mapTerm(tree.root, ctx)
  expect(ctx.problems).toContainEqual(expect.objectContaining({ code: 'xml-term-definition-count', severity: 'error' }))
})

it('[M-9.2.1-07] valid06 保留五个术语组和描述符及引用', () => {
  const xml = readFileSync('../../schemas/gbt46687.2/samples/valid/06-terms-references.xml', 'utf8')
  const tree = parseXml46687(xml).tree!
  const ids = new Map<string, string>()
  const visit = (e: XmlElement) => { ids.set(e.position!.path, `n${ids.size}`); e.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: (e, c) => mapCoreInline(e, c) ?? mapReferenceInline(e, c) })
  const all = (e: XmlElement): XmlElement[] => [e, ...e.children.flatMap(c => c.type === 'element' ? all(c) : [])]
  const termSec = all(tree.root).find(e => e.name.local === 'term-sec')!
  const term = mapTerm(termSec, ctx)!
  expect(term.languageSets?.map(s => s.groups.length)).toEqual([3, 2])
  expect(term.subjectField).toEqual([{ text: '标准化' }])
  expect(term.definition[0]).toMatchObject({ kind: 'paragraph', content: expect.arrayContaining([expect.objectContaining({ marks: [expect.objectContaining({ type: 'termRef' })] })]) })
  expect(term.notes).toHaveLength(2)
  expect(term.examples).toHaveLength(1)
  expect(ctx.problems.filter(p => p.severity === 'error')).toEqual([])
})

it('[M-9.2.1-06] 同一主语言的语言集合并风险有告警', () => {
  const tree = parseXml46687('<term-sec xmlns:t="urn:iso:std:iso:30042:ed-1"><t:termEntry><t:langSet xml:lang="zh"><t:definition>定义</t:definition><t:tig><t:term>甲</t:term></t:tig></t:langSet><t:langSet xml:lang="zh-Hans"><t:tig><t:term>乙</t:term></t:tig></t:langSet></t:termEntry></term-sec>').tree!
  const ids = new Map<string, string>()
  const visit = (e: XmlElement) => { ids.set(e.position!.path, `n${ids.size}`); e.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: mapCoreInline })
  const term = mapTerm(tree.root, ctx)!
  expect(term.languageSets).toHaveLength(2)
  expect(ctx.problems).toContainEqual(expect.objectContaining({ code: 'xml-normalized', severity: 'warning' }))
})
