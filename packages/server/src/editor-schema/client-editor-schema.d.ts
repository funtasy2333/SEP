/**
 * '@client/editor-schema' 的类型声明。该别名在 webpack（webpack.config.js）与 jest（package.json 的
 * moduleNameMapper）中指向 packages/client/src/extensions/editorSchema.ts；为避免 server 的 TS 程序
 * 检查 client 源码（原因见 webpack.config.js），这里手写声明，只列出服务端用到的 ProseMirror 接口。
 * 真实的 ProseMirror Schema / Node 在结构上满足下面的接口；client 侧签名变化时应同步修改这里。
 */
declare module '@client/editor-schema' {
  export interface EditorFragment {
    readonly childCount: number;
  }

  export interface EditorNodeType {
    readonly name: string;
    readonly spec: { readonly content?: string };
    validContent(content: EditorFragment): boolean;
  }

  export interface EditorNode {
    readonly type: EditorNodeType;
    readonly attrs: Readonly<Record<string, unknown>>;
    readonly content: EditorFragment;
    readonly childCount: number;
    child(index: number): EditorNode;
    /** 内容约束、属性、标记不合法时抛出 RangeError（消息可能含正文片段）。 */
    check(): void;
    toJSON(): unknown;
  }

  export interface EditorSchema {
    readonly nodes: Readonly<Record<string, EditorNodeType>>;
    readonly marks: Readonly<Record<string, unknown>>;
    readonly topNodeType: EditorNodeType;
    /** JSON 不合法（未知节点或标记类型、缺少必填属性、非数组 content 等）时抛出 RangeError。 */
    nodeFromJSON(json: unknown): EditorNode;
  }

  /** 与编辑器同一份扩展列表构建的 schema（根节点 doc）。构建有成本，调用方应缓存。 */
  export function createEditorSchema(): EditorSchema;

  /** 补齐缺失的 nodeId、重新生成重复的 nodeId，返回新文档；无需修复时返回原对象。 */
  export function normalizeNodeIds(doc: EditorNode): EditorNode;
}
