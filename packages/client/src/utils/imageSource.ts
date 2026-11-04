/**
 * 编辑器里图片地址的分类与外部图片的「点击才加载」。
 *
 * 为什么：文档内容可能来自导入（.ses / XML）或 MCP，图片地址可以是任意 URL。浏览器一渲染就会请求它，
 * 泄露打开文档的时间和 IP，或让浏览器去请求局域网地址。所以外部图片默认不渲染真实地址，
 * 显示占位图，用户点击后才加载（本次会话内记住）。内嵌图片（data:image、blob:）不受影响。
 *
 * 约束：本文件在服务端打包 schema 时也会被加载，加载期不得访问 window / document。
 */

/** 内嵌图片：`data:image/…` 或 `blob:`。它们不会触发网络请求。 */
export function isEmbeddedImageSrc(src: string | null | undefined): boolean {
  if (typeof src !== 'string') return false
  return /^data:image\//i.test(src) || /^blob:/i.test(src)
}

/** 外部图片：地址非空且不是内嵌图片（http(s)、`//`、相对路径、其他协议都算）。 */
export function isExternalImageSrc(src: unknown): src is string {
  return typeof src === 'string' && src.trim() !== '' && !isEmbeddedImageSrc(src)
}

/** 本次会话内用户已允许加载的外部图片地址（刷新页面后清空，不写入文档）。 */
const approvedExternalImages = new Set<string>()

export function approveExternalImage(src: string): void {
  approvedExternalImages.add(src)
}

export function isExternalImageApproved(src: string): boolean {
  return approvedExternalImages.has(src)
}

/** 仅供测试：清空已允许的集合。 */
export function resetApprovedExternalImages(): void {
  approvedExternalImages.clear()
}

const PLACEHOLDER_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120">',
  '<rect width="320" height="120" fill="#f3f4f6" stroke="#9ca3af" stroke-dasharray="6 4"/>',
  '<text x="160" y="66" text-anchor="middle" font-size="16" fill="#4b5563"',
  ' font-family="PingFang SC,Microsoft YaHei,SimHei,sans-serif">外部图片未加载，点击加载</text>',
  '</svg>',
].join('')

/** 外部图片未允许加载时显示的占位图（内嵌 SVG，不含任何外部引用）。 */
export const EXTERNAL_IMAGE_PLACEHOLDER_SRC = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PLACEHOLDER_SVG)}`

/** 外部图片的 CSS 类（占位状态；加 cursor: pointer）。 */
export const EXTERNAL_IMAGE_CLASS = 'is-external-image'

/** 提示里显示的来源：绝对地址取主机名，其余（相对路径、其他协议）给出笼统说明，不展示完整地址。 */
export function externalImageHost(src: string): string {
  if (/^(?:https?:)?\/\//i.test(src.trim())) {
    try {
      const url = new URL(src.trim().startsWith('//') ? `http:${src.trim()}` : src.trim())
      if (url.hostname) return url.hostname
    } catch {
      // 地址无法解析：按下面的笼统说明处理
    }
  }
  return /^[a-z][a-z0-9+.-]*:/i.test(src.trim()) ? '其他协议' : '相对路径'
}

/**
 * 渲染图片元素前处理属性：外部且未允许加载的图片，DOM 里不放真实地址（src 换成占位图，也不输出 srcset），
 * 真实地址放进 `data-external-src`，让复制粘贴、重新解析时还能还原（见 {@link readImageSrc}）。
 * 节点自己的 `title` 属性被提示文字占用，原值移到 `data-original-title`（见 {@link readImageTitle}）。
 * 内嵌图片、空地址和已允许的外部图片原样返回。
 */
export function guardImageAttributes<T extends Record<string, unknown>>(attributes: T): Record<string, unknown> {
  const src = attributes.src
  if (!isExternalImageSrc(src) || isExternalImageApproved(src)) return attributes
  const { srcset: _srcset, title, ...rest } = attributes
  return {
    ...rest,
    src: EXTERNAL_IMAGE_PLACEHOLDER_SRC,
    class: [typeof rest.class === 'string' ? rest.class : '', EXTERNAL_IMAGE_CLASS].filter(Boolean).join(' '),
    'data-external-src': src,
    title: `外部图片未加载，点击加载：${externalImageHost(src)}`,
    ...(typeof title === 'string' && title !== '' ? { 'data-original-title': title } : {}),
  }
}

/** 从图片元素读取真实地址：占位元素以 `data-external-src` 为准，绝不把占位图的 data URL 当作图片地址。 */
export function readImageSrc(element: Element, fallback: string | null = null): string | null {
  const external = element.getAttribute('data-external-src')
  if (external !== null) return external
  return element.getAttribute('src') ?? fallback
}

/** 从图片元素读取节点的 title 属性：占位元素的 title 是提示文字，原值在 `data-original-title`。 */
export function readImageTitle(element: Element, fallback: string | null = null): string | null {
  if (element.hasAttribute('data-external-src')) return element.getAttribute('data-original-title') ?? fallback
  return element.getAttribute('title') ?? fallback
}

/** 把图片元素的地址设为 src；外部且未允许加载的图片显示占位图（与 {@link guardImageAttributes} 同一套规则）。 */
export function setImageSource(image: HTMLImageElement, src: string): void {
  const guarded = guardImageAttributes({ src })
  image.setAttribute('src', String(guarded.src))
  if (guarded['data-external-src'] === undefined) return
  image.setAttribute('data-external-src', String(guarded['data-external-src']))
  image.setAttribute('title', String(guarded.title))
  image.classList.add(EXTERNAL_IMAGE_CLASS)
}

/** 占位图元素的选择器。 */
export const EXTERNAL_IMAGE_SELECTOR = `img.${EXTERNAL_IMAGE_CLASS}[data-external-src]`

/**
 * 用户点击占位图：允许加载这个地址，并把 root 内所有同地址的占位图换成真实图片
 * （只改 DOM 元素，不碰文档，不产生事务）。返回是否处理了点击。
 */
export function revealExternalImage(clicked: Element, root: ParentNode): boolean {
  const src = clicked.getAttribute('data-external-src')
  if (src === null || !clicked.matches(EXTERNAL_IMAGE_SELECTOR)) return false
  approveExternalImage(src)
  const targets = new Set<Element>([clicked])
  for (const image of Array.from(root.querySelectorAll(EXTERNAL_IMAGE_SELECTOR))) {
    if (image.getAttribute('data-external-src') === src) targets.add(image)
  }
  for (const image of targets) {
    const originalTitle = image.getAttribute('data-original-title')
    image.setAttribute('src', src)
    image.classList.remove(EXTERNAL_IMAGE_CLASS)
    image.removeAttribute('data-external-src')
    image.removeAttribute('data-original-title')
    if (originalTitle !== null) image.setAttribute('title', originalTitle)
    else image.removeAttribute('title')
  }
  return true
}
