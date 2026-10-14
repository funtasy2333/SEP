import {
  Controller,
  Delete,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpAccessGuard } from './mcp-access';
import { McpSessionService } from './mcp-sessions.service';
import { MCP_PATH } from './mcp.constants';

/**
 * MCP 端点（Streamable HTTP）：POST 发送 JSON-RPC 消息，GET 打开服务端到客户端的 SSE 流，
 * DELETE 结束会话。路径是 `/mcp`，不带 `api` 前缀（见 `configureApp`）。
 *
 * 响应由 SDK 的 transport 直接写入（`@Res()` 不使用 Nest 的响应序列化）；请求体沿用应用级的 JSON 解析器，
 * 已解析的内容交给 transport，不再重复读取。三个方法共用一个守卫：只接受本机连接，见 {@link McpAccessGuard}。
 */
@Controller(MCP_PATH)
@UseGuards(McpAccessGuard)
export class McpController {
  constructor(private readonly sessions: McpSessionService) {}

  @Post()
  post(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.sessions.handleRequest(req, res);
  }

  @Get()
  get(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.sessions.handleRequest(req, res);
  }

  @Delete()
  delete(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.sessions.handleRequest(req, res);
  }
}
