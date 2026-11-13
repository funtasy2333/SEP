/** 表格线宽统一约定：外框、表头、表注和表脚注框线 1 磅，普通内框线 0.5 磅。 */
export const tableBordersCss = `
.ses-table-block table { border: 1pt solid #000; }
.ses-table-block th, .ses-table-block td { border: 0.5pt solid #000; }
.ses-table-block thead th, .ses-table-block thead td, .ses-table-block th { border: 1pt solid #000; }
.ses-table-block .ses-table-notes td, .ses-table-block .ses-table-footnotes td { border: 1pt solid #000; }
`
