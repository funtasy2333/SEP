import type { PMJsonNode } from '@ses/shared'

/**
 * WP8.M G6「引言中的条」的生产 Schema fixture（矩阵 M-4.3.4-02、M-4.3.4-03）。
 *
 * 不改 wp6.ts：它被多个测试文件共用。这里的文档所有节点都带稳定 nodeId，使 PM→IR→PM 往返与
 * 保存重开可以逐节点比较。引言里只有条（0.1 含 0.1.1/0.1.2、0.2、无题条 0.3），没有条外正文。
 */

const pm = (
  type: string,
  attrs?: Record<string, unknown>,
  content?: PMJsonNode[],
  text?: string,
  marks?: NonNullable<PMJsonNode['marks']>,
): PMJsonNode => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content ? { content } : {}),
  ...(text !== undefined ? { text } : {}),
  ...(marks ? { marks } : {}),
})

const txt = (text: string, marks?: NonNullable<PMJsonNode['marks']>) => pm('text', undefined, undefined, text, marks)
const para = (nodeId: string, ...content: PMJsonNode[]) => pm('stdParagraph', { nodeId }, content)
const xref = (text: string, targetId: string) => txt(text, [{ type: 'crossRef', attrs: { targetId, refType: 'clause' } }])

/** 引言容器本身：块在前、条在后；这里只有条。 */
export function createG6IntroductionNode(): PMJsonNode {
  // 前言/引言容器沿用旧 IR 契约（IR 不存容器 ID），所以不带 nodeId，PM→IR→PM 后与原文档逐节点相同
  return pm('introduction', undefined, [
    pm('clause', { nodeId: 'g6-c1', level: 1 }, [
      pm('clauseTitle', undefined, [txt('背景')]),
      pm('clause', { nodeId: 'g6-c1-1', level: 2 }, [
        pm('clauseTitle', undefined, [txt('起因')]),
        para('g6-c1-1-p', txt('编制起因。')),
        pm('note', { nodeId: 'g6-c1-1-note' }, [txt('引言条内的注。')]),
      ]),
      pm('clause', { nodeId: 'g6-c1-2', level: 2 }, [
        pm('clauseTitle', undefined, [txt('说明')]),
        para('g6-c1-2-p', txt('本文件的编制背景。'), pm('footnoteRef', { nodeId: 'g6-fn1', content: [txt('引言条中的脚注。')] })),
      ]),
    ]),
    pm('clause', { nodeId: 'g6-c2', level: 1 }, [
      pm('clauseTitle', undefined, [txt('目的')]),
      para('g6-c2-p', txt('编制目的，见'), xref('0.1', 'g6-c1'), txt('。')),
    ]),
    // 无题条：编号 0.3，条文在首个段落（clauseTitle 为空）
    pm('clause', { nodeId: 'g6-c3', level: 1, hasTitle: false }, [
      pm('clauseTitle'),
      para('g6-c3-p', txt('无标题条的条文。')),
    ]),
  ])
}

export function createG6Fixture(): PMJsonNode {
  return pm('doc', { extensionVersion: 1 }, [
    pm('foreword', undefined, [para('g6-foreword-p', txt('本文件的前言。'))]),
    createG6IntroductionNode(),
    pm('chapter', { nodeId: 'g6-ch1', secType: 'scope' }, [
      pm('chapterTitle', undefined, [txt('范围')]),
      pm('clause', { nodeId: 'g6-ch1-c1', level: 1 }, [
        pm('clauseTitle', undefined, [txt('一般要求')]),
        para('g6-ch1-c1-p', txt('见引言'), xref('0.1', 'g6-c1'), txt('与'), xref('0.1.1', 'g6-c1-1'), txt('。')),
      ]),
    ]),
  ])
}
