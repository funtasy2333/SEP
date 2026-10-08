// @vitest-environment happy-dom
import { renderHtml, resolve, type IRDoc, type ResolvedLabel } from '@ses/shared'
import { describe, expect, it } from 'vitest'

function dom(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function documentFixture(): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: {
      foreword: [{ kind: 'paragraph', id: 'foreword-text', content: [{ text: '前言正文' }] }],
      introduction: [],
    },
    body: [{
      kind: 'chapter',
      // Deliberately equal to Resolver's first chapter xmlId (`sec_1`).
      id: 'sec_1',
      secType: 'general',
      title: [{ text: '正文' }],
      children: [
        { kind: 'paragraph', id: 'escaped-target', content: [{ text: '特殊目标' }] },
        { kind: 'paragraph', id: 'static-collision', content: [{ text: '静态冲突目标' }] },
        { kind: 'paragraph', id: 'duplicate-target-a', content: [{ text: '重复目标甲' }] },
        { kind: 'paragraph', id: 'duplicate-target-b', content: [{ text: '重复目标乙' }] },
        { kind: 'paragraph', id: 'references', content: [
          { text: '章节', marks: [{ type: 'crossRef', targetId: 'sec_1', targetKind: 'chapter' }] },
          { text: '；特殊字符', marks: [{ type: 'crossRef', targetId: 'escaped-target', targetKind: 'paragraph' }] },
          { text: '；静态冲突', marks: [{ type: 'crossRef', targetId: 'static-collision', targetKind: 'paragraph' }] },
          { text: '；重复目标', marks: [{ type: 'crossRef', targetId: 'duplicate-target-a', targetKind: 'paragraph' }] },
        ] },
      ],
    }],
    appendices: [],
    bibliography: [],
  }
}

describe('HTML cross-reference anchors in a parsed DOM', () => {
  it('links only to unique rendered ids and escapes ids before the browser parses them', () => {
    const doc = documentFixture()
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => ['dangling-xref', 'dangling-typed-ref'].includes(problem.code))).toEqual([])
    expect(labels.sec_1?.xmlId).toBe('sec_1')

    const htmlLabels: Record<string, ResolvedLabel> = { ...labels }
    htmlLabels['escaped-target'] = {
      ...labels['escaped-target']!,
      xmlId: '目标 &<"id',
      refText: '特殊 & <文本>',
    }
    htmlLabels['static-collision'] = {
      ...labels['static-collision']!,
      xmlId: 'front_foreword',
    }
    htmlLabels['duplicate-target-a'] = {
      ...labels['duplicate-target-a']!,
      xmlId: 'duplicate_target',
    }
    htmlLabels['duplicate-target-b'] = {
      ...labels['duplicate-target-b']!,
      xmlId: 'duplicate_target',
    }

    const sourceBefore = JSON.stringify(doc)
    const screen = dom(renderHtml(doc, htmlLabels, { variant: 'screen' }))
    const ids = Array.from(screen.querySelectorAll<HTMLElement>('[id]'), element => element.id)
    const links = Array.from(screen.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))

    // The actual chapter nodeId equals its xmlId, so this checks `id`, not `data-node-id`.
    expect(ids.filter(id => id === 'sec_1')).toHaveLength(1)
    expect(links.some(link => link.getAttribute('href') === '#sec_1')).toBe(true)
    expect(ids.filter(id => id === '目标 &<"id')).toHaveLength(1)
    expect(links.some(link => link.getAttribute('href') === '#目标 &<"id')).toBe(true)
    expect(screen.querySelector('.ses-xref[data-ref-target="sec_1"]')?.textContent).toBe(labels.sec_1!.refText)
    expect(screen.body.textContent).toContain('特殊 & <文本>')

    // A dynamic target colliding with a static front-matter id and repeated resolver IDs
    // are withheld as anchors; their references remain text spans.
    expect(ids).not.toContain('front_foreword')
    expect(ids).not.toContain('duplicate_target')
    expect(links.some(link => ['#front_foreword', '#duplicate_target'].includes(link.getAttribute('href') ?? ''))).toBe(false)
    expect(screen.querySelector('a.ses-xref[data-ref-target="static-collision"]')).toBeNull()
    expect(screen.querySelector('span.ses-xref[data-ref-target="static-collision"]')?.textContent)
      .toBe(labels['static-collision']!.refText)
    expect(screen.querySelector('a.ses-xref[data-ref-target="duplicate-target-a"]')).toBeNull()
    expect(screen.querySelector('span.ses-xref[data-ref-target="duplicate-target-a"]')?.textContent)
      .toBe(labels['duplicate-target-a']!.refText)

    for (const link of links) {
      const targetId = link.getAttribute('href')!.slice(1)
      expect(ids.filter(id => id === targetId), targetId).toHaveLength(1)
    }

    const print = dom(renderHtml(doc, htmlLabels, { variant: 'print' }))
    expect(print.querySelectorAll('a[href^="#"]')).toHaveLength(0)
    expect(JSON.stringify(doc)).toBe(sourceBefore)
  })
})
