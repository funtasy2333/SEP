import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request } from 'express';

/** 允许触发写操作（升级、退出）的页面来源：只有本机的前端开发服务器。 */
export const ALLOWED_ORIGINS: readonly string[] = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

/**
 * 系统写接口（升级、退出）的防跨站守卫。REST 接口没有鉴权，任何网页都能向 127.0.0.1:3000 发请求，
 * 所以这里挡掉两类“无需 CORS 预检”的跨站写入：
 * - 带 Origin 头但不是本机前端（含 `Origin: null`）→ 403；
 * - Content-Type 不是 application/json（表单、text/plain 等“简单请求”）→ 415。
 * 非浏览器客户端（curl）不带 Origin，只需声明 JSON。
 */
@Injectable()
export class LocalWriteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const origin = req.headers.origin;
    if (origin !== undefined && !ALLOWED_ORIGINS.includes(origin)) {
      throw new ForbiddenException('不允许的请求来源');
    }
    const contentType = req.headers['content-type'];
    const mediaType =
      typeof contentType === 'string'
        ? contentType.split(';', 1)[0].trim().toLowerCase()
        : '';
    if (mediaType !== 'application/json') {
      throw new UnsupportedMediaTypeException(
        '请求的 Content-Type 必须是 application/json',
      );
    }
    return true;
  }
}
