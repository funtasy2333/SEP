/**
 * HTML → PDF 两遍构建管线（Phase 5.5 / WP5，编排层）。
 *
 * 决策一（WP0 结论 3，定稿）：目次/分区页码采用两遍构建，最终一遍 HTML 不含
 * 内部链接与 target-counter（命名横排页 bug，WP0 结论 1），页码为注入的纯文本。
 *
 * 流程：
 *  1. KaTeX 预渲染（占位 → 静态 HTML），落盘 KaTeX CSS/字体并注入 <link>；
 *  2. 第一遍 vivliostyle build（目次页码为占位）；
 *  3. pdftotext 逐页扫描，按标题文本 + 分区计算各目次目标的页码；
 *  4. 把页码注入 `.ses-toc-page` 定宽占位；
 *  5. 第二遍 vivliostyle build 产出最终 PDF；
 *  6. 断言两遍页数一致（占位定宽保证分页不漂移），不一致即报错。
 */

import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Logger } from '@nestjs/common'

import { prerenderFormulas } from './katex-prerender'
import { computeTocPageNumbers, injectTocPageNumbers, type TocTarget } from './toc'
import {
  injectHead,
  pdfPageCount,
  pdfToTextPages,
  prepareKatexAssets,
  readPdf,
  resolveVivliostyleCli,
  runVivliostyleBuild,
  writeHtmlFile,
} from './build'

export interface HtmlToPdfInput {
  /** print 变体 HTML（@ses/shared renderHtml variant:'print'，已内联 printCss） */
  html: string
  /** 目次目标（客户端从渲染后 HTML 的目次节点提取） */
  toc: TocTarget[]
  /** 正文首页文件名称（定位正文起始页，做分区页码换算） */
  docTitle: string
}

export interface HtmlToPdfResult {
  pdf: Buffer
  pageCount: number
  /** KaTeX 渲染失败的公式数（降级为原始 LaTeX 文本） */
  formulaFailures: number
}

export async function runHtmlToPdfPipeline(
  input: HtmlToPdfInput,
  logger: Logger,
): Promise<HtmlToPdfResult> {
  const cliPath = resolveVivliostyleCli()
  const tmpDir = await mkdtemp(join(tmpdir(), 'ses-htmlpdf-'))

  try {
    // 1) KaTeX 预渲染 + 资源落盘 + 注入 <link>
    const headLink = await prepareKatexAssets(tmpDir)
    const { html: katexHtml, failures } = prerenderFormulas(input.html)
    if (failures > 0) {
      logger.warn(`KaTeX 预渲染有 ${failures} 个公式失败，已降级为原始 LaTeX 文本`)
    }
    const baseHtml = injectHead(katexHtml, headLink)

    // 2) 第一遍构建（目次页码为占位）
    const html1 = join(tmpDir, 'pass1.html')
    const pdf1 = join(tmpDir, 'pass1.pdf')
    await writeHtmlFile(html1, baseHtml)
    await runVivliostyleBuild(cliPath, html1, pdf1)

    // 3) 逐页扫描 + 计算页码
    const pages = await pdfToTextPages(pdf1)
    const count1 = pages.length
    const numbers = computeTocPageNumbers(pages, input.toc, input.docTitle)
    const missing = input.toc.filter((t) => !numbers.has(t.target))
    if (missing.length > 0) {
      logger.warn(
        `有 ${missing.length} 个目次目标未能定位页码: ${missing
          .map((t) => t.target)
          .join(', ')}`,
      )
    }

    // 4) 注入页码 → 5) 第二遍构建
    const html2Content = injectTocPageNumbers(baseHtml, numbers)
    const html2 = join(tmpDir, 'pass2.html')
    const pdf2 = join(tmpDir, 'pass2.pdf')
    await writeHtmlFile(html2, html2Content)
    await runVivliostyleBuild(cliPath, html2, pdf2)

    // 6) 页数一致性断言
    const count2 = await pdfPageCount(pdf2)
    if (Number.isFinite(count2) && count1 !== count2) {
      throw new Error(
        `两遍构建页数不一致（第一遍 ${count1} 页 / 第二遍 ${count2} 页），` +
          `目次页码占位宽度可能不足，已中止以避免页码错位`,
      )
    }

    const pdf = await readPdf(pdf2)
    return { pdf, pageCount: count1, formulaFailures: failures }
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
