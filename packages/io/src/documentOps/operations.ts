/**
 * 操作输入的结构校验（WP9.2c1）。
 *
 * 操作来自 MCP/REST 的 JSON，不可信：这里只检查形状（未知操作、未知字段、缺字段、类型），
 * 不看文档；片段内容（`content`）原样交给 shared 的 `normalizeAuthoringFragment` 在执行时检查。
 * 一次报出全部问题，不在第一个错误处停下。
 */

import {
  DOCUMENT_OPERATION_NAMES,
  type DeleteOperation,
  type DocumentOperation,
  type DocumentOperationIssue,
  type DocumentOperationIssueCode,
  type DocumentOperationName,
  type InsertOperation,
  type InsertPosition,
  type MoveOperation,
  type ReplaceOperation,
} from './types'

type Obj = Record<string, unknown>
const isObj = (value: unknown): value is Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** 各操作支持的字段（含 `op`）。 */
const OPERATION_FIELDS: Record<DocumentOperationName, readonly string[]> = {
  insert: ['op', 'parent', 'position', 'content'],
  replace: ['op', 'nodeId', 'content', 'acceptLoss'],
  delete: ['op', 'nodeId'],
  move: ['op', 'nodeId', 'parent', 'position'],
}

const POSITION_HINT = "'start'、'end'、{ \"before\": nodeId } 或 { \"after\": nodeId }"

export interface ParsedOperation {
  index: number
  /** 结构合法时的操作；否则为 undefined，`issues` 非空。 */
  operation?: DocumentOperation
  issues: DocumentOperationIssue[]
}

export interface ParsedOperations {
  /** 整批级问题（operations 不是非空数组）。 */
  batchIssues: DocumentOperationIssue[]
  items: ParsedOperation[]
}

function issue(
  index: number, path: string, code: DocumentOperationIssueCode, reason: string,
): DocumentOperationIssue {
  return { operationIndex: index, path, code, reason }
}

function parsePosition(
  value: unknown, index: number, path: string, issues: DocumentOperationIssue[],
): InsertPosition | undefined {
  if (value === undefined) {
    issues.push(issue(index, path, 'missing-field', `缺少 position：${POSITION_HINT}`))
    return undefined
  }
  if (value === 'start' || value === 'end') return value
  if (isObj(value)) {
    const keys = Object.keys(value).filter(key => value[key] !== undefined)
    const key = keys[0]
    if (keys.length === 1 && (key === 'before' || key === 'after')) {
      const anchor = value[key]
      if (typeof anchor === 'string' && anchor.length > 0) {
        return key === 'before' ? { before: anchor } : { after: anchor }
      }
      issues.push(issue(index, `${path}.${key}`, 'invalid-type', `「${key}」必须是非空字符串（锚点节点的 nodeId）`))
      return undefined
    }
  }
  issues.push(issue(index, path, 'invalid-value', `position 必须是 ${POSITION_HINT}（before 与 after 不能同时给出）`))
  return undefined
}

function requiredString(
  obj: Obj, key: string, index: number, path: string, what: string, issues: DocumentOperationIssue[],
): string | undefined {
  const value = obj[key]
  if (value === undefined) {
    issues.push(issue(index, `${path}.${key}`, 'missing-field', `缺少「${key}」（${what}）`))
    return undefined
  }
  if (typeof value !== 'string' || value.length === 0) {
    issues.push(issue(index, `${path}.${key}`, 'invalid-type', `「${key}」必须是非空字符串（${what}）`))
    return undefined
  }
  return value
}

function parseOne(raw: unknown, index: number): ParsedOperation {
  const path = `operations[${index}]`
  const issues: DocumentOperationIssue[] = []
  if (!isObj(raw)) {
    issues.push(issue(index, path, 'invalid-type', `操作必须是对象，如 {"op": "delete", "nodeId": "…"}（支持的 op：${DOCUMENT_OPERATION_NAMES.join('、')}）`))
    return { index, issues }
  }
  const name = raw.op
  if (name === undefined) {
    issues.push(issue(index, `${path}.op`, 'missing-field', `缺少 op（支持：${DOCUMENT_OPERATION_NAMES.join('、')}）`))
    return { index, issues }
  }
  if (typeof name !== 'string' || !(DOCUMENT_OPERATION_NAMES as readonly string[]).includes(name)) {
    const shown = typeof name === 'string' ? `「${name}」` : '（非字符串）'
    issues.push(issue(index, `${path}.op`, 'unknown-operation', `未知的操作${shown}（支持：${DOCUMENT_OPERATION_NAMES.join('、')}）`))
    return { index, issues }
  }
  const operationName = name as DocumentOperationName
  const supported = OPERATION_FIELDS[operationName]
  for (const key of Object.keys(raw)) {
    if (supported.includes(key) || raw[key] === undefined) continue
    issues.push(issue(index, `${path}.${key}`, 'unknown-field', key === 'acceptLoss'
      ? 'acceptLoss 只能用于 replace 操作（接受整体替换造成的内容丢失）'
      : `「${operationName}」操作没有字段「${key}」（支持：${supported.filter(field => field !== 'op').join('、')}）；请检查拼写`))
  }

  switch (operationName) {
    case 'insert': {
      const parent = requiredString(raw, 'parent', index, path, '容器名或章/条/附录的 nodeId', issues)
      const position = parsePosition(raw.position, index, `${path}.position`, issues)
      if (raw.content === undefined) issues.push(issue(index, `${path}.content`, 'missing-field', '缺少 content（写作片段：节点数组）'))
      if (issues.length > 0 || parent === undefined || position === undefined) return { index, issues }
      const operation: InsertOperation = { op: 'insert', parent, position, content: raw.content }
      return { index, operation, issues }
    }
    case 'replace': {
      const nodeId = requiredString(raw, 'nodeId', index, path, '被替换节点的 nodeId', issues)
      if (raw.content === undefined) issues.push(issue(index, `${path}.content`, 'missing-field', '缺少 content（写作片段：节点数组）'))
      const acceptLoss = raw.acceptLoss
      if (acceptLoss !== undefined && typeof acceptLoss !== 'boolean') {
        issues.push(issue(index, `${path}.acceptLoss`, 'invalid-type', 'acceptLoss 必须是 true 或 false'))
      }
      if (issues.length > 0 || nodeId === undefined) return { index, issues }
      const operation: ReplaceOperation = {
        op: 'replace', nodeId, content: raw.content, ...(typeof acceptLoss === 'boolean' ? { acceptLoss } : {}),
      }
      return { index, operation, issues }
    }
    case 'delete': {
      const nodeId = requiredString(raw, 'nodeId', index, path, '被删除节点的 nodeId', issues)
      if (issues.length > 0 || nodeId === undefined) return { index, issues }
      const operation: DeleteOperation = { op: 'delete', nodeId }
      return { index, operation, issues }
    }
    case 'move': {
      const nodeId = requiredString(raw, 'nodeId', index, path, '被移动节点的 nodeId', issues)
      const parent = requiredString(raw, 'parent', index, path, '目标容器名或章/条/附录的 nodeId', issues)
      const position = parsePosition(raw.position, index, `${path}.position`, issues)
      if (issues.length > 0 || nodeId === undefined || parent === undefined || position === undefined) return { index, issues }
      const operation: MoveOperation = { op: 'move', nodeId, parent, position }
      return { index, operation, issues }
    }
  }
}

/** 逐个检查操作的形状；整批问题与逐操作结果分开返回，供执行阶段在个别操作无效时继续检查其余操作。 */
export function parseOperations(input: unknown): ParsedOperations {
  if (!Array.isArray(input)) {
    return {
      batchIssues: [{
        path: 'operations', code: 'invalid-operations',
        reason: 'operations 必须是操作数组（单个操作也要放进数组）',
      }],
      items: [],
    }
  }
  if (input.length === 0) {
    return {
      batchIssues: [{
        path: 'operations', code: 'invalid-operations',
        reason: 'operations 不能为空；至少给出一个 insert、replace、delete 或 move 操作',
      }],
      items: [],
    }
  }
  return { batchIssues: [], items: input.map((raw, index) => parseOne(raw, index)) }
}

export type ParseDocumentOperationsResult =
  | { ok: true; operations: DocumentOperation[] }
  | { ok: false; issues: DocumentOperationIssue[] }

/**
 * 只做结构校验，不看文档（宿主可在接口入口先调用它，尽早以 400 拒绝形状错误的请求）。
 * 全部合法时返回类型化的操作列表，否则返回全部问题。
 */
export function parseDocumentOperations(input: unknown): ParseDocumentOperationsResult {
  const parsed = parseOperations(input)
  const issues = [...parsed.batchIssues, ...parsed.items.flatMap(item => item.issues)]
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, operations: parsed.items.map(item => item.operation!) }
}
