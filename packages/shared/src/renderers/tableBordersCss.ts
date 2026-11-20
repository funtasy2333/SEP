/** 屏幕使用像素，避免浏览器把两档磅值都取整为 1px。 */
export const tableBordersCss = (frame: string, inner: string): string => `
.ses-table-block table, .ses-table-block thead { border: ${frame} solid #000; }
.ses-table-block th, .ses-table-block td { border: ${inner} solid #000; }
.ses-table-block .ses-table-notes td, .ses-table-block .ses-table-footnotes td { border: ${frame} solid #000; }
`
