/**
 * 图与行内图（WP8.2 设计 §2.7）。
 *
 * - `renderFigure`：`fig[@id][@orientation]` ＞ `label`、`caption`（`title`、`p[@content-type="dimension"]`）、`legend`?、`graphic`、
 *   说明段 `p`*、图注 `non-normative-note`*、图中示例 `non-normative-example`*（D-M-09：注在前、示例在后）。
 *   `graphic/@xlink:href` = 所属 `fig` 的 xmlId（无目录、无扩展名，C-T-27）；资源清单核对由 `ids.ts` 的 P4 统一做（`resource-missing/mismatch/unused`）。
 *   图例的 `legend`、`def-list`、`def-item`、`p` 与说明段 `p` 都不写 id（C-T-31、M-E-25）；图注、图中示例仅被引用时写 id（经 `ctx.renderBlock` → blocks.ts 登记）；
 *   `alt/title/imageWidth/imageHeight` 在 STS 中没有对应属性，聚合 warning `figure-attr-not-expressed`；`captionEn` → warning `caption-en-not-expressed`；
 *   `figure.groups`（多资源/分图）仍由输出边界阻断（D-T-11、D-M-12）；
 * - `renderInlineImage`：`inline-graphic[@xlink:href=inl_<k>][@specific-use="size:S|M|L"]`（空元素）。`k` 是全文行内图的 IR 文档序，
 *   由 `collectXml46687ImageRefs`（`ctx.imageRefs`）给出，与 T2.5 准备层共用同一份；`at.path` = 所在 run 的路径 + `.image`。
 */

import type { IRFigure, IRFigureSet, IRInlineImage, IRLegend } from '../../ir/types'
import type { XmlElement } from '../../xml46687/tree'
import type { Xml46687BoundaryContribution } from '../xml46687Boundary'
import { el, inlineHasContent, sub, type RenderContext, type Site } from './context'

/**
 * 放行（设计 §1.3.2～§1.3.3）：图的 `resourceId/descriptions/unit/alt/title/imageWidth/imageHeight/legend/examples`、行内图 `image`、
 * 文档级资源目录 `resources`（仅校验，渲染器不读字节）。无 `kind` 的对象类型登记 shape：`legend`（`items` 复用 `where`）、
 * `figureDescription`、`inlineImage`、`resource`、`measure`。`figure.groups` 不放行。
 * `figure.unit` 与 `table.unit` 的路径后缀无法区分，二者共用 tables.ts 里的 `.unit` 声明项；
 * 行内图 `image` 的子字段（src/resourceId/alt/size）随 `image` 整体放行（旧 XML 在 `image` 处即止，下面不再下探），不单列。
 */
export const XML46687_FIGURES_BOUNDARY: Xml46687BoundaryContribution = {
  fields: {
    figure: ['resourceId', 'descriptions', 'unit', 'alt', 'title', 'imageWidth', 'imageHeight', 'legend', 'examples', 'primaryGraphic', 'additionalGraphics'],
    figureSet: ['kind', 'id', 'legend', 'figures'],
    primaryGraphic: ['contentType', 'specificUse'],
    graphic: ['id', 'src', 'resourceId', 'contentType', 'specificUse'],
    legend: ['id', 'title', 'items'],
    figureDescription: ['id', 'content'],
    inline: ['image'],
    inlineImage: ['src', 'resourceId', 'alt', 'size'],
    doc: ['resources'],
    resource: ['id', 'mediaType', 'name', 'encoding', 'data'],
    measure: ['value', 'unit'],
  },
  shapes: [
    { parent: 'figure', key: 'legend', shape: 'legend' },
    { parent: 'figureSet', key: 'legend', shape: 'legend' },
    { parent: 'figure', key: 'primaryGraphic', shape: 'primaryGraphic' },
    { parent: 'figure', key: 'additionalGraphics', shape: 'graphic' },
    { parent: 'legend', key: 'items', shape: 'where' },
    { parent: 'figure', key: 'descriptions', shape: 'figureDescription' },
    { parent: 'figure', key: 'imageWidth', shape: 'measure' },
    { parent: 'figure', key: 'imageHeight', shape: 'measure' },
    { parent: 'inline', key: 'image', shape: 'inlineImage' },
    { parent: 'doc', key: 'resources', shape: 'resource' },
  ],
  declared: [
    { pathSuffix: '.kind', kind: 'kind', name: 'figureSet', matrixIds: ['M-8.4-02'], task: 'T2.4b', reason: '组合图保留组级图例和子图' },
    { pathSuffix: '.primaryGraphic', kind: 'field', name: 'primaryGraphic', matrixIds: ['M-8.2-08', 'M-8.2-10'], task: 'T2.4b', reason: '主图属性写入 graphic' },
    { pathSuffix: '.additionalGraphics', kind: 'field', name: 'additionalGraphics', matrixIds: ['M-8.4-01'], task: 'T2.4b', reason: '额外 graphic 按顺序输出并对应各自资源' },
    { pathSuffix: '.legend', kind: 'field', name: 'legend', matrixIds: ['M-8.5-01', 'M-8.5-02', 'M-8.5-03', 'M-8.5-04', 'M-8.5-05', 'M-8.5-06'], task: 'T2.4b', reason: '图例写成 fig/legend/def-list[@list-content="figure"]（8.5）' },
    { pathSuffix: '.examples', kind: 'field', name: 'examples', matrixIds: ['M-8.4-03'], task: 'T2.4b', reason: '图中示例写成 fig 内的 non-normative-example（8.4，D-M-09）' },
    { pathSuffix: '.image', kind: 'field', name: 'image', matrixIds: ['M-8.3-02'], task: 'T2.4b', reason: '行内图写成 inline-graphic[@xlink:href=inl_<k>]（8.3）' },
    { pathSuffix: '.resourceId', kind: 'field', name: 'resourceId', matrixIds: ['M-8.2-08', 'M-8.2-09'], task: 'T2.4b', reason: '图的资源键由资源清单对应到 graphic/@xlink:href（C-T-27）' },
    { pathSuffix: '.descriptions', kind: 'field', name: 'descriptions', matrixIds: ['M-8.2-12'], task: 'T2.4b', reason: '图形与图题之间的说明段写成 fig 内的 p（8.2）' },
    { pathSuffix: '.alt', kind: 'field', name: 'alt', matrixIds: ['M-8.2-08'], task: 'T2.4b', reason: 'graphic 无替代文字属性：放行并报 figure-attr-not-expressed（D-X-04）' },
    { pathSuffix: '.title', kind: 'field', name: 'title', matrixIds: ['M-8.2-08'], task: 'T2.4b', reason: 'graphic 无标题属性：放行并报 figure-attr-not-expressed（D-X-04）' },
    { pathSuffix: '.imageWidth', kind: 'field', name: 'imageWidth', matrixIds: ['M-8.3-01'], task: 'T2.4b', reason: 'graphic 无宽度属性（只有 T/S/M/L 档位）：放行并报 figure-attr-not-expressed（D-X-04）' },
    { pathSuffix: '.imageHeight', kind: 'field', name: 'imageHeight', matrixIds: ['M-8.3-01'], task: 'T2.4b', reason: 'graphic 无高度属性（只有 T/S/M/L 档位）：放行并报 figure-attr-not-expressed（D-X-04）' },
    { pathSuffix: 'doc.resources', kind: 'field', name: 'resources', matrixIds: ['M-8.2-08', 'M-8.2-09'], task: 'T2.4b', reason: '文档级资源目录仅作校验，字节由资源清单与资源包承担（设计 §4.3）' },
  ],
}

const NOT_EXPRESSED_TITLE = '图或行内图的 alt、title、宽高在 GB/T 46687.2 中没有对应属性，未导出'

function attributeNote(ctx: RenderContext, what: string, at: Site): void {
  ctx.reportMerged('figure-attr-not-expressed', 'warning', NOT_EXPRESSED_TITLE, what, at)
}

function renderLegend(legend: IRLegend | undefined, at: Site, ctx: RenderContext): XmlElement | null {
  if (!legend) return null
  const legendSite = sub(at, '.legend')
  if (legend.items.length === 0) {
    ctx.report('xml-list-empty', 'error', '图例没有任何项（def-list 至少需要一个 def-item）。', sub(legendSite, '.items'))
    return null
  }
  const items = legend.items.map((item, index): XmlElement => {
    const itemSite = sub(legendSite, `.items[${index}]`, item.id)
    if (!inlineHasContent(item.definition)) {
      ctx.report('empty-content', 'warning', '图例项没有含义，已写出空的 p（def 至少需要一个 p）。', sub(itemSite, '.definition'))
    }
    return el('def-item', undefined, [
      el('term', undefined, ctx.renderInlines(item.term, sub(itemSite, '.term'), 'term')),
      el('def', undefined, [el('p', undefined, ctx.renderInlines(item.definition, sub(itemSite, '.definition'), 'inline'))]),
    ])
  })
  const title = legend.title && inlineHasContent(legend.title)
    ? el('title', undefined, ctx.renderInlines(legend.title, sub(legendSite, '.title'), 'inline'))
    : null
  return el('legend', undefined, [title, el('def-list', { 'list-content': 'figure' }, items)])
}

function checkGraphic(value: { specificUse?: string; contentType?: string }, at: Site, ctx: RenderContext): void {
  if (value.specificUse !== undefined && !['size:T', 'size:S', 'size:M', 'size:L'].includes(value.specificUse)) ctx.report('xml-write-failed', 'error', '图片 specific-use 无效。', at)
  if (value.contentType !== undefined && (typeof value.contentType !== 'string' || value.contentType.trim() === '')) ctx.report('xml-write-failed', 'error', '图片 content-type 无效。', at)
}

export function renderFigure(block: IRFigure, at: Site, ctx: RenderContext): XmlElement[] {
  const xmlId = ctx.xmlIdOf(block.id, at, '图')
  const label = ctx.labelOf(block.id)
  if (label && label.label === '') ctx.report('xml-label-missing', 'error', '图在 labels 中没有编号文本（Resolver 应给出“图1”）。', at)

  if (!inlineHasContent(block.caption)) ctx.report('caption-empty', 'warning', '图没有图题，已写出空的 caption/title。', sub(at, '.caption'))
  if (block.captionEn && inlineHasContent(block.captionEn)) {
    ctx.report('caption-en-not-expressed', 'warning', '英文图题在 GB/T 46687.2 中没有写法（caption 内只有一个 title），未导出。', sub(at, '.captionEn'))
  }
  const unit = typeof block.unit === 'string' && block.unit.trim() !== '' ? block.unit : undefined
  const caption = el('caption', undefined, [
    el('title', undefined, ctx.renderInlines(block.caption, sub(at, '.caption'), 'inline')),
    unit !== undefined ? el('p', { 'content-type': 'dimension' }, [unit]) : null,
  ])

  const shown = label?.label ?? block.id
  if (typeof block.alt === 'string' && block.alt !== '') attributeNote(ctx, `${shown} 的替代文字「${block.alt}」`, sub(at, '.alt'))
  if (typeof block.title === 'string' && block.title !== '') attributeNote(ctx, `${shown} 的标题属性「${block.title}」`, sub(at, '.title'))
  if (block.imageWidth || block.imageHeight) attributeNote(ctx, `${shown} 的宽高`, sub(at, block.imageWidth ? '.imageWidth' : '.imageHeight'))

  if (block.primaryGraphic) checkGraphic(block.primaryGraphic, sub(at, '.primaryGraphic'), ctx)
  const children: Array<XmlElement | null> = [
    label && label.label !== '' ? el('label', undefined, [label.label]) : null,
    caption,
    renderLegend(block.legend, at, ctx),
    el('graphic', { 'content-type': block.primaryGraphic?.contentType ?? 'image', 'specific-use': block.primaryGraphic?.specificUse, 'xlink:href': xmlId }),
    ...(block.additionalGraphics ?? []).map((graphic, index) => {
      const here = sub(at, `.additionalGraphics[${index}]`, graphic.id)
      checkGraphic(graphic, here, ctx)
      const ref = ctx.imageRefs.find(entry => entry.kind === 'figure-extra' && entry.path === here.path && entry.ownerId === graphic.id)
      if (!ref) ctx.report('resource-missing', 'error', '额外图片缺少资源引用', here)
      return el('graphic', { 'content-type': graphic.contentType, 'specific-use': graphic.specificUse, 'xlink:href': ref?.href })
    }),
  ]
  ;(block.descriptions ?? []).forEach((description, index) => {
    children.push(el('p', undefined, ctx.renderInlines(description.content, sub(at, `.descriptions[${index}].content`, description.id), 'inline')))
  })
  block.notes.forEach((note, index) => {
    children.push(...ctx.renderBlock(note, sub(at, `.notes[${index}]`, note.id)))
  })
  ;(block.examples ?? []).forEach((example, index) => {
    children.push(...ctx.renderBlock(example, sub(at, `.examples[${index}]`, example.id)))
  })
  return [el('fig', { id: xmlId, orientation: block.orientation === 'landscape' ? 'landscape' : undefined }, children)]
}

export function renderInlineImage(image: IRInlineImage, at: Site, ctx: RenderContext): XmlElement {
  const runPath = at.path.endsWith('.image') ? at.path.slice(0, -'.image'.length) : at.path
  const ref = ctx.imageRefs.find((entry) => entry.kind === 'inline' && entry.path === runPath)
  if (!ref) {
    ctx.report('resource-missing', 'error', `行内图（${image.resourceId ?? image.src}）没有在图片引用清单中找到对应项，无法写出 xlink:href（inl_<k>）。`, at)
  }
  if (typeof image.alt === 'string' && image.alt !== '') attributeNote(ctx, `行内图的替代文字「${image.alt}」`, sub(at, '.alt'))
  return el('inline-graphic', {
    'xlink:href': ref?.href,
    'specific-use': image.size === 'S' || image.size === 'M' || image.size === 'L' ? `size:${image.size}` : undefined,
  })
}

export function renderFigureSet(block: IRFigureSet, at: Site, ctx: RenderContext): XmlElement[] {
  if (!block.figures.length) ctx.report('xml-list-empty', 'error', '组合图必须包含子图。', at)
  return [el('fig-group', undefined, [renderLegend(block.legend, at, ctx), ...block.figures.flatMap((figure, i) => renderFigure(figure, sub(at, `.figures[${i}]`, figure.id), ctx))])]
}
