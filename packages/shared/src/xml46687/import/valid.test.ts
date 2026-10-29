import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseXml46687 } from '../parse'
import type { XmlElement } from '../tree'
import { buildImportIndex } from './context'

const dir = resolve(process.cwd(), '../../schemas/gbt46687.2/samples/valid')
for (const name of readdirSync(dir).filter(name => name.endsWith('.xml'))) {
  describe(name, () => {
    it('可建立节点和引用索引', () => {
      const parsed = parseXml46687(readFileSync(resolve(dir, name), 'utf8'))
      expect(parsed.problems).toEqual([])
      const ids = new Map<string, string>()
      const visit = (el: XmlElement) => {
        ids.set(el.position!.path, `id-${ids.size}`)
        for (const child of el.children) if (child.type === 'element') visit(child)
      }
      visit(parsed.tree!.root)
      expect(buildImportIndex(parsed.tree!, { nodeIdsByPath: ids, resources: new Map() }).problems).toEqual([])
    })
  })
}
