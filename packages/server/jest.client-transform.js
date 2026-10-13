// jest 加载 client 源码（别名 @client/editor-schema，见 package.json 的 jest.moduleNameMapper）时使用的转译器。
//
// 为什么不用 ts-jest：client 是 "type": "module" 的包，ts-jest 按 tsconfig 的 module: nodenext 把其中的 .ts
// 输出为 ESM，而 jest 把 .ts 当 CommonJS 加载，报 "Cannot use import statement outside a module"。
// 把全局的 module 改成 commonjs 又会让 @ses/io 里对 ESM-only 包 mathml2omml 的动态 import() 被改写成 require()。
// ts-jest 也不支持同一项目里按路径使用不同的 tsconfig（配置集按 jest 项目缓存，先创建者胜出）。
// client 源码只含可擦除的 TS 语法（client 的 tsconfig 开启 erasableSyntaxOnly），逐文件转译为 CommonJS 即可，
// 不做类型检查（类型由 client 自己的 vue-tsc 负责）。
const { createHash } = require('node:crypto');
const ts = require('typescript');

const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2023,
  esModuleInterop: true,
  inlineSourceMap: true,
  inlineSources: true,
};

module.exports = {
  getCacheKey(sourceText, sourcePath) {
    return createHash('sha1')
      .update(ts.version)
      .update(JSON.stringify(compilerOptions))
      .update(sourcePath)
      .update(sourceText)
      .digest('hex');
  },
  process(sourceText, sourcePath) {
    const { outputText } = ts.transpileModule(sourceText, {
      fileName: sourcePath,
      compilerOptions,
    });
    return { code: outputText };
  },
};
