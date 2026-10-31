/**
 * 服务端版本号，与 packages/server/package.json 的 version 保持一致（由 app-version.spec.ts 守护）。
 * 不在运行时读取 package.json：服务端是 webpack 打包式构建，发布包里的相对路径不可靠。
 */
export const SES_SERVER_VERSION = '0.1.0';
