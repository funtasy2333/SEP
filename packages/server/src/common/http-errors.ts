import { UnprocessableEntityException } from '@nestjs/common';
import type { EditorContentError } from '../editor-schema/editor-content-error';

/** 422：请求本身格式正确，但文档当前的内容或状态不允许处理。响应体与导出接口一致。 */
export function unprocessable(
  message: string,
  extra: Record<string, unknown> = {},
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: 422,
    error: 'Unprocessable Entity',
    message,
    ...extra,
  });
}

/**
 * 文档内容不符合编辑器生产 schema 时，422 响应体里的附加字段（source / detail / problems）。
 * problems 只含结构信息（代码、JSON Pointer、节点类型与 nodeId），不含正文。
 */
export function schemaProblemDetails(
  error: EditorContentError,
): Record<string, unknown> {
  return {
    source: 'schema',
    detail: error.message,
    problems: [{ source: 'schema', ...error.problem }],
  };
}
