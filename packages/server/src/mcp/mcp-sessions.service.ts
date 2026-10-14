import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { normalizeClientName } from './mcp-client-name';
import { TOOL_DEFINITIONS } from './mcp-tool-definitions';
import { McpToolsService } from './mcp-tools.service';
import { MCP_INSTRUCTIONS, MCP_SERVER_INFO } from './mcp.constants';

/** 注入令牌：会话管理参数。测试可替换时钟、超时与上限。 */
export const MCP_SESSION_OPTIONS = 'MCP_SESSION_OPTIONS';

export interface McpSessionOptions {
  /** 会话空闲（没有任何请求）满该时长即失效。 */
  idleTimeoutMs: number;
  /** 同时存在的会话数上限（小于 1 按 1 处理）；满时淘汰最久未使用的会话。 */
  maxSessions: number;
  /** 当前时间（毫秒）。测试可注入假时钟。 */
  now: () => number;
}

export const DEFAULT_MCP_SESSION_OPTIONS: McpSessionOptions = {
  idleTimeoutMs: 24 * 60 * 60 * 1000,
  maxSessions: 100,
  now: () => Date.now(),
};

/** 后台清理过期会话的间隔。过期会话即使还没被清理，下一次请求也会按失效处理（见 find）。 */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** JSON-RPC 错误码：与 SDK 的传输层对未知会话使用的一致。 */
const SESSION_NOT_FOUND_CODE = -32001;
const INVALID_REQUEST_CODE = -32000;
const INTERNAL_ERROR_CODE = -32603;

interface McpSession {
  /** 注册（initialize 成功）之前为 undefined。 */
  id?: string;
  readonly server: Server;
  readonly transport: StreamableHTTPServerTransport;
  lastUsedAt: number;
}

function sendRpcError(
  res: Response,
  status: number,
  code: number,
  message: string,
): void {
  res
    .status(status)
    .json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

/** 请求体（单个消息或批）里是否有 initialize 请求。 */
function containsInitializeRequest(body: unknown): boolean {
  return Array.isArray(body)
    ? body.some((message) => isInitializeRequest(message))
    : isInitializeRequest(body);
}

/**
 * MCP 会话管理（Streamable HTTP，有状态）。
 *
 * 每个会话一个 `Server` 加一个 transport，保存在内存里：需要在 `initialize` 时记下 `clientInfo.name`，
 * 写进 AI 版本记录的 `client` 字段。会话与进程同生命周期，重启后客户端收到 404 会重新 initialize。
 *
 * - 空闲满 {@link McpSessionOptions.idleTimeoutMs} 的会话失效（查找时检查，另有后台定时清理释放内存）；
 * - 会话数达到 {@link McpSessionOptions.maxSessions} 时，新会话建立前淘汰最久未使用的会话；
 * - 会话关闭（DELETE、过期、淘汰、应用关闭）时同时关闭 transport 与 Server，进行中的 SSE 流随之结束；
 * - 未知或已清理的会话 id → 404，没有会话 id 的非 initialize 请求 → 400（均为 MCP 规范的约定）。
 *
 * 日志只记录客户端连接（clientInfo.name）、会话的清理与淘汰和会话数，不记录请求内容。
 */
@Injectable()
export class McpSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpSessionService.name);
  private readonly sessions = new Map<string, McpSession>();
  private sweepTimer: NodeJS.Timeout | undefined;
  private destroyed = false;

  constructor(
    private readonly tools: McpToolsService,
    @Inject(MCP_SESSION_OPTIONS) private readonly options: McpSessionOptions,
  ) {}

  onModuleInit(): void {
    // unref：定时器不阻止进程退出。
    this.sweepTimer = setInterval(() => {
      this.sweep();
    }, SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  /** 应用关闭：停止清理定时器，关闭全部会话（结束它们的 SSE 流，HTTP 服务器才能正常关闭）。 */
  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    clearInterval(this.sweepTimer);
    await Promise.all([...this.sessions.values()].map((s) => this.dispose(s)));
  }

  /** 当前存活的会话数。 */
  get size(): number {
    return this.sessions.size;
  }

  /** 关闭所有已过期的会话，返回关闭的数量。 */
  sweep(): number {
    let closed = 0;
    for (const session of [...this.sessions.values()]) {
      if (!this.isExpired(session)) continue;
      closed++;
      void this.dispose(session);
    }
    if (closed > 0) {
      this.logger.log(
        `已清理 ${closed} 个空闲会话，剩余 ${this.sessions.size} 个`,
      );
    }
    return closed;
  }

  /** POST / GET / DELETE /mcp 的入口。 */
  async handleRequest(req: Request, res: Response): Promise<void> {
    if (this.destroyed) {
      sendRpcError(res, 503, INVALID_REQUEST_CODE, 'Server is shutting down');
      return;
    }
    const sessionId = req.header('mcp-session-id');
    if (!sessionId) {
      if (req.method === 'POST' && containsInitializeRequest(req.body)) {
        await this.startSession(req, res);
      } else {
        sendRpcError(
          res,
          400,
          INVALID_REQUEST_CODE,
          'Bad Request: Mcp-Session-Id header is required',
        );
      }
      return;
    }
    const session = this.find(sessionId);
    if (!session) {
      sendRpcError(res, 404, SESSION_NOT_FOUND_CODE, 'Session not found');
      return;
    }
    session.lastUsedAt = this.options.now();
    await session.transport.handleRequest(req, res, req.body);
  }

  private async startSession(req: Request, res: Response): Promise<void> {
    const session = this.createSession();
    try {
      await session.server.connect(session.transport);
      await session.transport.handleRequest(req, res, req.body);
    } catch (error) {
      const type =
        error instanceof Error ? error.constructor.name : typeof error;
      this.logger.error(`MCP 会话初始化失败（${type}）`);
      if (!res.headersSent) {
        sendRpcError(res, 500, INTERNAL_ERROR_CODE, 'Internal error');
      }
    } finally {
      // initialize 没有成功（如 Accept 头不对、请求体非法）：没有注册的会话不会被任何人再用到，立即释放。
      if (session.id === undefined) await this.dispose(session);
    }
  }

  private createSession(): McpSession {
    const server = new Server(MCP_SERVER_INFO, {
      capabilities: { tools: {} },
      instructions: MCP_INSTRUCTIONS,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      // 工具调用都是一问一答：直接返回 JSON，不开 SSE 流。
      enableJsonResponse: true,
      onsessioninitialized: (id) => this.register(session, id),
    });
    const session: McpSession = {
      server,
      transport,
      lastUsedAt: this.options.now(),
    };

    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [...TOOL_DEFINITIONS],
    }));
    server.setRequestHandler(CallToolRequestSchema, (request) =>
      this.tools.call(request.params.name, request.params.arguments, {
        clientName: server.getClientVersion()?.name,
      }),
    );
    server.oninitialized = () => {
      const name = normalizeClientName(server.getClientVersion()?.name);
      this.logger.log(
        `MCP 客户端已连接：${name}（会话数 ${this.sessions.size}）`,
      );
    };
    // 任何关闭途径（DELETE、过期、淘汰、应用关闭）最终都会触发 transport 的 onclose，进而到这里。
    server.onclose = () => {
      this.forget(session);
    };
    return session;
  }

  /**
   * initialize 成功、会话 id 已生成时由 transport 调用（同步完成检查与登记，并发的 initialize 不会突破上限）。
   * 达到上限时先淘汰最久未使用的会话；transport 等待本函数完成，被淘汰的会话关闭之后才返回 initialize 响应。
   */
  private async register(session: McpSession, id: string): Promise<void> {
    if (this.destroyed) throw new Error('MCP 服务正在关闭');
    const evicted: McpSession[] = [];
    while (this.sessions.size >= Math.max(1, this.options.maxSessions)) {
      const oldest = this.leastRecentlyUsed();
      if (!oldest) break;
      this.forget(oldest);
      evicted.push(oldest);
    }
    session.id = id;
    this.sessions.set(id, session);
    if (evicted.length > 0) {
      this.logger.warn(
        `会话数达到上限，已淘汰 ${evicted.length} 个最久未使用的会话`,
      );
    }
    await Promise.all(evicted.map((s) => this.dispose(s)));
  }

  private leastRecentlyUsed(): McpSession | undefined {
    let oldest: McpSession | undefined;
    for (const session of this.sessions.values()) {
      if (!oldest || session.lastUsedAt < oldest.lastUsedAt) oldest = session;
    }
    return oldest;
  }

  private isExpired(session: McpSession): boolean {
    return (
      this.options.now() - session.lastUsedAt >= this.options.idleTimeoutMs
    );
  }

  /** 按 id 查找存活的会话；已过期的会话在此被关闭并视为不存在。 */
  private find(id: string): McpSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (!this.isExpired(session)) return session;
    void this.dispose(session);
    return undefined;
  }

  private forget(session: McpSession): void {
    if (session.id !== undefined && this.sessions.get(session.id) === session) {
      this.sessions.delete(session.id);
    }
  }

  /** 从表中移除并关闭会话（先 Server 后 transport，由 Server.close 负责关闭 transport）。不会抛出。 */
  private async dispose(session: McpSession): Promise<void> {
    this.forget(session);
    try {
      await session.server.close();
    } catch (error) {
      const type =
        error instanceof Error ? error.constructor.name : typeof error;
      this.logger.error(`关闭 MCP 会话失败（${type}）`);
    }
  }
}
