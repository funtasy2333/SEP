import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { isHostAllowed } from './allowed-host';

const logger = new Logger('HostCheck');

/** 403 响应体。形状与 Nest 的 ForbiddenException 一致，前端按通用错误处理。 */
export const HOST_FORBIDDEN_BODY = {
  statusCode: 403,
  error: 'Forbidden',
  message:
    '请求的 Host 不在允许范围内（防 DNS 重绑定）。如需局域网访问，请在 SES_ALLOWED_HOSTS 中加入访问地址',
} as const;

/**
 * 对所有请求（/api/*、SSE、/mcp）检查 Host 头，防 DNS 重绑定：攻击者的域名解析到 127.0.0.1 后，
 * 浏览器发出的请求是同源的，CORS 不起作用，但 Host 头仍是攻击者的域名。
 * 允许的 Host 见 {@link isHostAllowed}。日志只记录拒绝这件事，不记录 Host 的值。
 */
export function hostCheckMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isHostAllowed(req.headers.host)) {
    next();
    return;
  }
  logger.warn('已拒绝请求（invalid-host：Host 不在允许范围内）');
  res.status(403).json(HOST_FORBIDDEN_BODY);
}
