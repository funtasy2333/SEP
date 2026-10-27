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
