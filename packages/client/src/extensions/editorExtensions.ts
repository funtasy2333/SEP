import type { Extensions } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import StarterKit from '@tiptap/starter-kit'
import {
  Appendix, AppendixLabel, AppendixTitle,
  AutoUnitSpacing,
  BibEntry, Bibliography, BibliographyTitle,
  Chapter, ChapterTitle,
  Clause, ClauseTitle,
  CoverPage,
  CrossRef,
  Example,
  Figure, FigureCaption, FigureCaptionEn, FigureImage,
  Foreword, Formula, FormulaContent, FormulaDescription,
  Introduction,
  NodeId, Note,
  SlashCommand,
  StdList, StdListItem,
  StdParagraph, StdTable, TableCaption, TableCaptionEn, TableFootnote,
  TermDef, TermDefinition, TermName, TermNameEn,
} from '@/extensions'

/** The exact extension list used by EditorView's useEditor call. */
export function createEditorExtensions(): Extensions {
  return [
    // GB/T 标准文档不需要 blockquote/codeBlock/horizontalRule，禁用以免产生 IR 无法表达的内容
    StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, horizontalRule: false }),
    Table.configure({ resizable: true }),
    TableRow, TableCell, TableHeader,
    Image,
    Placeholder.configure({ placeholder: '开始编写标准内容...' }),
    // 自定义节点
    Chapter, ChapterTitle,
    Clause, ClauseTitle,
    StdParagraph,
    TermDef, TermName, TermNameEn, TermDefinition,
    StdTable, TableCaption, TableCaptionEn, TableFootnote,
    Figure, FigureImage, FigureCaption, FigureCaptionEn,
    Formula, FormulaContent, FormulaDescription,
    Note, Example,
    Foreword, Introduction,
    Appendix, AppendixLabel, AppendixTitle,
    Bibliography, BibliographyTitle, BibEntry,
    StdList, StdListItem,
    CrossRef,
    SlashCommand,
    AutoUnitSpacing,
    NodeId,
    // Keep the existing extension order intact; add the persisted cover node at the end.
    CoverPage,
  ]
}
