import { isIP } from 'node:net';
import { LISTEN_HOST_ENV, resolveListenAddress } from '../listen-host';

/**
 * Host 头的判断（纯函数，只做精确匹配）：防 DNS 重绑定。
 * 攻击者的域名解析到 127.0.0.1 后，浏览器发出的请求仍同源、不受 CORS 限制，但 Host 头是攻击者的域名；
 * 所以服务端只接受自己的访问地址。不做子串或后缀匹配（`localhost.evil.com`、`127.0.0.1.nip.io` 必须被拒绝）。
 */

const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
/** 127.0.0.0/8；每段是不带前导零的 0~255。 */
export const LOOPBACK_IPV4 = new RegExp(`^127(?:\\.${IPV4_OCTET}){3}$`);

export const LOCAL_HOSTNAME = '(?:localhost|127\\.0\\.0\\.1|\\[::1\\])';
/** 主机名（大小写不敏感）加可选端口。端口范围另行检查。 */
const HOST_PATTERN = new RegExp(`^${LOCAL_HOSTNAME}(?::(\\d{1,5}))?$`, 'i');

export const MAX_PORT = 65535;

/** value 是否匹配 pattern（捕获组 1 是可选端口），且端口不超过 65535。 */
export function matchesLocalAuthority(value: string, pattern: RegExp): boolean {
  const match = pattern.exec(value);
  if (!match) return false;
  const port = match[1];
  return port === undefined || Number(port) <= MAX_PORT;
}

/** Host 头是否为 localhost、127.0.0.1 或 [::1]（端口任意，主机名大小写不敏感）。缺失视为不合法。 */
export function isAllowedHost(host: string | undefined): boolean {
  return host !== undefined && matchesLocalAuthority(host, HOST_PATTERN);
}

/** 环境变量：追加允许的 Host（逗号分隔；主机名或 IP，可选端口；IPv6 写成 `[addr]`）。 */
export const ALLOWED_HOSTS_ENV = 'SES_ALLOWED_HOSTS';

/** 主机名（字母数字、点、连字符、下划线）或方括号 IPv6，加可选端口。 */
const AUTHORITY_PATTERN = /^(\[[0-9a-f:.]+\]|[a-z0-9._-]+)(?::(\d{1,5}))?$/;

interface Authority {
  hostname: string;
  port: number | undefined;
}

/** 解析并规范化 Host 头或配置项（小写；IPv6 地址写成浏览器发送的压缩形式）。格式不合法返回 null。 */
function parseAuthority(value: string): Authority | null {
  const match = AUTHORITY_PATTERN.exec(value.trim().toLowerCase());
  if (!match) return null;
  let hostname = match[1];
  const port = match[2] === undefined ? undefined : Number(match[2]);
  if (port !== undefined && (port < 1 || port > MAX_PORT)) return null;
  if (hostname.startsWith('[')) {
    const address = hostname.slice(1, -1);
    if (isIP(address) !== 6) return null;
    try {
      hostname = new URL(`http://[${address}]/`).hostname;
    } catch {
      return null;
    }
  }
  return { hostname, port };
}

export interface AllowedHostRules {
  /** 任意端口都放行的主机名（含 IPv6 的方括号）。 */
  anyPort: Set<string>;
  /** 必须连端口一起精确匹配的 `主机名:端口`。 */
  withPort: Set<string>;
}

function isWildcardAddress(host: string): boolean {
  if (host === '0.0.0.0') return true;
  if (isIP(host) !== 6) return false;
  try {
    return new URL(`http://[${host}]/`).hostname === '[::]';
  } catch {
    return false;
  }
}

/**
 * 从环境变量得到额外允许的 Host（回环三者另由 {@link isAllowedHost} 判断）：
 * - `SES_ALLOWED_HOSTS` 的每一项（去空白、忽略空项和格式不合法的项）；
 * - `SES_LISTEN_HOST` 是具体的非通配地址（不是 0.0.0.0 / ::）时，它本身（任意端口）——
 *   用户特意监听某个局域网地址，就是要用这个地址访问。
 */
export function resolveAllowedHostRules(
  env: NodeJS.ProcessEnv = process.env,
): AllowedHostRules {
  const rules: AllowedHostRules = {
    anyPort: new Set(),
    withPort: new Set(),
  };
  const add = (authority: Authority): void => {
    if (authority.port === undefined) rules.anyPort.add(authority.hostname);
    else rules.withPort.add(`${authority.hostname}:${authority.port}`);
  };

  for (const item of (env[ALLOWED_HOSTS_ENV] ?? '').split(',')) {
    if (item.trim() === '') continue;
    const authority = parseAuthority(item);
    if (authority) add(authority);
  }

  if ((env[LISTEN_HOST_ENV] ?? '').trim() !== '') {
    const { host } = resolveListenAddress(env);
    if (!isWildcardAddress(host)) {
      const authority = parseAuthority(isIP(host) === 6 ? `[${host}]` : host);
      if (authority) add(authority);
    }
  }
  return rules;
}

/**
 * 请求的 Host 头是否被允许：localhost / 127.0.0.1 / [::1]（任意端口），或环境变量追加的 Host。
 * Host 缺失一律拒绝。每次调用都重新读取传入的环境变量。
 */
export function isHostAllowed(
  host: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (host === undefined) return false;
  if (isAllowedHost(host)) return true;
  const authority = parseAuthority(host);
  if (!authority) return false;
  const rules = resolveAllowedHostRules(env);
  if (rules.anyPort.has(authority.hostname)) return true;
  return (
    authority.port !== undefined &&
    rules.withPort.has(`${authority.hostname}:${authority.port}`)
  );
}
