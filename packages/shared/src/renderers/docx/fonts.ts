/** Word 导出使用安装后的字体名称，而不是字体文件名；FZSSJW.TTF 对应方正书宋简体。 */
export const SONG_FONT_NAME = '方正书宋简体'

/** 正文、编号及列项标识的四类字符均使用方正书宋简体。 */
export const SONG_ALL_RFONTS = `<w:rFonts w:ascii="${SONG_FONT_NAME}" w:eastAsia="${SONG_FONT_NAME}" w:hAnsi="${SONG_FONT_NAME}" w:cs="${SONG_FONT_NAME}"/>`

/** 封面西文模板及罗马列项的西文字体度量沿用 Times New Roman。 */
export const SONG_MIXED_RFONTS = `<w:rFonts w:ascii="Times New Roman" w:eastAsia="${SONG_FONT_NAME}" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>`
