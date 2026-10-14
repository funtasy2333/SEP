import { BlockList, isIP } from 'node:net';

/**
 * 服务端监听地址：本地部署默认只接受本机请求（127.0.0.1），REST 接口没有鉴权，
 * 监听局域网地址等于把全部文档开放给同一网络里的所有设备。
 *
 * 环境变量用 `SES_LISTEN_HOST`，**不要用 `HOST`**：有些环境把 `HOST` 设成机器名，服务端会因此意外绑到局域网地址。
 */

/** 环境变量：覆盖监听地址（例如 `0.0.0.0` 允许局域网访问）。空白按未设置处理。 */
export const LISTEN_HOST_ENV = 'SES_LISTEN_HOST';

/** 缺省只监听 IPv4 回环。开发代理（vite.config.ts）因此直连 127.0.0.1，而不是可能先解析成 ::1 的 localhost。 */
export const DEFAULT_LISTEN_HOST = '127.0.0.1';

/** 监听的不是本机地址时打在启动日志里的警告。 */
export const NON_LOOPBACK_WARNING =
  '已监听非本机地址，REST 接口没有鉴权，局域网内的设备可以读写全部文档';

export interface ListenAddress {
  host: string;
  /** host 是否只接受本机连接（回环地址或 localhost）。 */
  loopback: boolean;
}

/** 回环地址：127.0.0.0/8、::1，以及映射成 IPv6 的 IPv4 回环（::ffff:127.x.x.x）。 */
const loopbackAddresses = new BlockList();
loopbackAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
loopbackAddresses.addAddress('::1', 'ipv6');
loopbackAddresses.addSubnet('::ffff:127.0.0.0', 104, 'ipv6');

function isLoopbackHost(host: string): boolean {
  if (host.toLowerCase() === 'localhost') return true;
  const family = isIP(host);
  if (family === 0) return false; // 其他主机名：解析到哪里不确定，按非本机处理
  try {
    return loopbackAddresses.check(host, family === 4 ? 'ipv4' : 'ipv6');
  } catch {
    return false; // 带区域标识的 IPv6 等 BlockList 不接受的写法
  }
}

/**
 * 从环境变量解析监听地址：`SES_LISTEN_HOST` 去掉首尾空白后非空则用它（也接受带方括号的 IPv6 写法 `[::1]`），
 * 否则为 {@link DEFAULT_LISTEN_HOST}。纯函数，每次调用都重新读取传入的环境变量。
 */
export function resolveListenAddress(
  env: NodeJS.ProcessEnv = process.env,
): ListenAddress {
  let host = env[LISTEN_HOST_ENV]?.trim() ?? '';
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === '') host = DEFAULT_LISTEN_HOST;
  return { host, loopback: isLoopbackHost(host) };
}

/** 启动日志里的地址：IPv6 要加方括号。 */
export function formatListenUrl(host: string, port: string | number): string {
  return `http://${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}
