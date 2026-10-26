import type { Extensions } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extension-placeholder'
import { EditorTable } from './nodes/editor-table'
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
  DefList,
  Example, ExampleBlock,
  ExternalLink,
  FootnoteLabels,
  Figure, FigureCaption, FigureCaptionEn, FigureDescription, FigureGroup, FigureImage, FigureResource, FigureResourceRef,
  FootnoteRef,
  FormulaInline, FormulaNote,
  Foreword, Formula, FormulaContent, FormulaDescription,
  IdentifierPart, IndexBlock, IndexEntry, IndexGroup, IndexSeeAlso, IndexTarget, IndexTerm,
  Introduction,
  MetadataBlock, MetadataFields, MetadataLanguage, NodeId, Note, NoteBlock,
  Publisher, QuoteBlock,
  ReplacedStandard,
  SemanticCodeBlock,
  SlashCommand,
  StandardIdentifier, StandardTableCell, StandardTableHeader, StandardTableRow,
  TableFootnoteOrder,
  Subscript, Superscript,
  TbxLangSet, TbxTerm, TbxTermDescriptor, TbxTermVariant, TbxTig, TermRef, TextStyle, TitlePart,
  InlineFormulaEditing,
  Variable, WarningBlock, WhereDefinition, WhereItem, WhereList, WhereListEditing, WhereTerm,
  StdList, StdListItem,
  StdParagraph, StdTable, TableCaption, TableCaptionEn, TableFootnote, TableFootnoteEntry, TableFootnoteRef, TableFootnoteRow, TableNoteRow,
  TermDef, TermDefinition, TermName, TermNameEn, TermSource, TermSubjectField,
  NormRefList, NormRefStd, NormRefStdRef, NormRefStdTitle, NormRefMixed, StdRef, MixedCitation,
  TableColumnsSync,
} from './index' // 相对路径：服务端打包也会加载本文件，不认识 '@/' 别名（见 editorSchema.ts）

/** The exact extension list used by EditorView's useEditor call. */
export function createEditorExtensions(): Extensions {
  return [
    // GB/T 标准文档不需要 blockquote/codeBlock/horizontalRule，禁用以免产生 IR 无法表达的内容
    StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, horizontalRule: false, gapcursor: false }),
    EditorTable.configure({ resizable: true, allowTableNodeSelection: true }),
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
    WhereListEditing, InlineFormulaEditing,
    // WP8.M：新节点一律追加在末尾（不改变 block 组默认填充节点的顺序）。
    TermSubjectField, DefList,
    // G7-b：块内容的注/示例（旧的单段 note/example 保持不动）。
    NoteBlock, ExampleBlock,
    // G1：规范性引用文件清单（M-4.4.2.3-02/-03/-04）与正文标准引用 mark（M-10.2-01/-02、M-10.1.7-01）。
    NormRefList, NormRefStd, NormRefStdRef, NormRefStdTitle, NormRefMixed, StdRef, MixedCitation,
    // G8：列数变化时清空 stdTable.columns（M-6.1-03，D-M-11）。纯插件，不新增节点。
    TableColumnsSync,
  ]
}
