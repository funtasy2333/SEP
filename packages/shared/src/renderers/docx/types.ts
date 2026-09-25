/**
 * DOCX 渲染器接口定义（定稿，docs/wp7-docx-delivery.md §1.3）。
 *
 * WP7.1 只落地类型本身；`renderDocx` 入口在 WP7.2 加入 `renderers/docx/index.ts`
 * 并从这里重新导出 DocxPackage/DocxRenderOptions（本包不改 `renderers/index.ts`）。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import type { NodeId } from '../../ir/types'
import type { DocumentStage } from '../../types/document'

export interface DocxRenderOptions {
  /** 公式 OMML：key = IRFormula.id，值以 <m:oMath 开头。缺失时降级为 LaTeX 源码文本并记 warning */
  formulaOmml: Record<NodeId, string>
  /** 图片：key = IRFigure.id。宿主负责把 src（dataURL 或资源 key）解析成字节 */
  images: Record<
    NodeId,
    {
      base64: string
      contentType: 'image/png' | 'image/jpeg' | 'image/gif'
      widthPx: number
      heightPx: number
      dpi?: number
    }
  >
  /** 文档阶段（决定封面阶段标识与专利征集说明，§6.3） */
  stage: DocumentStage
  /** 写入 docProps/core.xml 的时间（ISO），由宿主传入以保证字节级确定性 */
  createdAt: string
}

export interface DocxPackage {
  /** 包内路径 → XML 文本 */
  parts: Record<string, string>
  /** 包内路径 → base64（word/media/*） */
  binaries: Record<string, string>
  /** 降级与告警：formula-missing-omml / image-missing / cover-field-missing / list-format-fallback … */
  warnings: { code: string; nodeId?: NodeId; message: string }[]
}
