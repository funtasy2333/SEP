import { describe, expect, it } from 'vitest'
import type { IRDoc } from './types'
import { generateNodeId } from './nodeId'

/** 构造一个覆盖全部节点种类的样例文档，验证不变式 4：JSON 往返无损 */
function buildSampleDoc(): IRDoc {
  const noteId = generateNodeId()
  return {
    schemaVersion: 1,
    meta: {
      title: '示例标准',
      titleEn: 'Sample standard',
      stdCode: 'GB/T 0000—2026',
      standardType: 'gb',
    },
    front: {
      foreword: [
        { kind: 'paragraph', id: generateNodeId(), content: [{ text: '本文件按照GB/T 1.1—2020起草。' }] },
      ],
      introduction: [],
    },
    body: [
      {
        kind: 'chapter',
        id: generateNodeId(),
        secType: 'terms',
        title: [{ text: '术语和定义' }],
        children: [
          {
            kind: 'termEntry',
            id: generateNodeId(),
            term: [{ text: '标准' }],
            termEn: [{ text: 'standard' }],
            definition: [
              { kind: 'paragraph', id: generateNodeId(), content: [{ text: '……的文件。' }] },
            ],
            source: [{ text: 'GB/T 20000.1—2014, 5.3' }],
            notes: [],
            examples: [],
          },
        ],
      },
      {
        kind: 'chapter',
        id: generateNodeId(),
        secType: 'general',
        title: [{ text: '要求', marks: [{ type: 'bold' }] }],
        children: [
          {
            kind: 'clause',
            id: generateNodeId(),
            level: 1,
            titled: false,
            title: [],
            children: [
              {
                kind: 'paragraph',
                id: generateNodeId(),
                content: [
                  { text: '应符合' },
                  { text: '5.1.2', marks: [{ type: 'crossRef', targetId: generateNodeId() }] },
                  { text: '的规定，H' },
                  { text: '2', marks: [{ type: 'sub' }] },
                  { text: 'O。' },
                ],
              },
              {
                kind: 'list',
                id: generateNodeId(),
                listType: 'dash',
                items: [
                  {
                    id: generateNodeId(),
                    content: [
                      { kind: 'paragraph', id: generateNodeId(), content: [{ text: '列项一；' }] },
                    ],
                  },
                ],
              },
              {
                kind: 'table',
                id: generateNodeId(),
                caption: [{ text: '尺寸要求' }],
                orientation: 'landscape',
                headerRowCount: 1,
                rows: [
                  {
                    id: generateNodeId(),
                    cells: [
                      {
                        id: generateNodeId(),
                        colspan: 2,
                        rowspan: 1,
                        header: true,
                        content: [
                          { kind: 'paragraph', id: generateNodeId(), content: [{ text: '项目' }] },
                        ],
                      },
                    ],
                  },
                ],
                notes: [
                  {
                    kind: 'note',
                    id: noteId,
                    content: [
                      { kind: 'paragraph', id: generateNodeId(), content: [{ text: '表内注。' }] },
                    ],
                  },
                ],
              },
              {
                kind: 'figure',
                id: generateNodeId(),
                caption: [{ text: '结构示意图' }],
                orientation: 'portrait',
                src: 'asset:fig-1',
                notes: [],
              },
              {
                kind: 'formula',
                id: generateNodeId(),
                latex: 'E = mc^2',
                numbered: true,
                whereList: [
                  {
                    id: generateNodeId(),
                    term: [{ text: 'E' }],
                    definition: [{ text: '能量，单位为焦耳（J）' }],
                  },
                ],
              },
              {
                kind: 'example',
                id: generateNodeId(),
                content: [
                  { kind: 'paragraph', id: generateNodeId(), content: [{ text: '示例内容。' }] },
                ],
              },
            ],
          },
        ],
      },
    ],
    appendices: [
      {
        kind: 'appendix',
        id: generateNodeId(),
        normative: true,
        title: [{ text: '试验方法' }],
        children: [
          { kind: 'paragraph', id: generateNodeId(), content: [{ text: '附录正文。' }] },
        ],
      },
    ],
    bibliography: [
      {
        kind: 'bibEntry',
        id: generateNodeId(),
        content: [{ text: 'GB/T 20000.1—2014 标准化工作指南 第1部分' }],
      },
    ],
  }
}

describe('IRDoc', () => {
  it('JSON.stringify 往返无损（不变式 4）', () => {
    const doc = buildSampleDoc()
    const roundTripped = JSON.parse(JSON.stringify(doc))
    expect(roundTripped).toEqual(doc)
  })
})
