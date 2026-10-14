// jest 加载文本文件（别名 @docs/authoring-reference 指向的 docs/wp9-authoring-reference.md，见
// package.json 的 jest.moduleNameMapper）时使用的转换器：把文件内容导出为字符串模块，
// 与 webpack.config.js 里对该文件使用的 asset/source 规则等价。
module.exports = {
  process(sourceText) {
    return { code: `module.exports = ${JSON.stringify(sourceText)};` };
  },
};
