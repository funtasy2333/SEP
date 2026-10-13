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

export { convertFormulaToOmml, convertFormulasToOmml } from './formulaOmml'
export type { FormulaConversionWarning, FormulaOmmlResult } from './formulaOmml'

export {
  checkExportGuard,
  formatFootnoteExportError,
  formatOutputBoundaryDetail,
  formatOutputBoundaryMessage,
  getFootnoteExportError,
  getFootnoteExportProblems,
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
