export type EditorContentProblemCode =
  /** 节点不是对象、缺少 type、text/content/marks 的形状不对，或属性不合法。 */
  | 'invalid-node'
  | 'unknown-node-type'
  | 'unknown-mark-type'
  /** 文档根节点不是 schema 的顶层节点（doc）。 */
  | 'invalid-root'
  /** 子节点序列违反该节点的内容约束。 */
  | 'invalid-content'
  /** 通过 JSON 解析但 check() 不通过：属性值类型不对、标记集合不合法等。 */
  | 'invalid-attrs';

/**
 * 内容校验失败的定位信息。除 nodeType（未知类型时为调用方给出的字符串，已截断）外，
 * 所有字段都只含结构信息，不含文档正文，可以放进接口响应；错误日志只应记录 code 与 path。
 */
export interface EditorContentProblem {
  code: EditorContentProblemCode;
  /** 中文原因，不含正文片段。 */
  message: string;
  /**
   * 出错节点在被校验的文档 JSON 中的位置，RFC 6901 JSON Pointer，根节点为空串，
   * 例如 `/content/2/content/0` 是文档第 3 个顶层节点的第 1 个子节点。
   */
  path: string;
  nodeType?: string;
  /** 出错节点的 nodeId 属性（有则给，比 path 更稳定：不受前面节点增删影响）。 */
  nodeId?: string;
  /** invalid-content：该节点类型的内容表达式，如 `chapterTitle block*`。 */
  expectedContent?: string;
  /** invalid-content：实际的子节点类型序列（超过 20 个时只给前 20 个）。 */
  actualChildren?: string[];
  /**
   * 属性类问题（缺少必填属性、属性值类型不符、标记集合不合法）附带的 ProseMirror 原始消息（英文，截断），
   * 这类消息只含属性名、类型名与标记名。内容约束类消息带正文片段，从不放在这里。
   */
  detail?: string;
}

/**
 * 文档内容不符合编辑器的生产 schema。属于调用方输入问题，调用方应转成 422，
 * 不是服务端故障。`cause` 保存 ProseMirror 原始错误，其消息可能带正文片段，不要写日志或放进响应。
 */
export class EditorContentError extends Error {
  readonly problem: EditorContentProblem;

  constructor(problem: EditorContentProblem, cause?: unknown) {
    super(
      `${problem.message}（位置：${problem.path === '' ? '文档根节点' : problem.path}）`,
      { cause },
    );
    this.name = 'EditorContentError';
    this.problem = problem;
  }

  toJSON(): EditorContentProblem {
    return this.problem;
  }
}
