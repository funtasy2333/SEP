export {
  DOCX_MIME_TYPE,
  buildDocx,
  packageDocxBytes,
  prepareDocxInput,
  resolveDocumentStage,
} from './docx'
export type { BuildDocxOptions, PMJsonSource, PreparedDocxInput } from './docx'

export { collectImageResources } from './imageResources'
export type {
  DocxImageResource,
  ImageResourceDiagnostic,
  ImageResourceOptions,
  ImageResourcesResult,
  ImageResourceValue,
} from './imageResources'

export { convertFormulaToOmml, convertFormulasToOmml, estimateFormulaWidth } from './formulaOmml'
export type { FormulaConversionOptions, FormulaConversionWarning, FormulaOmmlResult } from './formulaOmml'

export { convertFormulasToMathMl, convertLatexToMathMl } from './formulaMathMl'
export type { ConvertFormulasToMathMlResult, ConvertLatexToMathMlOptions } from './formulaMathMl'

export { collectXml46687Resources } from './xml46687Resources'
export type { Xml46687ResourcesResult } from './xml46687Resources'

export {
  XML46687_PACKAGE_FORMAT,
  XML46687_PACKAGE_XML_PATH,
  buildXml46687Package,
  packageXml46687,
  prepareXml46687Input,
} from './xml46687Package'
export type {
  BuildXml46687PackageOptions,
  BuildXml46687PackageResult,
  PreparedXml46687Input,
} from './xml46687Package'

export {
  checkExportGuard,
  formatFootnoteExportError,
  formatOutputBoundaryDetail,
  formatOutputBoundaryMessage,
  formatOutputBoundarySummary,
  getFootnoteExportError,
  getFootnoteExportItems,
  getFootnoteExportProblems,
  getOutputBoundaryItems,
  getOutputBoundaryProblems,
  outputBoundaryFormatOf,
} from './exportGuard'
export type {
  ExportGuardFailure,
  ExportGuardFormat,
  ExportGuardProblem,
  ExportGuardSource,
  OutputBoundaryFormat,
} from './exportGuard'

export { COVER_SETTINGS_KEYS, synchronizeCoverMetadata } from './coverMetadata'

export { buildPdfExportRequest, extractPdfTocTargets } from './pdfExport'
export type { PdfExportRequest, PdfTocTarget } from './pdfExport'

export { exportSemanticHtml, exportSemanticJson } from './semanticExport'

export {
  applyDocumentOperations,
  buildOutline,
  DOCUMENT_CONTAINERS,
  DOCUMENT_OPERATION_NAMES,
  parseDocumentOperations,
  readContainer,
  readNode,
} from './documentOps'
export type {
  ApplyDocumentOperationsFailure,
  ApplyDocumentOperationsOptions,
  ApplyDocumentOperationsResult,
  ApplyDocumentOperationsSuccess,
  ContentValidationFailure,
  ContentValidationResult,
  ContentValidator,
  DeleteOperation,
  DocumentContainer,
  DocumentOperation,
  DocumentOperationIssue,
  DocumentOperationIssueCode,
  DocumentOperationName,
  DocumentOperationWarning,
  DocumentOutline,
  DocumentProblem,
  EngineIssueCode,
  FrontMatterOutline,
  InsertOperation,
  InsertPosition,
  MoveOperation,
  NodeKind,
  NotReplaceableReason,
  OperationEffect,
  OutlineItem,
  OutlineKind,
  ParentRef,
  ParseDocumentOperationsResult,
  ReadContainerInfo,
  ReadContainerResult,
  ReadNodeInfo,
  ReadNodeResult,
  ReplaceOperation,
} from './documentOps'

export * from './xml46687Import'
export { importXml46687Package } from './xml46687PackageImport'
