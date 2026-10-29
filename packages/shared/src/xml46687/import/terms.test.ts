import { expect, it } from 'vitest'
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
