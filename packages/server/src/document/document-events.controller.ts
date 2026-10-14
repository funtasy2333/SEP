import {
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  DocumentEventsService,
  type DocumentChangeEvent,
} from './document-events.service';
import { DocumentService } from './document.service';

/** 注入令牌：SSE 心跳间隔（毫秒）。测试可替换为很小的值。 */
export const DOCUMENT_EVENTS_HEARTBEAT_MS = 'DOCUMENT_EVENTS_HEARTBEAT_MS';
/** 默认心跳间隔：低于常见反向代理/负载均衡的空闲超时（多为 30～60 秒）。 */
export const DEFAULT_HEARTBEAT_MS = 15_000;
/** 告诉浏览器 EventSource 断线后等待多久重连。 */
const RECONNECT_DELAY_MS = 3_000;

/** SSE 事件名：文档 revision 发生了变化。 */
export const DOCUMENT_CHANGED_EVENT = 'document-changed';

/**
 * 一条变更事件的 SSE 文本。`id` 为写入后的 revision；`data` 是 {@link DocumentChangeEvent} 的 JSON
 * （不含文档内容）。事件不会重放：断线重连期间发生的变更不会补发，见控制器说明。
 */
export function formatChangeEvent(event: DocumentChangeEvent): string {
  return `event: ${DOCUMENT_CHANGED_EVENT}\nid: ${event.revision}\ndata: ${JSON.stringify(event)}\n\n`;
}

@Controller('documents')
export class DocumentEventsController {
  constructor(
    private readonly documents: DocumentService,
    private readonly events: DocumentEventsService,
    @Inject(DOCUMENT_EVENTS_HEARTBEAT_MS)
    private readonly heartbeatMs: number,
  ) {}

  /**
   * GET /api/documents/:id/events
   * Server-Sent Events：该文档每次写入成功（PUT、operations、读接口触发的 nodeId 规范化）推送一条
   * `document-changed` 事件，`data` 为 `{ documentId, revision, source, client?, at }`，不含文档内容。
   * 另外每隔固定时间发送一行注释 `: heartbeat` 保持连接，防止代理因空闲断开。
   * 文档不存在返回 404（普通 JSON 错误，此时尚未进入事件流）。存在性检查经过写锁，
   * 在途的 operations 事务结束后才返回；锁只覆盖这次检查，不覆盖之后长期保持的事件流。
   *
   * 不重放历史事件，也不推送连接建立时的当前 revision。客户端的正确顺序是：**先订阅，再读取文档**，
   * 并在每次（重新）连接成功后重新读取文档、与自己持有的 revision 比较；先读后订阅会漏掉两者之间发生的变更。
   */
  @Get(':id/events')
  async stream(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.documents.assertExists(id);
    // 等待期间客户端已经走了：close 事件已错过，不能再订阅（否则订阅与心跳定时器永远不会被清理）。
    if (res.destroyed) return;

    // 与 Nest 内建 @Sse() 相同的连接设置：长连接不受 socket 超时影响，小包立即发出。
    req.socket.setKeepAlive(true);
    req.socket.setNoDelay(true);
    req.socket.setTimeout(0);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // 提示 nginx 不要缓冲响应。
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`retry: ${RECONNECT_DELAY_MS}\n\n`);

    const write = (chunk: string): void => {
      try {
        res.write(chunk);
      } catch {
        // 连接已断开，res 的 close 事件会清理订阅；写失败不应影响其他订阅方。
      }
    };
    const subscription = this.events.events(id).subscribe({
      next: (event) => write(formatChangeEvent(event)),
      // 应用关闭时事件流完成：结束响应，HTTP 服务器才能关闭。
      complete: () => res.end(),
    });
    const heartbeat = setInterval(
      () => write(': heartbeat\n\n'),
      this.heartbeatMs,
    );
    // 响应结束或底层连接断开（客户端关闭页面、网络中断）：取消订阅并停掉心跳定时器。
    // 不用 req 的 close：它在请求读完时就可能触发，与连接是否存活无关。
    res.on('close', () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
    });
  }
}
