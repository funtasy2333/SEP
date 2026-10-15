import { readFileSync } from 'fs';
import { join } from 'path';
import type { PMJsonNode } from '@ses/shared';
import { EditorContentError } from './editor-content-error';
import { applyDocumentOperations } from '@ses/io';
import {
  editorContentValidator,
  getEditorSchema,
  normalizeContent,
  normalizeContentDetailed,
  validateContent,
} from './editor-schema';

/**
 * 这里用的是 client 真实的生产 schema（经别名 @client/editor-schema 加载，见 package.json 的
 * jest.moduleNameMapper / jest.client-transform.js），不是替身：节点类型与内容约束以编辑器为准。
 */

const SECRET = '机密正文-8f3a91';

const text = (value: string, marks?: PMJsonNode['marks']): PMJsonNode => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (nodeId: string | null, value: string): PMJsonNode => ({
  type: 'stdParagraph',
  attrs: { nodeId },
  content: [text(value)],
});
const chapter = (
  nodeId: string | null,
  ...children: PMJsonNode[]
): PMJsonNode => ({
  type: 'chapter',
  attrs: { nodeId },
  content: [{ type: 'chapterTitle', content: [text('范围')] }, ...children],
});
const doc = (...content: PMJsonNode[]): PMJsonNode => ({
  type: 'doc',
  content,
});

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'export', '__fixtures__', 'standard-document.json'),
    'utf8',
  ),
) as PMJsonNode;

/** 抛出的 EditorContentError；没有抛出时让用例失败。 */
function failure(content: unknown): EditorContentError {
  try {
    validateContent(content);
  } catch (error) {
    expect(error).toBeInstanceOf(EditorContentError);
    return error as EditorContentError;
  }
  throw new Error('期望校验失败，但通过了');
}

/** 先序收集所有 nodeId 属性（含空值）。 */
function nodeIdAttrs(node: PMJsonNode, ids: unknown[] = []): unknown[] {
  if (node.attrs && 'nodeId' in node.attrs) ids.push(node.attrs.nodeId);
  for (const child of node.content ?? []) nodeIdAttrs(child, ids);
  return ids;
}

describe('getEditorSchema', () => {
  it('构建一次并复用；根节点为 doc，含生产节点类型', () => {
    const schema = getEditorSchema();
    expect(getEditorSchema()).toBe(schema);
    expect(schema.topNodeType.name).toBe('doc');
    for (const name of [
      'coverPage',
      'chapter',
      'clause',
      'stdParagraph',
      'stdTable',
      'figure',
      'formula',
      'termDef',
    ]) {
      expect(Object.hasOwn(schema.nodes, name)).toBe(true);
    }
    // 编辑器不使用的旧根节点不在生产 schema 里。
    expect(Object.hasOwn(schema.nodes, 'standardDoc')).toBe(false);
  });
});

describe('validateContent', () => {
  it('合法文档通过，返回 doc 节点；不修改入参', () => {
    const input = doc(chapter('c1', paragraph('p1', '正文')));
    const snapshot = JSON.parse(JSON.stringify(input)) as unknown;
    const result = validateContent(input);
    expect(result.type.name).toBe('doc');
    expect(result.childCount).toBe(1);
    expect(input).toEqual(snapshot);
  });

  it('真实导出夹具（封面、公式、表格、图片、脚注）通过，toJSON 与夹具一致', () => {
    expect(validateContent(fixture).toJSON()).toEqual(fixture);
  });

  describe('不合法内容抛出结构化错误（含原因与定位），调用方转 422', () => {
    it('未知节点类型：给出 JSON Pointer、节点类型与 nodeId', () => {
      const error = failure(
        doc(
          chapter('c1', paragraph('p1', '正文')),
          chapter('c2', {
            type: 'clause',
            attrs: { nodeId: 'cl-1' },
            content: [
              { type: 'clauseTitle', content: [text('条')] },
              { type: 'noSuchNode', attrs: { nodeId: 'bad-1' } },
            ],
          }),
        ),
      );
      expect(error.problem).toMatchObject({
        code: 'unknown-node-type',
        path: '/content/1/content/1/content/1',
        nodeType: 'noSuchNode',
        nodeId: 'bad-1',
      });
      expect(error.problem.message).toBe('未知的节点类型「noSuchNode」');
      expect(error.message).toBe(
        '未知的节点类型「noSuchNode」（位置：/content/1/content/1/content/1）',
      );
      expect(error.name).toBe('EditorContentError');
      expect(error.toJSON()).toBe(error.problem);
      expect(error.cause).toBeInstanceOf(RangeError);
    });

    it('旧版 standardDoc 根不在生产 schema 中', () => {
      expect(
        failure({ type: 'standardDoc', content: [] }).problem,
      ).toMatchObject({
        code: 'unknown-node-type',
        path: '',
        nodeType: 'standardDoc',
      });
    });

    it('未知标记类型', () => {
      const error = failure(
        doc(
          chapter('c1', {
            type: 'stdParagraph',
            attrs: { nodeId: 'p1' },
            content: [text('正文'), text('加粗', [{ type: 'noSuchMark' }])],
          }),
        ),
      );
      expect(error.problem).toMatchObject({
        code: 'unknown-mark-type',
        path: '/content/0/content/1/content/1',
        nodeType: 'text',
      });
      expect(error.problem.message).toContain('noSuchMark');
    });

    it('违反内容约束：给出内容表达式与实际子节点，且不含正文', () => {
      // 章必须以 chapterTitle 开头；这里直接放了一个带正文的段落。
      const input = doc({
        type: 'chapter',
        attrs: { nodeId: 'c1' },
        content: [paragraph('p1', SECRET)],
      });
      const error = failure(input);
      expect(error.problem).toMatchObject({
        code: 'invalid-content',
        path: '/content/0',
        nodeType: 'chapter',
        nodeId: 'c1',
        actualChildren: ['stdParagraph'],
      });
      expect(error.problem.expectedContent).toMatch(/^chapterTitle /);
      expect(error.problem.message).toContain(
        '「chapter」的子节点不符合内容约束',
      );
      expect(error.problem.message).toContain('实际为stdParagraph');

      // ProseMirror 自己的消息带正文片段（证明下面的断言不是空转），错误的 message / problem 不得含正文。
      expect((error.cause as Error).message).toContain(SECRET.slice(0, 4));
      expect(error.message).not.toContain(SECRET.slice(0, 4));
      expect(JSON.stringify(error.problem)).not.toContain(SECRET.slice(0, 4));
    });

    it('内容约束问题报告最外层的节点（子节点自身合法时）', () => {
      // 文档根要求 block+，空 content 违反；定位在根节点。
      expect(failure({ type: 'doc', content: [] }).problem).toMatchObject({
        code: 'invalid-content',
        path: '',
        nodeType: 'doc',
        actualChildren: [],
        expectedContent: 'block+',
      });
    });

    it('子节点序列很长时只列出前 20 个类型', () => {
      const error = failure(
        doc({
          type: 'chapter',
          content: Array.from({ length: 30 }, () => paragraph(null, '正文')),
        }),
      );
      expect(error.problem.code).toBe('invalid-content');
      expect(error.problem.path).toBe('/content/0');
      expect(error.problem.actualChildren).toHaveLength(20);
      expect(error.problem.message).toContain('…');
    });

    it('根节点不是 doc', () => {
      const error = failure(paragraph('p1', '正文'));
      expect(error.problem).toMatchObject({
        code: 'invalid-root',
        path: '',
        nodeType: 'stdParagraph',
      });
      expect(error.problem.message).toBe(
        '文档根节点必须是「doc」，实际为「stdParagraph」',
      );
    });

    it('节点或字段的形状不对', () => {
      const cases: [unknown, string, string][] = [
        [null, '', '节点必须是对象'],
        ['text', '', '节点必须是对象'],
        [[], '', '节点必须是对象'],
        [{}, '', '节点缺少字符串类型 type'],
        [{ type: 5 }, '', '节点缺少字符串类型 type'],
        [{ type: 'doc', content: [null] }, '/content/0', '节点必须是对象'],
        [
          { type: 'doc', content: [{ type: 'text' }] },
          '/content/0',
          '文本节点的 text 必须是字符串',
        ],
        [
          { type: 'doc', content: [{ type: 'text', text: '' }] },
          '/content/0',
          '文本节点不能为空',
        ],
        [{ type: 'doc', content: 'x' }, '', '「doc」节点的 content 必须是数组'],
        [
          {
            type: 'doc',
            content: [{ type: 'text', text: 'x', marks: 'bold' }],
          },
          '/content/0',
          '「text」节点的 marks 必须是数组',
        ],
        [
          { type: 'doc', content: [{ type: 'text', text: 'x', marks: [{}] }] },
          '/content/0',
          '「text」节点的标记缺少字符串类型 type',
        ],
      ];
      for (const [input, path, message] of cases) {
        const error = failure(input);
        expect(error.problem.code).toBe('invalid-node');
        expect([path, error.problem.message]).toEqual([path, message]);
        expect(error.problem.path).toBe(path);
      }
    });

    it('标记集合不合法（check 才发现）：定位到节点，附 ProseMirror 的属性/标记类消息', () => {
      const error = failure(
        doc(
          chapter('c1', {
            type: 'stdParagraph',
            attrs: { nodeId: 'p1' },
            content: [text('正文', [{ type: 'bold' }, { type: 'bold' }])],
          }),
        ),
      );
      expect(error.problem).toMatchObject({
        code: 'invalid-attrs',
        path: '/content/0/content/1/content/0',
        nodeType: 'text',
      });
      expect(error.problem.detail).toContain('Invalid collection of marks');
    });

    it('回显的类型名被截断并去掉控制字符', () => {
      const error = failure({ type: `bad\n${'x'.repeat(100)}` });
      expect(error.problem.code).toBe('unknown-node-type');
      expect(error.problem.nodeType).toHaveLength(41);
      expect(error.problem.nodeType).not.toMatch(/\p{Cc}/u);
      expect(error.problem.nodeType!.startsWith('bad?')).toBe(true);
    });

    it('nodeId 过长或含控制字符时同样被截断、清理', () => {
      const error = failure(
        doc({
          type: 'noSuchNode',
          attrs: { nodeId: `a\nb${'y'.repeat(100)}` },
        }),
      );
      expect(error.problem.nodeId).toHaveLength(41);
      expect(error.problem.nodeId).not.toMatch(/\p{Cc}/u);
    });
  });
});

describe('normalizeContent', () => {
  it('补齐缺失（null）的 nodeId，全文档唯一，保留已有 ID', () => {
    const input = doc(
      chapter(null, paragraph(null, '正文一'), paragraph('keep-me', '正文二')),
    );
    const before = nodeIdAttrs(input);
    expect(before).toContain(null);

    const output = normalizeContent(input);
    const ids = nodeIdAttrs(output);
    expect(ids.every((id) => typeof id === 'string' && id !== '')).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('keep-me');
    // 不修改入参。
    expect(nodeIdAttrs(input)).toEqual(before);
  });

  it('重复的 nodeId：保留文档顺序中的首个，其余重新生成', () => {
    const input = doc(
      chapter(
        'c1',
        paragraph('dup', '第一处'),
        paragraph('dup', '第二处'),
        paragraph('dup', '第三处'),
      ),
    );
    const output = normalizeContent(input);
    const chapterNode = output.content![0];
    const [, first, second, third] = chapterNode.content!;
    expect(first.attrs!.nodeId).toBe('dup');
    expect(second.attrs!.nodeId).not.toBe('dup');
    expect(third.attrs!.nodeId).not.toBe('dup');
    const ids = nodeIdAttrs(output);
    expect(new Set(ids).size).toBe(ids.length);
    // 内容本身不变。
    expect(second.content![0].text).toBe('第二处');
  });

  it('无需修复时幂等：再规范化一次内容不变', () => {
    const once = normalizeContent(fixture);
    expect(nodeIdAttrs(once).every((id) => typeof id === 'string')).toBe(true);
    expect(normalizeContent(once)).toEqual(once);
  });

  it('返回可直接序列化的 PM JSON（缺省属性已补齐），与夹具的差别只有补出的 nodeId', () => {
    const output = normalizeContent(fixture);
    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
    const stripIds = (node: PMJsonNode): PMJsonNode => ({
      ...node,
      ...(node.attrs && 'nodeId' in node.attrs
        ? { attrs: { ...node.attrs, nodeId: null } }
        : {}),
      ...(node.content ? { content: node.content.map(stripIds) } : {}),
    });
    expect(stripIds(output)).toEqual(stripIds(fixture));
  });

  it('先校验：不合法内容抛出 EditorContentError，不做规范化', () => {
    expect(() =>
      normalizeContent(doc({ type: 'noSuchNode', attrs: { nodeId: null } })),
    ).toThrow(EditorContentError);
    expect(() => normalizeContent(doc(paragraph(null, '正文')))).not.toThrow();
    expect(() => normalizeContent({ type: 'doc', content: [] })).toThrow(
      EditorContentError,
    );
  });
});

describe('normalizeContentDetailed', () => {
  it('报告是否修复了 nodeId：缺失或重复为 true，完整且唯一为 false（与编辑器的 hasNodeIdIssues 一致）', () => {
    const missing = normalizeContentDetailed(
      doc(chapter('c1', paragraph(null, '缺 id'))),
    );
    expect(missing.nodeIdsRepaired).toBe(true);

    const duplicated = normalizeContentDetailed(
      doc(chapter('c1', paragraph('dup', '甲'), paragraph('dup', '乙'))),
    );
    expect(duplicated.nodeIdsRepaired).toBe(true);

    const clean = normalizeContentDetailed(
      doc(chapter('c1', paragraph('p1', '甲'), paragraph('p2', '乙'))),
    );
    expect(clean.nodeIdsRepaired).toBe(false);
    // 修复过的内容再检查就是完整的。
    expect(normalizeContentDetailed(missing.content).nodeIdsRepaired).toBe(
      false,
    );
    expect(normalizeContentDetailed(duplicated.content).nodeIdsRepaired).toBe(
      false,
    );
  });

  it('content 与 normalizeContent 一致；校验失败同样抛出 EditorContentError', () => {
    const input = doc(chapter('c1', paragraph('p1', '正文')));
    expect(normalizeContentDetailed(input).content).toEqual(
      normalizeContent(input),
    );
    expect(() => normalizeContentDetailed({ type: 'doc' })).toThrow(
      EditorContentError,
    );
  });
});

describe('editorContentValidator（注入文档操作引擎的 ContentValidator）', () => {
  it('合法内容返回 ok 与规范化后的文档（补齐 nodeId），不抛异常', () => {
    const input = doc(chapter('c1', paragraph(null, '正文')));
    const result = editorContentValidator(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = nodeIdAttrs(result.content!);
    expect(ids.every((id) => typeof id === 'string' && id !== '')).toBe(true);
  });

  it('不合法内容用返回值表达（不抛异常）：message、code、path、nodeId；消息不含正文', () => {
    const result = editorContentValidator(
      doc({
        type: 'chapter',
        attrs: { nodeId: 'c1' },
        content: [paragraph('p1', SECRET)],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result).toMatchObject({
      code: 'invalid-content',
      path: '/content/0',
      nodeId: 'c1',
    });
    expect(result.message).toContain('子节点不符合内容约束');
    expect(JSON.stringify(result)).not.toContain(SECRET);

    const unknown = editorContentValidator(
      doc({ type: 'mystery', attrs: { nodeId: 'bad' } }),
    );
    expect(unknown).toMatchObject({
      ok: false,
      code: 'unknown-node-type',
      path: '/content/0',
      nodeId: 'bad',
    });
  });

  it('接入引擎：操作后的文档不符合生产 schema 时，引擎返回 schema-invalid 问题（带 nodeId），而不是抛异常', () => {
    // 引擎自己不认识生产 schema，只在最后调用注入的校验器。这里的起始文档本身不合法
    //（章里没有 chapterTitle），任何操作之后校验器都会拒绝。
    const invalid = doc(
      {
        type: 'chapter',
        attrs: { nodeId: 'c1' },
        content: [paragraph('p1', SECRET)],
      },
      chapter('c2', paragraph('p2', '乙')),
    );
    const result = applyDocumentOperations(
      invalid,
      [{ op: 'delete', nodeId: 'p2' }],
      { validateContent: editorContentValidator },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: 'schema-invalid',
      path: 'document',
      nodeId: 'c1',
    });
    expect(result.issues[0].reason).toContain('未通过编辑器 schema 校验');
    expect(result.issues[0].reason).toContain('/content/0');
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
