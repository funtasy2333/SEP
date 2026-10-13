import type { PMJsonNode } from '@ses/shared';
import type { ExportWarning } from './export-http';

/** 与 DOCX 导出拒绝抓取图片时的提示一致（见 export.service.ts 的 rejectAllFetcher）。 */
export const EXTERNAL_IMAGE_REJECTED_MESSAGE =
  '服务端导出不访问网络资源，请使用内嵌（data URL）图片';

/** 内嵌图片：只有 data URL 不会让渲染端发起任何请求。其余写法（含前导空白）一律视为外部资源。 */
function isInlineImage(src: string): boolean {
  return /^data:/i.test(src);
}

/**
 * 服务端 PDF 导出不访问网络资源，与 DOCX 导出的 SSRF 约定一致。
 *
 * DOCX 路径里图片由 io 的 collectImageResources 读取，服务端传入拒绝一切请求的 fetcher；
 * PDF 路径把 print HTML 交给 Vivliostyle 的无头 Chromium 渲染，`<img src>` 会被浏览器直接抓取，
 * 文档内容可能来自 AI 或他人，等于让服务端按文档里的 URL 发请求。因此在构建 print HTML 之前，
 * 把 figureImage 中所有非 data URL 的 src 清空（空 src 浏览器不发请求，版面上只留图的位置与题注），
 * 并以与 DOCX 相同的 `image-resource-failed` 告警返回，由接口放进 X-SES-Export-Warning* 响应头。
 *
 * 就地修改传入的文档（调用方持有的是 synchronizeCoverMetadata 返回的私有副本）。
 */
export function blockExternalImages(pmDoc: PMJsonNode): ExportWarning[] {
  const warnings: ExportWarning[] = [];

  const visit = (node: PMJsonNode, figureId: string | undefined): void => {
    const src = node.attrs?.src;
    if (
      node.type === 'figureImage' &&
      typeof src === 'string' &&
      src !== '' &&
      !isInlineImage(src)
    ) {
      node.attrs = { ...node.attrs, src: '' };
      warnings.push({
        code: 'image-resource-failed',
        ...(figureId === undefined ? {} : { nodeId: figureId }),
        message: EXTERNAL_IMAGE_REJECTED_MESSAGE,
      });
    }
    const ownId = node.attrs?.nodeId;
    const childFigureId =
      node.type === 'figure' && typeof ownId === 'string' ? ownId : figureId;
    for (const child of node.content ?? []) visit(child, childFigureId);
  };
  visit(pmDoc, undefined);
  return warnings;
}
