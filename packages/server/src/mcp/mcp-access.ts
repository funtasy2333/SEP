import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * MCP 端点的访问控制（本地部署没有鉴权，改为只接受本机连接；浏览器发来的请求还必须来自本机页面）。三条都必须满足：
 *
 * 1. 连接来自回环地址。服务端默认只监听 127.0.0.1，但 SES_LISTEN_HOST 可以改成监听局域网地址，
 *    那时局域网里的机器可以直接连进来，并且能任意伪造 Host 头，所以不能只靠下面两条（与默认只监听本机互为双重保险）；
 * 2. Host 头是 localhost / 127.0.0.1 / [::1]（端口任意）：防 DNS 重绑定——攻击者的域名解析到 127.0.0.1 后，
 *    浏览器发出的请求仍带着攻击者的域名；
 * 3. 有 Origin 头时，它必须是上述三者之一（http 协议，端口任意）：防本机浏览器里的其他网页跨站调用。
 *    没有 Origin 头（非浏览器客户端，如 Claude Code）放行。
 *
 * 下面的判断函数都是纯函数，只做精确匹配：不做子串或后缀匹配（`localhost.evil.com`、
 * `127.0.0.1.nip.io` 必须被拒绝）。
 */

const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
/** 127.0.0.0/8；每段是不带前导零的 0~255。 */
const LOOPBACK_IPV4 = new RegExp(`^127(?:\\.${IPV4_OCTET}){3}$`);
const IPV4_MAPPED_PREFIX = '::ffff:';

const LOCAL_HOSTNAME = '(?:localhost|127\\.0\\.0\\.1|\\[::1\\])';
/** 主机名（大小写不敏感）加可选端口。端口范围另行检查。 */
const HOST_PATTERN = new RegExp(`^${LOCAL_HOSTNAME}(?::(\\d{1,5}))?$`, 'i');
const ORIGIN_PATTERN = new RegExp(
  `^http://${LOCAL_HOSTNAME}(?::(\\d{1,5}))?$`,
  'i',
);

const MAX_PORT = 65535;

function matchesLocalAuthority(value: string, pattern: RegExp): boolean {
  const match = pattern.exec(value);
  if (!match) return false;
  const port = match[1];
  return port === undefined || Number(port) <= MAX_PORT;
}

/**
 * 套接字的对端地址是否为回环地址：127.0.0.0/8、`::1`，或 IPv4 映射形式（`::ffff:127.x.x.x`，
 * 双栈监听时 Node 对 IPv4 连接给出的形式）。地址缺失（连接已断开）视为非回环。
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const lower = address.toLowerCase();
  if (lower === '::1') return true;
  const ipv4 = lower.startsWith(IPV4_MAPPED_PREFIX)
    ? lower.slice(IPV4_MAPPED_PREFIX.length)
    : lower;
  return LOOPBACK_IPV4.test(ipv4);
}

/** Host 头是否为 localhost、127.0.0.1 或 [::1]（端口任意，主机名大小写不敏感）。缺失视为不合法。 */
export function isAllowedHost(host: string | undefined): boolean {
  return host !== undefined && matchesLocalAuthority(host, HOST_PATTERN);
}

/**
 * Origin 头是否可接受：没有 Origin（`undefined`）放行；有则必须是 `http://localhost`、
 * `http://127.0.0.1` 或 `http://[::1]`（端口任意）。`null`、空字符串、https 与带路径的值都拒绝。
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  return origin === undefined || matchesLocalAuthority(origin, ORIGIN_PATTERN);
}

export type McpAccessDenial =
  | 'non-loopback-address'
  | 'invalid-host'
  | 'invalid-origin';

const DENIAL_MESSAGES: Record<McpAccessDenial, string> = {
  'non-loopback-address': 'MCP 端点只接受来自本机的连接',
  'invalid-host': 'MCP 端点只接受 Host 为 localhost、127.0.0.1 或 [::1] 的请求',
  'invalid-origin':
    'MCP 端点拒绝来自非本机页面的跨站请求（Origin 必须是 http://localhost、http://127.0.0.1 或 http://[::1]）',
};

export interface McpAccessRequest {
  remoteAddress: string | undefined;
  host: string | undefined;
  origin: string | undefined;
}

/** 依次检查三条规则，返回第一条被违反的；全部满足返回 `null`。 */
export function checkMcpAccess(
  request: McpAccessRequest,
): McpAccessDenial | null {
  if (!isLoopbackAddress(request.remoteAddress)) return 'non-loopback-address';
  if (!isAllowedHost(request.host)) return 'invalid-host';
  if (!isAllowedOrigin(request.origin)) return 'invalid-origin';
  return null;
}

/**
 * 守卫：不满足访问控制的请求一律 403。日志只记录被拒绝的原因，不记录地址、Host 或 Origin 的值。
 * 注意守卫在 JSON 请求体解析之后执行（解析器是应用级中间件），本机之外的连接仍可让服务端读取请求体；
 * 这与其余 /api 接口的暴露面相同，没有新增风险。
 */
@Injectable()
export class McpAccessGuard implements CanActivate {
  private readonly logger = new Logger(McpAccessGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const denial = checkMcpAccess({
      remoteAddress: req.socket.remoteAddress,
      host: req.headers.host,
      origin: req.headers.origin,
    });
    if (denial === null) return true;
    this.logger.warn(`已拒绝 MCP 请求（${denial}）`);
    throw new ForbiddenException(DENIAL_MESSAGES[denial]);
  }
}
