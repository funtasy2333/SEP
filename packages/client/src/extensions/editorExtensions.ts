import type { Extensions } from '@tiptap/core'
import { Placeholder } from '@tiptap/extension-placeholder'
import { EditorTable } from './nodes/editor-table'
import { StdListBlockItem } from './nodes/std-list'
import { AlignedArray } from './nodes/aligned-array'
import { SharedFootnoteRef, SharedFootnoteDefinition } from './nodes/footnotes'
import { GraphicPreviews } from './plugins/graphicPreviews'
import { ExternalImages } from './plugins/externalImages'
import { GuardedImage } from './nodes/guarded-image'
import { EditableFigureImage } from './nodes/figure-image-view'
import { ImageLayout } from './plugins/imageLayout'
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
  Figure, FigureSet, FigureCaption, FigureCaptionEn, FigureDescription, FigureGroup, FigureLegend, FigureLegendTitle, FigureResource, FigureResourceRef,
  FootnoteRef,
  FormulaInline, FormulaNote,
  Foreword, Formula, FormulaGroup, FormulaContent, FormulaDescription,
  IdentifierPart, IndexBlock, IndexEntry, IndexGroup, IndexSeeAlso, IndexSourceReference, IndexTarget, IndexTerm,
  InlineImage, Introduction,
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
  StructuralPaste,
  TableExit,
  ClipboardPolicy,
  LandscapeTablePreview,
} from './index' // 相对路径：服务端打包也会加载本文件，不认识 '@/' 别名（见 editorSchema.ts）

export interface EditorExtensionsOptions {
  /** 是否启用主编辑器横页表缩放预览与「展开编辑」按钮插件（默认 true；弹窗编辑器关闭以按 1:1 编辑）。 */
  landscapeTablePreview?: boolean
}

/** The exact extension list used by EditorView's useEditor call. */
export function createEditorExtensions(options: EditorExtensionsOptions = {}): Extensions {
  const { landscapeTablePreview = true } = options
  return [
    // GB/T 标准文档不需要 blockquote/codeBlock/horizontalRule，禁用以免产生 IR 无法表达的内容
    StarterKit.extend({
      addExtensions() {
        return this.parent!().map(extension => extension.name === 'code'
          ? extension.extend({ excludes: 'code italic underline subscript superscript strike variable externalLink crossRef bibRef termRef stdRef mixedCitation textStyle link' })
          : extension)
      },
    }).configure({ heading: false, blockquote: false, codeBlock: false, horizontalRule: false, gapcursor: false }),
    EditorTable.configure({ resizable: true, allowTableNodeSelection: true }),
    StandardTableRow, StandardTableCell, StandardTableHeader,
    GuardedImage,
    Placeholder.configure({ placeholder: '开始编写标准内容...' }),
    // 自定义节点
    Chapter, ChapterTitle,
    Clause, ClauseTitle,
    StdParagraph,
    TermDef, TermName, TermNameEn, TermDefinition, TermSource,
    StdTable, TableCaption, TableCaptionEn, TableFootnote, TableNoteRow, TableFootnoteRow, TableFootnoteEntry,
    FootnoteRef, TableFootnoteRef,
    Figure, EditableFigureImage, FigureCaption, FigureCaptionEn,
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
    IndexBlock, IndexGroup, IndexEntry, IndexTerm, IndexTarget, IndexSeeAlso, IndexSourceReference,
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
    TableColumnsSync, ImageLayout,
    // G3：图例（M-8.5-01～06）与行内图（M-8.3-02）；图注、图中示例复用 figure 内的 note / example，无新节点。
    FigureLegend, FigureLegendTitle, InlineImage, StdListBlockItem, FormulaGroup, FigureSet, AlignedArray, SharedFootnoteRef, SharedFootnoteDefinition, GraphicPreviews,
    // #71：章条容器只作上下文 defining，粘贴不重建左侧打开的章条外壳；拒绝把章/附录嵌进章条内部。不新增节点。
    StructuralPaste,
    // #73：表格内 Mod-Enter 在表格之后插入正文段。纯快捷键扩展，不新增节点。
    TableExit,
    // 剪贴板：SES 内复制保留格式；外部来源与 Ctrl/Cmd+Shift+V 按纯文本并入光标所在段落。不新增节点。
    ClipboardPolicy,
    // 外部图片点击才加载：纯插件，不新增节点。
    ExternalImages,
    // 横页表格比例缩放预览与「展开编辑」按钮：纯插件，不新增节点。
    ...(landscapeTablePreview ? [LandscapeTablePreview] : []),
  ]
}

/**
 * 横页表格弹窗专用的子编辑器扩展集：
 * - Document 约束为仅包含单个 `stdTable`（无法逃逸或删除外层表格容器）；
 * - `stdTable` 约束为不包含表题（`tableCaption` / `tableCaptionEn`），仅编辑表格网格及表注/表脚注；
 * - 禁用 `LandscapeTablePreview` 与 `TableExit`，按 1:1 真实 252mm（952px）宽度编辑，支持原生拖拽列宽。
 */
export function createLandscapeTableModalExtensions(): Extensions {
  const modalStdTable = StdTable.extend({
    content: 'table tableFootnote? tableNoteRow? tableFootnoteRow?',
  })

  return createEditorExtensions({ landscapeTablePreview: false }).flatMap((extension) => {
    if (extension.name === 'starterKit') {
      return [
        StarterKit.extend({
          addExtensions() {
            return this.parent!().map((child) => {
              if (child.name === 'doc') {
                return child.extend({ content: 'stdTable' })
              }
              if (child.name === 'code') {
                return child.extend({
                  excludes: 'code italic underline subscript superscript strike variable externalLink crossRef bibRef termRef stdRef mixedCitation textStyle link',
                })
              }
              return child
            })
          },
        }).configure({ heading: false, blockquote: false, codeBlock: false, horizontalRule: false, gapcursor: false, trailingNode: false }),
      ]
    }
    if (extension.name === 'stdTable') return [modalStdTable]
    if (extension.name === 'footnoteLabels') return [FootnoteLabels.configure({ wrapStandaloneTable: true })]
    if (extension.name === 'tableExit' || extension.name === 'slashCommand') return []
    return [extension]
  })
}

