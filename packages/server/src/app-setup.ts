import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { MCP_PATH } from './mcp/mcp.constants';
import {
  SES_PACKAGE_BODY_LIMIT,
  SES_PACKAGE_MIME,
} from './ses-package/ses-package-format';

/** JSON 请求体上限：IR→HTML→PDF 端点接收完整 print HTML，可能远超默认的 100kb。 */
export const JSON_BODY_LIMIT = '25mb';

/**
 * 生产入口（main.ts）与测试应用（test-support/test-app.ts）共用的 HTTP 配置，保证两边的路由和请求体处理一致：
 * - JSON 请求体上限 {@link JSON_BODY_LIMIT}；
 * - 全局前缀 `api`，但 MCP 端点 `/mcp` 不带前缀（MCP 客户端配置的是 `http://127.0.0.1:3000/mcp`）。
 */
export function configureApp(app: NestExpressApplication): void {
  app.useBodyParser('raw', {
    type: SES_PACKAGE_MIME,
    limit: SES_PACKAGE_BODY_LIMIT,
  });
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.setGlobalPrefix('api', {
    exclude: [{ path: MCP_PATH, method: RequestMethod.ALL }],
  });
}
