/** 页面方向，可应用于图、表等块级要素。 */
export type PageOrientation = 'portrait' | 'landscape'

/** 未知或缺失值一律使用纵向，避免导入异常值改变出件布局。 */
export function normalizePageOrientation(value: unknown): PageOrientation {
  return value === 'landscape' ? 'landscape' : 'portrait'
}

/** 读取 XML 或编辑器 HTML 节点上的方向属性。 */
export function readPageOrientation(element: Pick<Element, 'getAttribute'>): PageOrientation {
  return normalizePageOrientation(
    element.getAttribute('orientation') ?? element.getAttribute('data-orientation'),
  )
}
