import katex from 'katex'

/**
 * 式中符号的可视化公式输入（MathLive）。
 *
 * MathLive 按需动态加载，打成独立 chunk；加载失败时调用方退回 LaTeX 源码输入。
 * 字体不从 MathLive 目录或 CDN 加载：编辑器已引入 katex.min.css，
 * 其 @font-face 与 MathLive 使用同名的 KaTeX_* 字体族。
 */

export type WhereSymbolValidation = { ok: true; latex: string } | { ok: false; error: string }

/** 写回文档前的校验：导出端（KaTeX 预渲染、OMML 转换）只接受 KaTeX 能解析的 LaTeX。 */
export function validateWhereSymbolLatex(input: string): WhereSymbolValidation {
  const latex = input.trim()
  if (!latex) return { ok: false, error: '请输入符号' }
  if (latex.includes('\\placeholder')) return { ok: false, error: '符号中还有未填写的位置，请补全或删除' }
  try {
    katex.renderToString(latex, { displayMode: false, throwOnError: true, strict: 'ignore' })
  } catch (error) {
    const detail = error instanceof Error ? error.message.replace(/^KaTeX parse error:\s*/, '') : String(error)
    return { ok: false, error: `KaTeX 无法解析：${detail}` }
  }
  return { ok: true, latex }
}

/** MathfieldElement 上本模块会改写的静态配置。 */
export interface MathfieldStatics {
  fontsDirectory: string | null
  soundsDirectory: string | null
  plonkSound: string | null
  keypressSound: unknown
}

export function configureMathfieldElement(element: MathfieldStatics): void {
  element.fontsDirectory = null
  element.soundsDirectory = null
  element.plonkSound = null
  element.keypressSound = null
}

type MathLiveModule = { MathfieldElement: MathfieldStatics }

let loading: Promise<MathfieldStatics | null> | undefined

/** 加载并配置 MathLive；失败返回 null，且不缓存失败，下次重新请求 chunk。 */
export function loadMathLive(
  importer: () => Promise<MathLiveModule> = () => import('mathlive') as unknown as Promise<MathLiveModule>,
): Promise<MathfieldStatics | null> {
  loading ??= importer()
    .then((module) => {
      configureMathfieldElement(module.MathfieldElement)
      return module.MathfieldElement
    })
    .catch(() => {
      loading = undefined
      return null
    })
  return loading
}

/** 弹窗工具条：常用的上下标、正体与希腊字母。`#?` 是 MathLive 的占位。 */
export const WHERE_SYMBOL_SHORTCUTS: ReadonlyArray<{ label: string; latex: string; title: string }> = [
  { label: 'x₁', latex: '_{#?}', title: '下标' },
  { label: 'x²', latex: '^{#?}', title: '上标' },
  { label: 'x₁²', latex: '_{#?}^{#?}', title: '上下标' },
  { label: 'rm', latex: '\\mathrm{#?}', title: '正体（如下标中的说明性文字）' },
  { label: 'x̄', latex: '\\bar{#?}', title: '平均值' },
  { label: 'Δ', latex: '\\Delta', title: 'Delta' },
  { label: 'α', latex: '\\alpha', title: 'alpha' },
  { label: 'β', latex: '\\beta', title: 'beta' },
  { label: 'γ', latex: '\\gamma', title: 'gamma' },
  { label: 'δ', latex: '\\delta', title: 'delta' },
  { label: 'ε', latex: '\\varepsilon', title: 'epsilon' },
  { label: 'η', latex: '\\eta', title: 'eta' },
  { label: 'θ', latex: '\\theta', title: 'theta' },
  { label: 'λ', latex: '\\lambda', title: 'lambda' },
  { label: 'μ', latex: '\\mu', title: 'mu' },
  { label: 'ν', latex: '\\nu', title: 'nu' },
  { label: 'ρ', latex: '\\rho', title: 'rho' },
  { label: 'σ', latex: '\\sigma', title: 'sigma' },
  { label: 'τ', latex: '\\tau', title: 'tau' },
  { label: 'φ', latex: '\\varphi', title: 'phi' },
  { label: 'ω', latex: '\\omega', title: 'omega' },
]
