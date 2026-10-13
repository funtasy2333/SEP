// 服务端打包式构建的 webpack 配置（由 nest-cli.json 的 compilerOptions.builder 引用）。
//
// Nest CLI 在默认配置之上调用本函数，返回值会覆盖同名字段。目的：把工作区包 @ses/*
// 的源码打进 dist/main.js，其余 node_modules 依赖保持外部（运行时从 node_modules 加载）。
//
// 为什么必须打包 @ses/*：@ses/shared 的包入口直接指向 TS 源码（./src/index.ts，供
// Vite/vitest 使用），其内部是打包器风格的无扩展名/目录导入；若作为外部依赖，Node 运行
// 编译产物时会去加载这份 TS 源码并报 ERR_UNSUPPORTED_DIR_IMPORT（tsc 编译与 jest 都发现不了）。
//
// webpack-node-externals 是 server 的 devDependency（版本与 @nestjs/cli 自带的一致）。
// 它按 packages/server/node_modules 的目录清单决定哪些包外置，所以要求 cwd 为 packages/server
// （nest CLI 本身也依赖这一点）。shared 将来若引入 server 未声明的第三方包，该包会被一并打入产物，
// 而不是外置；需要外置时应把它加进 server 的 dependencies。
const nodeExternals = require('webpack-node-externals')

module.exports = (options) => ({
  ...options,
  externals: [nodeExternals({ allowlist: [/^@ses\//] })],
  // 保持 Node 原生的 __filename/__dirname（运行时为 dist/main.js 的真实路径）。
  // Nest 默认已如此；显式写出是因为 convert/pdf/build.ts 的 createRequire(__filename)
  // 依赖它来定位 @vivliostyle/cli 与 katex，不应受 Nest CLI 默认值变动影响。
  node: { __filename: false, __dirname: false },
})
