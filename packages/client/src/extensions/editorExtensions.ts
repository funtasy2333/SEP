import type { Extensions } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import {
  Adoption, Appendix, AppendixLabel, AppendixTitle,
  AutoUnitSpacing,
  BibEntry, BibExternalLink, BibField, BibIdentifier, BibRef, BibStructured, Bibliography, BibliographyTitle,
  Chapter, ChapterTitle,
  Clause, ClauseTitle,
  CoverPage,
  CrossRef,
  Copyright,
  Example,
  ExternalLink,
  FootnoteLabels,
  Figure, FigureCaption, FigureCaptionEn, FigureDescription, FigureGroup, FigureImage, FigureResource, FigureResourceRef,
  FootnoteRef,
  FormulaInline, FormulaNote,
  Foreword, Formula, FormulaContent, FormulaDescription,
  IdentifierPart, IndexBlock, IndexEntry, IndexGroup, IndexSeeAlso, IndexTarget, IndexTerm,
  Introduction,
  MetadataBlock, MetadataFields, MetadataLanguage, NodeId, Note,
  Publisher, QuoteBlock,
  ReplacedStandard,
  SemanticCodeBlock,
  SlashCommand,
  StandardIdentifier, StandardTableCell, StandardTableHeader, StandardTableRow,
  TableFootnoteOrder,
  Subscript, Superscript,
  TbxLangSet, TbxTerm, TbxTermDescriptor, TbxTermVariant, TbxTig, TermRef, TextStyle, TitlePart,
  Variable, WarningBlock, WhereDefinition, WhereItem, WhereList, WhereTerm,
  StdList, StdListItem,
  StdParagraph, StdTable, TableCaption, TableCaptionEn, TableFootnote, TableFootnoteEntry, TableFootnoteRef, TableFootnoteRow, TableNoteRow,
  TermDef, TermDefinition, TermName, TermNameEn, TermSource,
} from './index' // 相对路径：服务端打包也会加载本文件，不认识 '@/' 别名（见 editorSchema.ts）

/** The exact extension list used by EditorView's useEditor call. */
export function createEditorExtensions(): Extensions {
  return [
    // GB/T 标准文档不需要 blockquote/codeBlock/horizontalRule，禁用以免产生 IR 无法表达的内容
    StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, horizontalRule: false }),
    Table.configure({ resizable: true }),
    StandardTableRow, StandardTableCell, StandardTableHeader,
    Image,
    Placeholder.configure({ placeholder: '开始编写标准内容...' }),
    // 自定义节点
    Chapter, ChapterTitle,
    Clause, ClauseTitle,
    StdParagraph,
    TermDef, TermName, TermNameEn, TermDefinition, TermSource,
    StdTable, TableCaption, TableCaptionEn, TableFootnote, TableNoteRow, TableFootnoteRow, TableFootnoteEntry,
    FootnoteRef, TableFootnoteRef,
    Figure, FigureImage, FigureCaption, FigureCaptionEn,
    Formula, FormulaContent, FormulaDescription,
    Note, Example,
    Foreword, Introduction,
    Appendix, AppendixLabel, AppendixTitle,
    Bibliography, BibliographyTitle, BibEntry,
    StdList, StdListItem,
    CrossRef,
    FootnoteLabels,
    SlashCommand,
    AutoUnitSpacing,
    NodeId,
    TableFootnoteOrder,
    // Keep the existing extension order intact; add the persisted cover node at the end.
    CoverPage,
    MetadataFields,
    MetadataBlock, TitlePart, StandardIdentifier, IdentifierPart, MetadataLanguage,
    Publisher, Adoption, ReplacedStandard, Copyright,
    TbxLangSet, TbxTig, TbxTermVariant, TbxTerm, TbxTermDescriptor,
    FormulaNote, WhereList, WhereItem, WhereTerm, WhereDefinition, FormulaInline,
    FigureGroup, FigureDescription, FigureResource, FigureResourceRef,
    BibStructured, BibField, BibIdentifier, BibExternalLink,
    IndexBlock, IndexGroup, IndexEntry, IndexTerm, IndexTarget, IndexSeeAlso,
    WarningBlock, QuoteBlock, SemanticCodeBlock,
    TextStyle, Subscript, Superscript, Variable, ExternalLink, BibRef, TermRef,
  ]
}
