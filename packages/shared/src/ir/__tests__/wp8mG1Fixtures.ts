/**
 * WP8.M G1「规范性引用文件结构化条目 + 正文 std/mixed-citation 引用 + 参考文献标题」的 fixture
 * （矩阵 M-4.4.2.3-02/-03/-04、M-4.4.2.3.2-01、M-10.2-01/-02、M-10.1.7-01、M-4.5.3-02、示例级 M-E-06）。
 *
 * 不修改字节锁定的 fixtures.ts；同一份文档给出两种形态：IR 原生（{@link createG1IrDoc}）与生产 PM JSON
 * （{@link createG1PmDoc}，纯对象，shared 测试不依赖 @tiptap）。所有节点都带稳定 ID，便于往返逐节点比较。
 *
 * 文档结构：1 范围；2 规范性引用文件（引导语 + 清单：三个标准化文件 + 一个带脚注的非标准化文件）；
 * 3 总体要求（正文中的 stdRef / mixedCitation 引用，分别位于段落、列项、注，并与 bold、crossRef 叠加）；参考文献（自定义标题）。
 */

import type { PMJsonNode } from '../pmToIr'
import type { IRDoc, IRInline, IRMark, IRNormRef, IRNormRefList, NodeId } from '../types'

// ---------- IR 原生 ----------

const t = (text: string, ...marks: IRMark[]): IRInline => ({ text, ...(marks.length ? { marks } : {}) })
const para = (id: NodeId, ...content: IRInline[]) => ({ kind: 'paragraph' as const, id, content })
const std = (id: NodeId, ref: string, title: string): IRNormRef => ({ kind: 'normRef', id, entryType: 'std', ref: [t(ref)], title: [t(title)] })
const mixed = (id: NodeId, ...content: IRInline[]): IRNormRef => ({ kind: 'normRef', id, entryType: 'mixed', content })

/** 规范性引用文件清单：std×3（含“（所有部分）”与含英文的名称）+ mixed×1（带条文脚注） */
export function g1NormRefList(): IRNormRefList {
  return {
    kind: 'normRefList', id: 'g1-nrl', entries: [
      std('g1-nr-1', 'GB/T 321', '优先数和优先数系'),
      std('g1-nr-2', 'GB/T 3102（所有部分）', '量和单位'),
      std('g1-nr-3', 'ISO 80000（所有部分）', '量和单位（Quantities and units）'),
      mixed('g1-nr-4', t('《中华人民共和国计量法》'), { text: '', footnote: { id: 'g1-fn-nr', content: [t('非标准化文件的脚注。')] } }),
    ],
  }
}

/** 正文引用 run：GB/T 3102 是标准化文件（stdRef），计量法是非标准化文件（mixedCitation） */
export const STD_RUN = (): IRInline => t('GB/T 3102.1', { type: 'stdRef' })
export const MIXED_RUN = (): IRInline => t('《中华人民共和国计量法》', { type: 'mixedCitation' })

export function createG1IrDoc(): IRDoc {
  return {
    schemaVersion: 1,
    extensionVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [para('g1-fw-p', t('本文件的前言。'))], introduction: [] },
    body: [
      { kind: 'chapter', id: 'g1-ch1', secType: 'scope', title: [t('范围')], children: [para('g1-ch1-p', t('本文件规定了引用的写法。'))] },
      {
        kind: 'chapter', id: 'g1-ch2', secType: 'norm-refs', title: [t('规范性引用文件')], children: [
          para('g1-ch2-lead', t('下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。')),
          g1NormRefList(),
        ],
      },
      {
        kind: 'chapter', id: 'g1-ch3', secType: 'general', title: [t('总体要求')], children: [
          para('g1-ch3-p1', t('量的名称与符号应符合'), STD_RUN(), t('的规定，并遵守'), MIXED_RUN(), t('。')),
          para('g1-ch3-p2', t('加粗的标准引用：'), t('GB/T 321', { type: 'bold' }, { type: 'stdRef' }), t('；'), t('见'), t('2', { type: 'crossRef', targetId: 'g1-ch2', targetKind: 'chapter' }, { type: 'stdRef' })),
          {
            kind: 'list', id: 'g1-list', listType: 'dash', items: [
              { id: 'g1-list-i1', content: [para('g1-list-i1.p0', t('符合'), t('GB/T 321', { type: 'stdRef' }))] },
            ],
          },
          { kind: 'note', id: 'g1-note', content: [para('g1-note.p0', t('注中引用'), t('GB/T 3102', { type: 'stdRef' }))] },
        ],
      },
    ],
    appendices: [],
    bibliography: [
      { kind: 'bibEntry', id: 'g1-bib-1', content: [t('张三.计量学基础[M].北京:出版社,2020.')] },
      { kind: 'bibEntry', id: 'g1-bib-2', content: [t('GB/T 15657—2021 中医病证分类与代码')] },
    ],
    bibliographyTitle: [t('参考书目')],
  }
}

/** 与 {@link createG1IrDoc} 同形，但不含任何 G1 新结构：清单退回普通段落，没有标准引用 mark，标题为默认（旧形态）。 */
export function createG1LegacyIrDoc(): IRDoc {
  const doc = createG1IrDoc()
  delete doc.extensionVersion
  delete doc.bibliographyTitle
  doc.body = [
    doc.body[0]!,
    {
      kind: 'chapter', id: 'g1-ch2', secType: 'norm-refs', title: [t('规范性引用文件')], children: [
        para('g1-ch2-lead', t('下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。')),
        para('g1-ch2-p1', t('GB/T 321　优先数和优先数系')),
      ],
    },
    { kind: 'chapter', id: 'g1-ch3', secType: 'general', title: [t('总体要求')], children: [para('g1-ch3-p1', t('量的名称与符号应符合 GB/T 3102.1 的规定。'))] },
  ]
  return doc
}

// ---------- 生产 PM JSON ----------

type PMMarks = NonNullable<PMJsonNode['marks']>
const pm = (type: string, attrs?: Record<string, unknown>, content?: PMJsonNode[]): PMJsonNode => ({
  type, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}),
})
const txt = (text: string, marks?: PMMarks): PMJsonNode => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const pmPara = (nodeId: string, ...content: PMJsonNode[]) => pm('stdParagraph', { nodeId }, content)
const footnote = (nodeId: string, text: string) => pm('footnoteRef', { nodeId, content: [txt(text)] })

export function g1PmNormRefList(): PMJsonNode {
  return pm('normRefList', { nodeId: 'g1-nrl' }, [
    pm('normRefStd', { nodeId: 'g1-nr-1' }, [pm('normRefStdRef', undefined, [txt('GB/T 321')]), pm('normRefStdTitle', undefined, [txt('优先数和优先数系')])]),
    pm('normRefStd', { nodeId: 'g1-nr-2' }, [pm('normRefStdRef', undefined, [txt('GB/T 3102（所有部分）')]), pm('normRefStdTitle', undefined, [txt('量和单位')])]),
    pm('normRefStd', { nodeId: 'g1-nr-3' }, [pm('normRefStdRef', undefined, [txt('ISO 80000（所有部分）')]), pm('normRefStdTitle', undefined, [txt('量和单位（Quantities and units）')])]),
    pm('normRefMixed', { nodeId: 'g1-nr-4' }, [txt('《中华人民共和国计量法》'), footnote('g1-fn-nr', '非标准化文件的脚注。')]),
  ])
}

export function createG1PmDoc(): PMJsonNode {
  return pm('doc', { extensionVersion: 1 }, [
    pm('foreword', undefined, [pmPara('g1-fw-p', txt('本文件的前言。'))]),
    pm('chapter', { nodeId: 'g1-ch1', secType: 'scope' }, [pm('chapterTitle', undefined, [txt('范围')]), pmPara('g1-ch1-p', txt('本文件规定了引用的写法。'))]),
    pm('chapter', { nodeId: 'g1-ch2', secType: 'norm-refs' }, [
      pm('chapterTitle', undefined, [txt('规范性引用文件')]),
      pmPara('g1-ch2-lead', txt('下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。')),
      g1PmNormRefList(),
    ]),
    pm('chapter', { nodeId: 'g1-ch3', secType: 'general' }, [
      pm('chapterTitle', undefined, [txt('总体要求')]),
      pmPara('g1-ch3-p1', txt('量的名称与符号应符合'), txt('GB/T 3102.1', [{ type: 'stdRef' }]), txt('的规定，并遵守'), txt('《中华人民共和国计量法》', [{ type: 'mixedCitation' }]), txt('。')),
      pmPara('g1-ch3-p2', txt('加粗的标准引用：'), txt('GB/T 321', [{ type: 'bold' }, { type: 'stdRef' }]), txt('；'), txt('见'),
        txt('2', [{ type: 'crossRef', attrs: { targetId: 'g1-ch2', refType: 'chapter' } }, { type: 'stdRef' }])),
      pm('stdList', { nodeId: 'g1-list', listType: 'dash', level: 1 }, [
        pm('stdListItem', { nodeId: 'g1-list-i1' }, [txt('符合'), txt('GB/T 321', [{ type: 'stdRef' }])]),
      ]),
      pm('note', { nodeId: 'g1-note' }, [txt('注中引用'), txt('GB/T 3102', [{ type: 'stdRef' }])]),
    ]),
    pm('bibliography', undefined, [
      pm('bibliographyTitle', undefined, [txt('参考书目')]),
      pm('bibEntry', { nodeId: 'g1-bib-1', entryType: null }, [txt('张三.计量学基础[M].北京:出版社,2020.')]),
      pm('bibEntry', { nodeId: 'g1-bib-2', entryType: null }, [txt('GB/T 15657—2021 中医病证分类与代码')]),
    ]),
  ])
}
