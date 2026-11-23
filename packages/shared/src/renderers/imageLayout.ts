import type { IRTableRow } from '../ir/types'

/** A cell is image-only only when its complete content is one paragraph with one image and no text. */
export function isImageOnlyCell(cell: IRTableRow['cells'][number]): boolean {
  if (cell.content.length !== 1 || cell.content[0]?.kind !== 'paragraph') return false
  const runs = cell.content[0].content
  return runs.filter(run => !!run.image).length === 1 && runs.every(run =>
    !run.text.trim() && !run.formula && !run.footnote && (!run.marks || run.marks.length === 0))
}

export const IMAGE_ONLY_CELL_WIDTH_FRACTION = 0.8
export const IMAGE_ONLY_CELL_MAX_HEIGHT_MM = 50
