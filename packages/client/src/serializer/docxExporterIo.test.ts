import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  buildDocx,
  collectImageResources,
  convertFormulasToOmml,
  COVER_SETTINGS_KEYS as IO_COVER_SETTINGS_KEYS,
  packageDocxBytes,
  prepareDocxInput as ioPrepareDocxInput,
  resolveDocumentStage as ioResolveDocumentStage,
  synchronizeCoverMetadata as ioSynchronizeCoverMetadata,
  DOCX_MIME_TYPE as IO_DOCX_MIME_TYPE,
} from '@ses/io'
import { renderDocx, type DocxPackage, type PMJsonNode } from '@ses/shared'
import {
  COVER_SETTINGS_KEYS,
  synchronizeCoverMetadata,
} from '../utils/documentSettings'
import {
  DOCX_MIME_TYPE,
  buildDocxBlob,
  packageDocx,
  prepareDocxInput,
  resolveDocumentStage,
} from './docxExporter'

/** 迁移前 docxExporter.packageDocx 的原文（逐字保留，JSZip 直接生成 Blob），作为字节一致性的对照。 */
async function legacyPackageDocx(docxPackage: DocxPackage): Promise<Blob> {
  const ZIP_DATE = new Date(Date.UTC(1980, 0, 1))
  const zip = new JSZip()
  const partPaths = Object.keys(docxPackage.parts).sort((a, b) =>
    a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : a < b ? -1 : a > b ? 1 : 0,
  )
  for (const path of partPaths) {
    zip.file(path, docxPackage.parts[path]!, { date: ZIP_DATE, createFolders: false })
  }
  for (const path of Object.keys(docxPackage.binaries).sort()) {
    zip.file(path, docxPackage.binaries[path]!, { base64: true, date: ZIP_DATE, createFolders: false })
  }
  return zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME_TYPE, compression: 'DEFLATE' })
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6oJ8AAAAASUVORK5CYII='
const richDoc: PMJsonNode = {
  type: 'standardDoc', attrs: { standardType: 'national', titleCn: '图文样稿', standardNo: 'GB/T 12345—2026' },
  content: [{
    type: 'chapter', attrs: { nodeId: 'ch1' }, content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
      { type: 'figure', attrs: { nodeId: 'fig1' }, content: [
        { type: 'figureImage', attrs: { src: imageData } },
        { type: 'figureCaption', content: [{ type: 'text', text: '示意图' }] },
      ] },
      { type: 'formula', attrs: { nodeId: 'formula1' }, content: [
        { type: 'formulaContent', content: [{ type: 'text', text: 'x < 0 \\quad A \\& B' }] },
      ] },
    ],
  }],
}
const CREATED_AT = '2026-09-29T08:00:00.000Z'

describe('client DOCX 薄壳与 @ses/io 的一致性', () => {
  it('同一 DocxPackage 经 @ses/io 打包的字节与 client packageDocx 的 Blob 字节逐字节相同（合成包）', async () => {
    const pkg: DocxPackage = {
      parts: { 'word/document.xml': '<document>中文</document>', '[Content_Types].xml': '<types/>' },
      binaries: { 'word/media/pixel.png': 'AQID' },
      warnings: [],
    }
    const ioBytes = await packageDocxBytes(pkg)
    const blob = await packageDocx(pkg)
    expect(blob.type).toBe(DOCX_MIME_TYPE)
    expect(await bytesOf(blob)).toEqual(ioBytes)
    // 与迁移前实现（JSZip 直接产出 Blob）也逐字节相同
    expect(await bytesOf(await legacyPackageDocx(pkg))).toEqual(ioBytes)
  })

  it('同一 DocxPackage 经 @ses/io 打包的字节与 client packageDocx 的 Blob 字节逐字节相同（真实渲染包）', async () => {
    const { doc, labels } = prepareDocxInput(richDoc)
    const [images, formulas] = await Promise.all([collectImageResources(doc), convertFormulasToOmml(doc)])
    const pkg = renderDocx(doc, labels, {
      images: images.images,
      formulaOmml: formulas.formulaOmml,
      stage: 'working_draft',
      createdAt: CREATED_AT,
    })
    expect(Object.keys(pkg.binaries).length).toBeGreaterThan(0)
    expect(Object.values(pkg.parts).join('')).toContain('<m:oMath ')

    const ioBytes = await packageDocxBytes(pkg)
    expect(await bytesOf(await packageDocx(pkg))).toEqual(ioBytes)
    expect(await bytesOf(await legacyPackageDocx(pkg))).toEqual(ioBytes)
  })

  it('buildDocxBlob 的 Blob 字节与 @ses/io buildDocx 的字节、告警完全相同', async () => {
    const options = { pmDoc: richDoc, documentMeta: { titleCn: '导出标题', standardType: 'national' as const }, createdAt: CREATED_AT }
    const viaIo = await buildDocx(options)
    const viaShell = await buildDocxBlob(options)
    expect(viaShell.blob.type).toBe(DOCX_MIME_TYPE)
    expect(await bytesOf(viaShell.blob)).toEqual(viaIo.bytes)
    expect(viaShell.warnings).toEqual(viaIo.warnings)
  })

  it('保留原有导出名，且与 @ses/io 的实现是同一函数', () => {
    expect(DOCX_MIME_TYPE).toBe(IO_DOCX_MIME_TYPE)
    expect(prepareDocxInput).toBe(ioPrepareDocxInput)
    expect(resolveDocumentStage).toBe(ioResolveDocumentStage)
  })

  it('documentSettings 重新导出 @ses/io 的封面元数据同步', () => {
    expect(synchronizeCoverMetadata).toBe(ioSynchronizeCoverMetadata)
    expect(COVER_SETTINGS_KEYS).toBe(IO_COVER_SETTINGS_KEYS)
  })
})
