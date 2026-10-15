/**
 * 文档操作引擎（WP9.2c1）：AI 读取文档结构、读取节点、批量修改文档的纯函数核心。
 *
 * - {@link buildOutline}：结构树（章、条、附录、术语、表、图、公式的 nodeId、编号、标题）；
 * - {@link readNode} / {@link readContainer}：读取节点 IR 与替换它应使用的上下文，标出不可整体替换的节点；
 * - {@link applyDocumentOperations}：insert / replace / delete / move 的批量执行，全有或全无。
 *
 * 同构、无副作用；生产 schema 校验由宿主通过 `validateContent` 注入。
 */

export { buildOutline } from './outline'
export { readContainer, readNode } from './readNode'
export { applyDocumentOperations } from './apply'
export { parseDocumentOperations } from './operations'
export type { ParseDocumentOperationsResult } from './operations'
export { DOCUMENT_CONTAINERS, DOCUMENT_OPERATION_NAMES } from './types'
export type {
  ApplyDocumentOperationsFailure,
  ApplyDocumentOperationsOptions,
  ApplyDocumentOperationsResult,
  ApplyDocumentOperationsSuccess,
  ContentValidationFailure,
  ContentValidationResult,
  ContentValidator,
  DeleteOperation,
  DocumentContainer,
  DocumentOperation,
  DocumentOperationIssue,
  DocumentOperationIssueCode,
  DocumentOperationName,
  DocumentOperationWarning,
  DocumentOutline,
  DocumentProblem,
  EngineIssueCode,
  FrontMatterOutline,
  InsertOperation,
  InsertPosition,
  MoveOperation,
  NodeKind,
  NotReplaceableReason,
  OperationEffect,
  OutlineItem,
  OutlineKind,
  ParentRef,
  ReadContainerInfo,
  ReadContainerResult,
  ReadNodeInfo,
  ReadNodeResult,
  ReplaceOperation,
} from './types'
