import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { resolve as resolveIr } from '../../ir/resolve'
import { parseXml46687 } from '../parse'
import type { XmlElement } from '../tree'
import { mapXml46687 } from './facade'

const sample = (name: string) => readFileSync(new URL(`../../../../../schemas/gbt46687.2/samples/valid/${name}`, import.meta.url), 'utf8')
function mapComplete(xml: string) {
  const parsed = parseXml46687(xml)
  expect(parsed.problems).toEqual([])
  expect(parsed.tree).not.toBeNull()
  const tree = parsed.tree!
  const ids = new Map<string, string>()
  const visit = (el: XmlElement) => {
    const path = el.position!.path
    ids.set(path, `node:${path}`)
    for (const child of el.children) if (child.type === 'element') visit(child)
  }
  visit(tree.root)
  const result = mapXml46687(tree, { nodeIdsByPath: ids, resources: new Map() })
  expect(result.problems.filter(p => p.severity === 'error')).toEqual([])
  expect(result.ir).not.toBeNull()
  return { doc: result.ir!, problems: result.problems }
}

it('[M-4.1-04] front 中的元数据、前言和引言分别进入文档字段', () => {
  const { doc } = mapComplete(sample('03-structure.xml'))
  expect(doc.meta.title).toBe('结构示例')
  expect(doc.front.foreword).toMatchObject([{ kind: 'paragraph', content: [{ text: '本文件用于演示章、条、无标题条、附录、参考文献和索引的标记。' }] }])
  expect(doc.front.introduction).toMatchObject([{ kind: 'paragraph', content: [{ text: '引言可以只含段落。' }] }])
})

it('[M-4.4.2.1-01] 章及嵌套条保留结构和深度', () => {
  const { doc } = mapComplete(sample('03-structure.xml'))
  const chapter = doc.body[3]!
  expect(chapter).toMatchObject({ kind: 'chapter', title: [{ text: '技术要求' }] })
  expect(chapter.children[0]).toMatchObject({ kind: 'clause', level: 1, title: [{ text: '总体要求' }], children: expect.arrayContaining([expect.objectContaining({ kind: 'clause', level: 2, titled: false })]) })
})

it('[M-4.4.2.1-04] 章中的 p 按原文字进入段落', () => {
  const { doc } = mapComplete(sample('01-minimal.xml'))
  expect(doc.body[0]!.children).toMatchObject([{ kind: 'paragraph', content: [{ text: '本文件给出一个只含必需结构的最小文档。' }] }])
})

it('[M-4.4.2.1-02] 章标签由 Resolver 根据结构生成', () => {
  const { doc } = mapComplete(sample('01-minimal.xml'))
  const labels = resolveIr(doc).labels
  expect(labels[doc.body[0]!.id]).toMatchObject({ label: '1' })
  expect(doc.body[0]).toMatchObject({ kind: 'chapter', title: [{ text: '范围' }] })
})
