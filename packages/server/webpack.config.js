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
// 例外：@ses/* 导入的、server 也声明了但解析到不同版本的包同样会被打入产物，见下面的 externals()。
const path = require('path')
const nodeExternals = require('webpack-node-externals')

const serverDir = __dirname
const externalizeServerDependencies = nodeExternals({ allowlist: [/^@ses\//] })

function isInside(directory, parent) {
  const relative = path.relative(parent, directory)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

// 在 nodeExternals 的基础上补一条规则：@ses/* 源码里导入的第三方包，若解析到的与 server 自己
// 解析到的不是同一份（版本不同），就不外置，改为打入产物。
//
// 原因：nodeExternals 只看包名。外置后产物里是 require('katex')，运行时只会从 dist/main.js
// 所在位置解析，即 server 的版本；@ses/io 声明的 katex ^0.16.44 会被静默换成 server 为 PDF 预渲染
// 锁定的 0.16.11，DOCX 公式输出就可能与编辑器（用 0.16.44）不一致。打入后 webpack 按导入方所在位置
// 解析（packages/io/node_modules），server 自己的 import 仍外置，两个版本各用各的。
// 版本相同（解析到同一真实路径）时照旧外置，不增加产物体积。含原生扩展的包（如 better-sqlite3）
// 不能走这条路：@ses/* 若需要不同版本的原生包，应统一版本，而不是打包。
function externals({ context, request, getResolve }, callback) {
  externalizeServerDependencies({ context, request }, (error, external) => {
    if (error || !external || isInside(context, serverDir)) return callback(error, external)
    const resolve = getResolve()
    resolve(context, request, (importerError, importerPath) => {
      if (importerError) return callback(null, external)
      resolve(serverDir, request, (serverError, serverPath) => {
        if (serverError || serverPath === importerPath) return callback(null, external)
        callback() // 版本不同：交给 webpack 打包
      })
    })
  })
}

module.exports = (options) => ({
  ...options,
  externals: [externals],
  // 保持 Node 原生的 __filename/__dirname（运行时为 dist/main.js 的真实路径）。
  // Nest 默认已如此；显式写出是因为 convert/pdf/build.ts 的 createRequire(__filename)
  // 依赖它来定位 @vivliostyle/cli 与 katex，不应受 Nest CLI 默认值变动影响。
  node: { __filename: false, __dirname: false },
})
