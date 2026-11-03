import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import type { IRFigure, IRInline } from '../../ir/types'
import { parseXml46687 } from '../parse'
import { getXmlAttr, XLINK_NS } from '../tree'
import type { XmlElement } from '../tree'
import { mapXml46687 } from './facade'
import { validateXml46687 } from './validate'

const samplePath = resolve(process.cwd(), '../../schemas/gbt46687.2/samples/valid/05-formulas-figures.xml')
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='

function elementsOf(root: XmlElement): XmlElement[] {
  return [root, ...root.children.flatMap(child => child.type === 'element' ? elementsOf(child) : [])]
}

function collectKind<T>(value: unknown, kind: string): T[] {
  if (Array.isArray(value)) return value.flatMap(item => collectKind<T>(item, kind))
  if (!value || typeof value !== 'object') return []
  const object = value as Record<string, unknown>
  return [...(object.kind === kind ? [object as T] : []), ...Object.values(object).flatMap(item => collectKind<T>(item, kind))]
}

function allInlines(value: unknown): IRInline[] {
  if (Array.isArray(value)) return value.flatMap(allInlines)
  if (!value || typeof value !== 'object') return []
  const object = value as Record<string, unknown>
  return [...(typeof object.text === 'string' ? [object as unknown as IRInline] : []), ...Object.values(object).flatMap(allInlines)]
}

it('[M-D.1-01] Unicode NCName 图 ID 仍按 rid 关联，且不改变图形资源 href', () => {
  const opaqueXmlId = 'Ω'
  const source = readFileSync(samplePath, 'utf8')
    .replace('rid="fig_1"', `rid="${opaqueXmlId}"`)
    .replace('<fig id="fig_1">', `<fig id="${opaqueXmlId}">`)
  const parsed = parseXml46687(source)
  expect(parsed.problems).toEqual([])
  expect(parsed.tree).not.toBeNull()
  const tree = parsed.tree!
  const elements = elementsOf(tree.root)

  const xmlIds = elements.flatMap(element => [getXmlAttr(element, null, 'id'), getXmlAttr(element, 'http://www.w3.org/XML/1998/namespace', 'id')]
    .filter((id): id is string => id !== undefined))
  expect(new Set(xmlIds).size).toBe(xmlIds.length)
  expect(validateXml46687(tree).problems.filter(problem => problem.severity === 'error' && ['xml-id-invalid', 'xml-id-duplicate'].includes(problem.code))).toEqual([])

  const nodeIdsByPath = new Map<string, string>()
  const resources = new Map<string, { src: string; mediaType: string; resourceId: string }>()
  for (const element of elements) {
    nodeIdsByPath.set(element.position!.path, `seed-${nodeIdsByPath.size}`)
    if (element.name.ns === null && ['graphic', 'inline-graphic'].includes(element.name.local)) {
      const href = getXmlAttr(element, XLINK_NS, 'href')
      if (href) resources.set(href, { src: png, mediaType: 'image/png', resourceId: `resource:${href}` })
    }
  }
  const targetElement = elements.find(element => element.name.ns === null && element.name.local === 'fig' && getXmlAttr(element, null, 'id') === opaqueXmlId)
  const targetRef = elements.find(element => element.name.ns === null && element.name.local === 'xref' && getXmlAttr(element, null, 'rid') === opaqueXmlId)
  expect(targetElement).toBeDefined()
  expect(targetRef).toBeDefined()
  const targetGraphic = elements.find(element => element.name.ns === null && element.name.local === 'graphic' && getXmlAttr(element, XLINK_NS, 'href') === 'fig_1')
  expect(targetGraphic).toBeDefined()
  expect(resources.get('fig_1')).toEqual({ src: png, mediaType: 'image/png', resourceId: 'resource:fig_1' })

  const result = mapXml46687(tree, { nodeIdsByPath, resources })
  expect(result.problems.filter(problem => problem.severity === 'error')).toEqual([])
  expect(result.ir).not.toBeNull()
  const targetNodeId = nodeIdsByPath.get(targetElement!.position!.path)!
  const figure = collectKind<IRFigure>(result.ir, 'figure').find(candidate => candidate.resourceId === 'resource:fig_1')
  expect(figure).toBeDefined()
  expect(figure!.id).toBe(targetNodeId)
  expect(figure!.id).not.toBe(opaqueXmlId)
  const figureRef = allInlines(result.ir!.body).find(run => run.text === '图1')
  expect(figureRef?.marks).toContainEqual({ type: 'crossRef', targetId: figure!.id, targetKind: 'figure' })
  expect(figureRef?.marks?.some(mark => 'targetId' in mark && mark.targetId === opaqueXmlId)).toBe(false)
})
