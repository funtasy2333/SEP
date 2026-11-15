import type { IRList } from '../../../ir/types'

/** Word list body indentation is absolute within the container, not cumulative. */
export function listContentWidthMm(list: IRList, depth: number, containerWidthMm: number): number {
  const secondLevel = depth >= 2 || list.listType === 'dot' ||
    (list.listType !== 'dash' && (list.level === 2 || list.listType === 'number'))
  const indentTwips = secondLevel ? 1260 : 840
  return indentedWidthMm(containerWidthMm, indentTwips)
}

/** A positive fallback is needed when indentation consumes the entire container. */
export function indentedWidthMm(containerWidthMm: number, indentTwips: number): number {
  return Math.max(1 / 36000, containerWidthMm - indentTwips * 25.4 / 1440)
}
