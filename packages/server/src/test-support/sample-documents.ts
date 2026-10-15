import type { PMJsonNode } from '@ses/shared';
import { normalizeContentDetailed } from '../editor-schema/editor-schema';

/** 测试用的编辑器文档（PM JSON）构造器与示例文档。只被 spec 引用，不进入 `nest build` 的产物。 */

export const text = (value: string): PMJsonNode => ({
  type: 'text',
  text: value,
});

const node = (
  type: string,
  attrs?: Record<string, unknown>,
  content?: PMJsonNode[],
): PMJsonNode => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content ? { content } : {}),
});

/** nodeId 为 null 时模拟「缺失 nodeId」。 */
export const para = (nodeId: string | null, value: string): PMJsonNode =>
  node('stdParagraph', nodeId === null ? undefined : { nodeId }, [text(value)]);

export const chapter = (
  nodeId: string | null,
  title: string,
  ...children: PMJsonNode[]
): PMJsonNode =>
  node(
    'chapter',
    {
      ...(nodeId === null ? {} : { nodeId }),
      secType: title === '范围' ? 'scope' : 'general',
    },
    [node('chapterTitle', undefined, [text(title)]), ...children],
  );

export const clause = (
  nodeId: string,
  level: number,
  title: string,
  ...children: PMJsonNode[]
): PMJsonNode =>
  node('clause', { nodeId, level, hasTitle: true }, [
    node('clauseTitle', { level }, [text(title)]),
    ...children,
  ]);

/** 两行两列的简单表（第一行为表头），所有行、单元格与单元格内段落都有显式 nodeId。 */
export function simpleTable(nodeId: string, caption: string): PMJsonNode {
  const cell = (
    kind: 'tableHeader' | 'tableCell',
    id: string,
    value: string,
  ): PMJsonNode =>
    node(kind, { nodeId: id, colspan: 1, rowspan: 1 }, [
      para(`${id}-p`, value),
    ]);
  const row = (id: string, ...cells: PMJsonNode[]): PMJsonNode =>
    node('tableRow', { nodeId: id }, cells);
  return node(
    'stdTable',
    { nodeId, orientation: 'portrait', headerRowCount: 1 },
    [
      node('tableCaption', undefined, [text(caption)]),
      node('table', undefined, [
        row(
          `${nodeId}-r1`,
          cell('tableHeader', `${nodeId}-r1c1`, '项目'),
          cell('tableHeader', `${nodeId}-r1c2`, '指标'),
        ),
        row(
          `${nodeId}-r2`,
          cell('tableCell', `${nodeId}-r2c1`, '精度'),
          cell('tableCell', `${nodeId}-r2c2`, '0.1'),
        ),
      ]),
    ],
  );
}

export const foreword = (nodeId: string, ...blocks: PMJsonNode[]): PMJsonNode =>
  node('foreword', { nodeId }, blocks);

export const doc = (...content: PMJsonNode[]): PMJsonNode =>
  node('doc', undefined, content);

/**
 * 示例文档（nodeId 完整且唯一）：
 * 前言（fw-1）；第 1 章 范围（ch-scope / p-scope）；
 * 第 2 章 技术要求（ch-req）：2.1 一般要求（cl-1，含段落 p-cl-1 与表 tbl-1）、2.2 特殊要求（cl-2 / p-cl-2）；
 * 第 3 章 附加要求（ch-extra / p-extra）。
 */
export function sampleDocument(): PMJsonNode {
  return doc(
    foreword('fw', para('fw-1', '前言第一段。')),
    chapter('ch-scope', '范围', para('p-scope', '本文件规定了……')),
    chapter(
      'ch-req',
      '技术要求',
      clause(
        'cl-1',
        1,
        '一般要求',
        para('p-cl-1', '一般要求正文。'),
        simpleTable('tbl-1', '性能指标'),
      ),
      clause('cl-2', 1, '特殊要求', para('p-cl-2', '特殊要求正文。')),
    ),
    chapter('ch-extra', '附加要求', para('p-extra', '附加要求正文。')),
  );
}

/**
 * 转成库里实际保存的形态（编辑器 getJSON() 的形态：缺省属性已补齐）。
 * 要求内容的 nodeId 已经完整且唯一，否则说明用例构造有误。
 */
export function canonical(content: PMJsonNode): Record<string, unknown> {
  const { content: normalized, nodeIdsRepaired } =
    normalizeContentDetailed(content);
  if (nodeIdsRepaired) throw new Error('示例文档的 nodeId 不完整或有重复');
  return normalized as unknown as Record<string, unknown>;
}

/** 先序收集节点的 nodeId 属性（含空值）。 */
export function collectNodeIds(
  root: PMJsonNode,
  ids: unknown[] = [],
): unknown[] {
  if (root.attrs && 'nodeId' in root.attrs) ids.push(root.attrs.nodeId);
  for (const child of root.content ?? []) collectNodeIds(child, ids);
  return ids;
}
