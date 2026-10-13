import {
  createEditorSchema,
  normalizeNodeIds,
  type EditorNode,
  type EditorSchema,
} from '@client/editor-schema';
import type { PMJsonNode } from '@ses/shared';
import {
  EditorContentError,
  type EditorContentProblem,
} from './editor-content-error';

/**
 * 服务端校验文档内容所用的编辑器生产 schema（client 的 Tiptap 扩展构建，与 EditorView 的 useEditor 同一份
 * 扩展列表，根节点 doc）。引用方式与打包取舍见 webpack.config.js；扩展必须能在无 DOM 的 Node 环境加载，
 * 由 client 的 editorSchema.node.test.ts 守护。
 */

/** actualChildren 最多列出的子节点类型数。 */
const MAX_LISTED_CHILDREN = 20;
/** 回显调用方给出的类型名等字符串时的最大长度。 */
const MAX_ECHOED_LENGTH = 40;
/** invalid-attrs / 属性类 invalid-node 附带的 ProseMirror 原始消息最大长度。 */
const MAX_DETAIL_LENGTH = 200;

let editorSchema: EditorSchema | undefined;

/** 构建一次并复用：扩展列表有数十个节点，每次校验都重建是浪费。 */
export function getEditorSchema(): EditorSchema {
  editorSchema ??= createEditorSchema();
  return editorSchema;
}

/**
 * 按编辑器的生产 schema 校验文档内容（PM JSON，根节点 doc），等价于编辑器加载文档时的
 * `schema.nodeFromJSON(content)` + `check()`，并要求根节点是 doc。
 * 通过时返回 ProseMirror 文档；不通过抛出 {@link EditorContentError}（调用方转 422），
 * 其中 `problem` 给出原因与定位（JSON Pointer、节点类型、nodeId）。不修改入参。
 */
export function validateContent(content: unknown): EditorNode {
  const schema = getEditorSchema();

  let doc: EditorNode;
  try {
    doc = schema.nodeFromJSON(content);
  } catch (error) {
    throw new EditorContentError(
      describeJsonProblem(
        schema,
        locateJsonFailure(schema, content, [], error),
      ),
      error,
    );
  }

  if (doc.type.name !== schema.topNodeType.name) {
    throw new EditorContentError({
      code: 'invalid-root',
      message: `文档根节点必须是「${schema.topNodeType.name}」，实际为「${doc.type.name}」`,
      path: '',
      nodeType: doc.type.name,
    });
  }

  try {
    doc.check();
  } catch (error) {
    throw new EditorContentError(describeCheckProblem(doc, [], error), error);
  }
  return doc;
}

/**
 * 校验后执行 nodeId 规范化（补齐缺失的 nodeId，重复的重新生成，与编辑器 NodeId 插件同一策略），
 * 返回 PM JSON（编辑器 getJSON() 的形态，缺省属性已补齐）。校验失败的行为同 {@link validateContent}。
 */
export function normalizeContent(content: unknown): PMJsonNode {
  return normalizeNodeIds(validateContent(content)).toJSON() as PMJsonNode;
}

type PathSegment = string | number;

/** RFC 6901 JSON Pointer；段只有 'content' 与数组下标，不需要转义。 */
function toPointer(segments: readonly PathSegment[]): string {
  return segments.map((segment) => `/${segment}`).join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 回显调用方给出的字符串前去掉控制字符并截断，避免长文本或换行进入响应。 */
function echoable(value: string): string {
  const clean = value.replace(/\p{Cc}/gu, '?');
  return clean.length > MAX_ECHOED_LENGTH
    ? `${clean.slice(0, MAX_ECHOED_LENGTH)}…`
    : clean;
}

function errorDetail(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : undefined;
  return message ? message.slice(0, MAX_DETAIL_LENGTH) : undefined;
}

function nodeIdOf(attrs: unknown): string | undefined {
  if (!isRecord(attrs)) return undefined;
  const nodeId = attrs.nodeId;
  return typeof nodeId === 'string' && nodeId !== ''
    ? echoable(nodeId)
    : undefined;
}

interface JsonFailure {
  segments: PathSegment[];
  json: unknown;
  error: unknown;
}

/**
 * nodeFromJSON 只抛 RangeError、不说明位置。这里自顶向下二分：某个子树单独解析仍失败，
 * 就进入该子树；所有子树都能解析，说明问题在当前节点自身（类型、marks、text、属性）。
 * 只在失败路径上运行，代价为节点数 × 深度。
 */
function locateJsonFailure(
  schema: EditorSchema,
  json: unknown,
  segments: PathSegment[],
  error: unknown,
): JsonFailure {
  const children =
    isRecord(json) && Array.isArray(json.content)
      ? (json.content as unknown[])
      : [];
  for (let index = 0; index < children.length; index++) {
    try {
      schema.nodeFromJSON(children[index]);
    } catch (childError) {
      return locateJsonFailure(
        schema,
        children[index],
        [...segments, 'content', index],
        childError,
      );
    }
  }
  return { segments, json, error };
}

function describeJsonProblem(
  schema: EditorSchema,
  { segments, json, error }: JsonFailure,
): EditorContentProblem {
  const path = toPointer(segments);
  if (!isRecord(json)) {
    return { code: 'invalid-node', message: '节点必须是对象', path };
  }
  const type = json.type;
  if (typeof type !== 'string' || type === '') {
    return {
      code: 'invalid-node',
      message: '节点缺少字符串类型 type',
      path,
      nodeId: nodeIdOf(json.attrs),
    };
  }
  const nodeType = echoable(type);
  const nodeId = nodeIdOf(json.attrs);
  const at = { path, nodeType, nodeId };

  if (json.marks !== undefined && json.marks !== null) {
    if (!Array.isArray(json.marks)) {
      return {
        code: 'invalid-node',
        message: `「${nodeType}」节点的 marks 必须是数组`,
        ...at,
      };
    }
    for (const mark of json.marks as unknown[]) {
      const markType = isRecord(mark) ? mark.type : undefined;
      if (typeof markType !== 'string') {
        return {
          code: 'invalid-node',
          message: `「${nodeType}」节点的标记缺少字符串类型 type`,
          ...at,
        };
      }
      if (!Object.hasOwn(schema.marks, markType)) {
        return {
          code: 'unknown-mark-type',
          message: `「${nodeType}」节点使用了未知的标记类型「${echoable(markType)}」`,
          ...at,
        };
      }
    }
  }

  if (type === 'text') {
    if (typeof json.text !== 'string') {
      return {
        code: 'invalid-node',
        message: '文本节点的 text 必须是字符串',
        ...at,
      };
    }
    if (json.text === '') {
      return { code: 'invalid-node', message: '文本节点不能为空', ...at };
    }
  } else if (!Object.hasOwn(schema.nodes, type)) {
    return {
      code: 'unknown-node-type',
      message: `未知的节点类型「${nodeType}」`,
      ...at,
    };
  }

  if (
    json.content !== undefined &&
    json.content !== null &&
    !Array.isArray(json.content)
  ) {
    return {
      code: 'invalid-node',
      message: `「${nodeType}」节点的 content 必须是数组`,
      ...at,
    };
  }

  // 其余是属性问题（缺少必填属性、属性值类型不符）。这类 ProseMirror 消息只含属性名与类型名。
  return {
    code: 'invalid-node',
    message: `「${nodeType}」节点的属性不合法`,
    detail: errorDetail(error),
    ...at,
  };
}

/**
 * check() 只抛出 RangeError、不说明位置，且内容约束类消息带有正文片段（不能使用）。
 * 自顶向下定位：先看当前节点的内容约束（最外层优先），再进入第一个 check() 失败的子节点；
 * 子节点都通过，则是当前节点自身的属性或标记问题。调用时 node.check() 已确认失败。
 */
function describeCheckProblem(
  node: EditorNode,
  segments: PathSegment[],
  error: unknown,
): EditorContentProblem {
  const path = toPointer(segments);
  const nodeType = node.type.name;
  const nodeId = nodeIdOf(node.attrs);

  if (!node.type.validContent(node.content)) {
    const expected = node.type.spec.content;
    const children: string[] = [];
    for (let index = 0; index < node.childCount; index++) {
      children.push(node.child(index).type.name);
    }
    const listed = children.slice(0, MAX_LISTED_CHILDREN);
    const actual = listed.length
      ? listed.join('、') + (children.length > listed.length ? '…' : '')
      : '空';
    return {
      code: 'invalid-content',
      message:
        `「${nodeType}」的子节点不符合内容约束：` +
        `要求${expected ? `「${expected}」` : '无子节点'}，实际为${actual}`,
      path,
      nodeType,
      nodeId,
      expectedContent: expected || undefined,
      actualChildren: listed,
    };
  }

  for (let index = 0; index < node.childCount; index++) {
    const child = node.child(index);
    try {
      child.check();
    } catch (childError) {
      return describeCheckProblem(
        child,
        [...segments, 'content', index],
        childError,
      );
    }
  }

  return {
    code: 'invalid-attrs',
    message: `「${nodeType}」节点的属性或标记不合法`,
    path,
    nodeType,
    nodeId,
    detail: errorDetail(error),
  };
}
