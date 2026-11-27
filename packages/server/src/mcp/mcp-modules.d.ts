/**
 * docs/wp9-authoring-reference.md 的全文：webpack 以 asset/source 内联进产物（部署时不需要 docs 目录），
 * jest 以文本转换器（jest.text-transform.js）加载。
 */
declare module '@docs/authoring-reference' {
  const markdown: string;
  export default markdown;
}
