import { describe, expect, it, vi } from 'vitest'
import { fromXmlListType, parseXmlToJson } from './xmlParser'

class XmlElementStub {
  readonly childNodes: unknown[] = []
  readonly tagName: string
  readonly children: XmlElementStub[]
  private readonly attributes: Record<string, string>

  constructor(
    tagName: string,
    attributes: Record<string, string> = {},
    children: XmlElementStub[] = [],
  ) {
    this.tagName = tagName
    this.attributes = attributes
    this.children = children
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null
  }

  querySelector(selector: string): XmlElementStub | null {
    if (this.tagName === 'standard' && selector === ':scope > body') {
      return this.children.find((child) => child.tagName === 'body') ?? null
    }
    if (this.tagName === 'table-wrap' && selector === ':scope > table') {
      return this.children.find((child) => child.tagName === 'table') ?? null
    }
    if (this.tagName === 'fig' && selector === ':scope > graphic') {
      return this.children.find((child) => child.tagName === 'graphic') ?? null
    }
    return null
  }

  querySelectorAll(selector: string): XmlElementStub[] {
    if (this.tagName === 'body' && selector === ':scope > sec') {
      return this.children.filter((child) => child.tagName === 'sec')
    }
    if ((this.tagName === 'table-wrap' || this.tagName === 'fig') && selector === ':scope > caption') {
      return this.children.filter((child) => child.tagName === 'caption')
    }
    if (this.tagName === 'table' && selector === ':scope > tr, :scope > thead > tr, :scope > tbody > tr') {
      return []
    }
    return []
  }
}

describe('XML 列项导入类型', () => {
  it('旧罗马列项 XML 兼容解析为数字类型', () => {
    expect(fromXmlListType('roman-lower')).toBe('numeric')
    expect(fromXmlListType('roman-upper')).toBe('numeric')
    expect(fromXmlListType('arabic')).toBe('numeric')
    expect(fromXmlListType('alpha-lower')).toBe('alpha')
    expect(fromXmlListType('dash')).toBe('dash')
    expect(fromXmlListType('dot')).toBe('dot')
  })
})

describe('XML 图表方向导入', () => {
  it('parseXmlToJson 将 fig 和 table-wrap 的横向属性写入 ProseMirror attrs', () => {
    const figure = new XmlElementStub('fig', { orientation: 'landscape' }, [
      new XmlElementStub('graphic'),
    ])
    const table = new XmlElementStub('table-wrap', { orientation: 'landscape' }, [
      new XmlElementStub('table'),
    ])
    const chapter = new XmlElementStub('sec', {}, [
      new XmlElementStub('title'),
      table,
      figure,
    ])
    const body = new XmlElementStub('body', {}, [chapter])
    const root = new XmlElementStub('standard', {}, [body])
    vi.stubGlobal('DOMParser', class {
      parseFromString() {
        return {
          documentElement: root,
          querySelector: () => null,
        }
      }
    })

    try {
      const imported = parseXmlToJson('<standard><body><sec><table-wrap orientation="landscape"/><fig orientation="landscape"/></sec></body></standard>')
      const importedChapter = imported.content?.find((node) => node.type === 'chapter')
      const importedTable = importedChapter?.content?.find((node) => node.type === 'stdTable')
      const importedFigure = importedChapter?.content?.find((node) => node.type === 'figure')

      expect(importedTable?.attrs?.orientation).toBe('landscape')
      expect(importedFigure?.attrs?.orientation).toBe('landscape')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
