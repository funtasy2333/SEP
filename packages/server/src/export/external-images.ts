import type { PMJsonNode } from '@ses/shared';
import type { ExportWarning } from './export-http';

/**
 * 服务端导出拒绝访问网络资源时的提示，DOCX（export.service.ts 的 rejectAllFetcher 抛出的错误消息）
 * 与 PDF（本文件的告警消息）共用这一个常量，两种格式的告警文本因此一致。
 */
export const EXTERNAL_IMAGE_REJECTED_MESSAGE =
  '服务端导出不访问网络资源，请使用内嵌（data URL）图片';

/** 内嵌图片：只有 data URL 不会让渲染端发起任何请求。其余写法（含前导空白）一律视为外部资源。 */
export function isInlineImage(src: string): boolean {
  return /^data:/i.test(src);
}

/** 以 `src` 属性承载图片地址的节点类型：图的主图、行内图、Tiptap 通用图片。 */
const IMAGE_NODE_TYPES: ReadonlySet<string> = new Set([
  'figureImage',
  'inlineImage',
  'image',
]);

function isExternalSrc(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !isInlineImage(value);
}

/**
 * 服务端 PDF 导出不访问网络资源，与 DOCX 导出的 SSRF 约定一致。
 *
 * DOCX 路径里图片由 io 的 collectImageResources 读取，服务端传入拒绝一切请求的 fetcher；
 * PDF 路径把 print HTML 交给 Vivliostyle 的无头 Chromium 渲染，`<img src>` 会被浏览器直接抓取，
 * 文档内容可能来自 AI 或他人，等于让服务端按文档里的 URL 发请求。因此在构建 print HTML 之前，
 * 把文档里所有承载图片地址的位置中非 data URL 的值清空（空 src 浏览器不发请求，版面上只留图的位置与题注），
 * 并以与 DOCX 相同的 `image-resource-failed` 告警返回，由接口放进 X-SES-Export-Warning* 响应头。
 *
 * 清空的位置（按属性而非按渲染结果判断，渲染器今后输出更多图片时不会漏）：
 * - figureImage / inlineImage / Tiptap 通用 image 节点的 `attrs.src`；
 * - 任意节点 `attrs.additionalGraphics[].src`（figure 的附加图形）；
 * - 任意节点 `attrs.alternativeGraphic.src`（stdTable 的替代图形）。
 * 目前 print HTML（shared renderers/html.ts）实际只输出 figure 主图的 `<img src>`（来自 figureImage.attrs.src），
 * 其余位置现在不进入 HTML，这里仍然清空，作为防御。
 *
 * 就地修改传入的文档（调用方持有的是 synchronizeCoverMetadata 返回的私有副本）。
 */
export function blockExternalImages(pmDoc: PMJsonNode): ExportWarning[] {
  const warnings: ExportWarning[] = [];

  const warn = (nodeId: string | undefined): void => {
    warnings.push({
      code: 'image-resource-failed',
      ...(nodeId === undefined ? {} : { nodeId }),
      message: EXTERNAL_IMAGE_REJECTED_MESSAGE,
    });
  };

  const visit = (node: PMJsonNode, figureId: string | undefined): void => {
    const ownId =
      typeof node.attrs?.nodeId === 'string' ? node.attrs.nodeId : undefined;

    if (IMAGE_NODE_TYPES.has(node.type) && isExternalSrc(node.attrs?.src)) {
      node.attrs = { ...node.attrs, src: '' };
      warn(figureId ?? ownId);
    }

    const additional = node.attrs?.additionalGraphics;
    if (Array.isArray(additional)) {
      node.attrs = {
        ...node.attrs,
        additionalGraphics: additional.map((graphic: unknown) => {
          if (!isExternalSrc((graphic as { src?: unknown } | null)?.src)) {
            return graphic;
          }
          warn(ownId ?? figureId);
          return { ...(graphic as object), src: '' };
        }),
      };
    }

    const alternative = node.attrs?.alternativeGraphic;
    if (
      typeof alternative === 'object' &&
      alternative !== null &&
      isExternalSrc((alternative as { src?: unknown }).src)
    ) {
      node.attrs = {
        ...node.attrs,
        alternativeGraphic: { ...alternative, src: '' },
      };
      warn(ownId ?? figureId);
    }

    const childFigureId =
      node.type === 'figure' ? (ownId ?? figureId) : figureId;
    for (const child of node.content ?? []) visit(child, childFigureId);
  };
  visit(pmDoc, undefined);
  return warnings;
}
