import { stripWatermarkForPagination } from './pipeline'

describe('first PDF pass', () => {
  it('omits the generated watermark style so its text cannot match TOC headings', () => {
    const html = '<head><style>p{color:black}</style><style id="ses-pdf-watermark">@page body { background: url("data:image/svg+xml,chapter") }</style></head><body>chapter</body>'
    expect(stripWatermarkForPagination(html)).toBe('<head><style>p{color:black}</style></head><body>chapter</body>')
  })
})
