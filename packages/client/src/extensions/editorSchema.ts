import { getSchema } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { createEditorExtensions } from './editorExtensions'

/**
 * 服务端（@ses/server）加载生产 schema 的入口：服务端的 webpack 构建与 jest 都以别名
 * `@client/editor-schema` 指向本文件，并把它的依赖链打入产物，用来校验文档内容。
 *
 * 为什么单独一个文件：getSchema 来自 @tiptap/core，而服务端没有也不应声明 @tiptap/* 依赖；
 * 经由本文件，服务端只看到 createEditorSchema()，@tiptap/* 一律按本文件所在位置（client 的
 * node_modules）解析并打入产物。
 *
 * 约束（由 editorSchema.node.test.ts 守护）：本文件及整条扩展依赖链在模块加载时不得访问
 * window / document 等浏览器对象，也不得使用 `@/` 别名导入（服务端的构建不认识它）。
 */

/** 与编辑器（EditorView 的 useEditor）使用同一份扩展列表构建的 ProseMirror schema，根节点为 doc。 */
export function createEditorSchema(): Schema {
  return getSchema(createEditorExtensions())
}

export { normalizeNodeIds } from './plugins/ensureNodeId'
