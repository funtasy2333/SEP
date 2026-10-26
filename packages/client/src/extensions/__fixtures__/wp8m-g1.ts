import type { PMJsonNode } from '@ses/shared'

/**
 * WP8.M G1「规范性引用文件清单 + 正文 std/mixed-citation 引用 + 参考文献标题」的生产 Schema fixture
 * （矩阵 M-4.4.2.3-02/-03/-04、M-4.4.2.3.2-01、M-10.2-01/-02、M-10.1.7-01、M-4.5.3-02、M-E-06）。
 *
 * 不改 wp6.ts：它被多个测试文件共用。文档所有节点都带稳定 nodeId，使 PM→IR→PM 往返与保存重开可以逐节点比较。
 * 结构：范围；规范性引用文件（引导语 + 清单：三个标准化文件 + 带脚注的非标准化文件）；总体要求（正文 stdRef /
 * mixedCitation，位于段落、列项、注，与 bold、crossRef 叠加）；参考文献（自定义标题“参考书目”）。
 */

type PMMarks = NonNullable<PMJsonNode['marks']>

const pm = (type: string, attrs?: Record<string, unknown>, content?: PMJsonNode[]): PMJsonNode => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content ? { content } : {}),
})
const txt = (text: string, marks?: PMMarks): PMJsonNode => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const para = (nodeId: string, ...content: PMJsonNode[]) => pm('stdParagraph', { nodeId }, content)
const std = (nodeId: string, ref: string, title: string): PMJsonNode => pm('normRefStd', { nodeId }, [
  pm('normRefStdRef', undefined, [txt(ref)]),
  pm('normRefStdTitle', undefined, [txt(title)]),
])

export function createG1NormRefList(): PMJsonNode {
  return pm('normRefList', { nodeId: 'g1-nrl' }, [
    std('g1-nr-1', 'GB/T 321', '优先数和优先数系'),
    std('g1-nr-2', 'GB/T 3102（所有部分）', '量和单位'),
    std('g1-nr-3', 'ISO 80000（所有部分）', '量和单位（Quantities and units）'),
    pm('normRefMixed', { nodeId: 'g1-nr-4' }, [
      txt('《中华人民共和国计量法》'),
      pm('footnoteRef', { nodeId: 'g1-fn-nr', content: [txt('非标准化文件的脚注。')] }),
    ]),
  ])
}

export function createG1Fixture(): PMJsonNode {
  return pm('doc', { extensionVersion: 1 }, [
    pm('chapter', { nodeId: 'g1-ch1', secType: 'scope' }, [
      pm('chapterTitle', undefined, [txt('范围')]),
      para('g1-ch1-p', txt('本文件规定了引用的写法。')),
    ]),
    pm('chapter', { nodeId: 'g1-ch2', secType: 'norm-refs' }, [
      pm('chapterTitle', undefined, [txt('规范性引用文件')]),
      para('g1-ch2-lead', txt('下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。')),
      createG1NormRefList(),
    ]),
    pm('chapter', { nodeId: 'g1-ch3', secType: 'general' }, [
      pm('chapterTitle', undefined, [txt('总体要求')]),
      para('g1-ch3-p1', txt('量的名称与符号应符合'), txt('GB/T 3102.1', [{ type: 'stdRef' }]), txt('的规定，并遵守'), txt('《中华人民共和国计量法》', [{ type: 'mixedCitation' }]), txt('。')),
      para('g1-ch3-p2', txt('加粗的标准引用：'), txt('GB/T 321', [{ type: 'bold' }, { type: 'stdRef' }]), txt('；见'),
        txt('2', [{ type: 'crossRef', attrs: { targetId: 'g1-ch2', refType: 'chapter' } }, { type: 'stdRef' }])),
      pm('stdList', { nodeId: 'g1-list', listType: 'dash', level: 1 }, [
        pm('stdListItem', { nodeId: 'g1-list-i1' }, [txt('符合'), txt('GB/T 321', [{ type: 'stdRef' }])]),
      ]),
      pm('note', { nodeId: 'g1-note' }, [txt('注中引用'), txt('GB/T 3102', [{ type: 'stdRef' }])]),
    ]),
    pm('bibliography', undefined, [
      pm('bibliographyTitle', undefined, [txt('参考书目')]),
      pm('bibEntry', { nodeId: 'g1-bib-1' }, [txt('张三.计量学基础[M].北京:出版社,2020.')]),
    ]),
  ])
}

/** 同一篇文档，但标题为默认“参考文献”、没有清单与标准引用 mark：旧形态，不应出现任何 G1 字段。 */
export function createG1LegacyFixture(): PMJsonNode {
  return pm('doc', undefined, [
    pm('chapter', { nodeId: 'g1-ch2', secType: 'norm-refs' }, [
      pm('chapterTitle', undefined, [txt('规范性引用文件')]),
      para('g1-ch2-lead', txt('下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。')),
      para('g1-ch2-p1', txt('GB/T 321　优先数和优先数系')),
    ]),
    pm('bibliography', undefined, [
      pm('bibliographyTitle', undefined, [txt('参考文献')]),
      pm('bibEntry', { nodeId: 'g1-bib-1', entryType: null }, [txt('张三.计量学基础[M].北京:出版社,2020.')]),
    ]),
  ])
}
