/**
 * `minimal` fixture（docs/wp7-docx-delivery.md §9 WP7.1、§10.2）。
 *
 * 一个段落，外加 w:body 末尾的 sectPr（§2.1 的纸张、页边距与文档网格，不引用页眉页脚）。
 * 用来验证 buildPackage 打出的包本身是合法、稳定、可往返的 DOCX 包结构；真正的正文渲染
 * （styles/numbering/sections/body）从 WP7.2 起才实现。
 *
 * golden 目录（__golden__/minimal/）供 §10.3 的 pack.py + word_pdf.py 在 Word 里核对。
 */

import { describe, expect, it } from 'vitest'
import { buildPackage } from '../package'
import type { DocxPackage } from '../types'
import { mmToTwips } from '../units'
import { sectPr as buildSectPr } from '../xml'
import { assertChildOrder, assertWellFormed } from './helpers/checks'
import { docxOutline } from './helpers/outline'

const DOCUMENT_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

/** §2.1 纸张、页边距、文档网格；不引用页眉页脚（minimal 明确不要页眉页脚） */
function minimalSectPr(): string {
  return buildSectPr([
    ['pgSz', '<w:pgSz w:w="11906" w:h="16838"/>'],
    [
      'pgMar',
      `<w:pgMar w:top="${mmToTwips(34)}" w:right="${mmToTwips(20)}" w:bottom="${mmToTwips(25)}" ` +
        `w:left="${mmToTwips(25)}" w:header="${mmToTwips(25)}" w:footer="${mmToTwips(20)}" w:gutter="0"/>`,
    ],
    ['docGrid', '<w:docGrid w:type="lines" w:linePitch="312"/>'],
  ])
}

function minimalDocumentXml(): string {
  const paragraph = '<w:p><w:r><w:t xml:space="preserve">最小 DOCX 示例段落。</w:t></w:r></w:p>'
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document ${DOCUMENT_NS}><w:body>${paragraph}${minimalSectPr()}</w:body></w:document>`
  )
}

function buildMinimalPackage(): DocxPackage {
  return buildPackage({
    documentXml: minimalDocumentXml(),
    title: '最小 DOCX 示例',
    createdAt: '2026-09-25T08:00:00.000Z',
  })
}

describe('minimal fixture', () => {
  const pkg = buildMinimalPackage()

  it('assertWellFormed：每个部件可解析、内容类型齐全、关系不悬空', () => {
    expect(() => assertWellFormed(pkg)).not.toThrow()
  })

  it('assertChildOrder：附录 B 所列容器的子元素顺序正确', () => {
    expect(() => assertChildOrder(pkg)).not.toThrow()
  })

  it('同一输入两次输出深度相等（不变式 3：纯函数）', () => {
    expect(buildMinimalPackage()).toEqual(buildMinimalPackage())
  })

  it('JSON.parse(JSON.stringify(pkg)) 与原值深度相等（不变式 4：可 JSON 往返）', () => {
    expect(JSON.parse(JSON.stringify(pkg))).toEqual(pkg)
  })

  it('大纲快照', () => {
    expect(docxOutline(pkg)).toMatchSnapshot()
  })

  it('golden 目录：每个部件落一个文件，供 Word 核对', async () => {
    for (const path of Object.keys(pkg.parts).sort()) {
      await expect(pkg.parts[path]).toMatchFileSnapshot(`./__golden__/minimal/${path}`)
    }
    for (const path of Object.keys(pkg.binaries).sort()) {
      await expect(pkg.binaries[path]).toMatchFileSnapshot(`./__golden__/minimal/${path}.b64`)
    }
  })
})
