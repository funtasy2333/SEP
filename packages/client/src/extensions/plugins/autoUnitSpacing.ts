import { Extension, escapeForRegEx, textInputRule } from '@tiptap/core'

/**
 * 数字 + 单位之间自动插入半角空格
 *
 * 依据 GB 3101—1993《有关量、单位和符号的一般原则》3.2 节：
 *   "表示量值时……数值与单位符号间留一空隙"
 *
 * 唯一明文例外是平面角的度 (°) / 分 (′) / 秒 (″)，
 * 中文排版惯例 % 和 ‰ 也不留空格 —— 这几个单位**不**列入本规则，
 * 因此用户输入 `30°` / `60%` / `5‰` 时不会被自动加空格。
 *
 * 摄氏度 °C / ℃ 在 GB 3101 中**仍需**留空格 (例: `28.4 °C`)，
 * 因此包含在规则中。
 *
 * 触发条件：光标前文本以 `数字 + 单位` 结尾且数字前没有拉丁字母
 * (避免误改 `abc5kg`、`var1m` 之类的标识符)。
 */

/** 需要在数字与之间留空格的常用单位 (SI / 国标常用) */
const UNITS_WITH_SPACE: readonly string[] = [
  // 长度
  'mm', 'cm', 'km', 'μm', 'nm', 'm',
  // 质量
  'mg', 'kg', 'g', 't',
  // 时间
  'ms', 'min', 'h', 's', 'd',
  // 力 / 压强
  'kN', 'N', 'GPa', 'MPa', 'kPa', 'Pa', 'bar',
  // 能量 / 功率
  'kJ', 'MJ', 'J', 'GW', 'MW', 'kW', 'W', 'eV',
  // 频率
  'GHz', 'MHz', 'kHz', 'Hz',
  // 体积 / 物质的量
  'mL', 'L', 'mmol', 'mol',
  // 电
  'kV', 'mV', 'V', 'mA', 'A', 'MΩ', 'kΩ', 'Ω', 'F', 'C',
  // 温度 (°C / ℃ 需要空格；° 单独使用是角度，不在列)
  '°C', '℃', '°F', 'K',
  // 声 / 信息
  'dB',
  'TB', 'GB', 'MB', 'kB', 'B', 'bit',
  // 光
  'lm', 'lx', 'cd',
  // 角 — 弧度 / 球面度需要空格 (° ′ ″ 不在列)
  'rad', 'sr',
]

/** 按长度降序，避免 `MPa` 被先匹配为 `Pa` */
const sortedUnits = [...UNITS_WITH_SPACE].sort((a, b) => b.length - a.length)

const unitAlternation = sortedUnits.map(escapeForRegEx).join('|')

/**
 * 匹配数值 + 单位。
 * - `(?<![A-Za-z_])` —— 数字前不能紧跟字母 / 下划线 (排除标识符)
 * - `\d+(?:\.\d+)?` —— 整数或小数
 * - `(unit)` —— 已知单位之一
 * - 末尾 `$` 由 textInputRule 隐式锚定到光标前
 */
const numberUnitPattern = new RegExp(
  `(?<![A-Za-z_\\d])(\\d+(?:\\.\\d+)?)(${unitAlternation})$`,
)

export const AutoUnitSpacing = Extension.create({
  name: 'autoUnitSpacing',

  addInputRules() {
    return [
      textInputRule({
        find: numberUnitPattern,
        replace: '$1 $2',
      }),
    ]
  },
})
