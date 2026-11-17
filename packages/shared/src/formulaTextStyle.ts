/** Apply the editor's whole-formula text marks to the rendered LaTeX only. */
export function formulaLatexWithMarks(latex: string, marks?: readonly { type: string }[]): string {
  let styled = latex
  const italic = marks?.some(mark => mark.type === 'italic')
  const bold = marks?.some(mark => mark.type === 'bold')
  if (italic) {
    // An explicit toolbar choice also applies to identifiers originally entered in roman.
    // Keep operators (\operatorname, \sin, etc.) on their own mathematical style path.
    styled = styled.replace(/\\mathrm\b/g, '\\mathit')
  }
  if (bold) {
    // KaTeX's inner font command wins: boldsymbol{mathit{x}} loses bold.
    // Merge identifier styles before applying the whole-formula wrapper.
    styled = styled.replace(/\\mathit\b/g, '\\boldsymbol').replace(/\\mathrm\b/g, '\\mathbf')
    styled = `\\boldsymbol{${styled}}`
  } else if (italic) styled = `\\mathit{${styled}}`
  return styled
}
