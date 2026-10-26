import { analyzeDocument, irMetaFromDocumentMeta, pmToIr, type DocumentMeta, type IRDocMeta, type PMJsonNode, type ValidationReport } from '@ses/shared'

export interface ValidationWorkerRequest {
  type: 'analyze'
  runId: number
  documentId: number
  generation: number
  pmJson: PMJsonNode
  documentMeta?: DocumentMeta
}

export interface ValidationWorkerSuccess {
  type: 'result'
  runId: number
  documentId: number
  generation: number
  report: ValidationReport
  effectiveMeta: Partial<IRDocMeta>
  conversion: {
    warnings: string[]
    unsupported: NonNullable<ReturnType<typeof pmToIr>['doc']['unsupportedContent']>
  }
}

export interface ValidationWorkerFailure {
  type: 'error'
  runId: number
  documentId: number
  generation: number
  message: string
}

export type ValidationWorkerResponse = ValidationWorkerSuccess | ValidationWorkerFailure

/** Worker-safe protocol body: conversion and analysis both run off the editor thread. */
export function processAnalysisRequest(request: ValidationWorkerRequest): ValidationWorkerResponse {
  const identity = {
    runId: request.runId,
    documentId: request.documentId,
    generation: request.generation,
  }
  try {
    const converted = pmToIr(request.pmJson)
    const effectiveMeta = irMetaFromDocumentMeta(request.documentMeta)
    converted.doc.meta = { ...converted.doc.meta, ...effectiveMeta }
    const analysis = analyzeDocument(converted.doc)
    return {
      type: 'result',
      ...identity,
      report: analysis.validation,
      effectiveMeta,
      conversion: {
        warnings: converted.warnings,
        unsupported: converted.doc.unsupportedContent ?? [],
      },
    }
  } catch (error) {
    return {
      type: 'error',
      ...identity,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

if (typeof self !== 'undefined' && 'postMessage' in self) {
  self.addEventListener('message', (event: MessageEvent<ValidationWorkerRequest>) => {
    self.postMessage(processAnalysisRequest(event.data))
  })
}
