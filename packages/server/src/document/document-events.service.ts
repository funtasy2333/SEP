import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject, filter } from 'rxjs';

/**
 * 文档变更的来源：
 * - human：编辑器自动保存（PUT）或 `source: 'human'` 的 operations；
 * - ai：`source: 'ai'` 的 operations；
 * - system：服务端自己做的写入（读取前补齐缺失或重复的 nodeId），不代表任何人修改了内容。
 */
export type DocumentChangeSource = 'human' | 'ai' | 'system';

/** 一次写入的来源与写入方标识（如 MCP 客户端名称）。 */
export interface DocumentChangeOrigin {
  source: DocumentChangeSource;
  client?: string;
}

/**
 * 文档写入成功后发布的事件。不含文档内容：订阅方据 revision 判断自己持有的版本是否过期，
 * 需要内容时再通过读接口获取。
 */
export interface DocumentChangeEvent extends DocumentChangeOrigin {
  documentId: number;
  /** 写入后的 revision。 */
  revision: number;
  /** ISO 8601 时间（事件发布时刻）。 */
  at: string;
}

/**
 * 进程内的文档变更事件总线（rxjs）。只在单进程内有效：多实例部署需要换成跨进程的发布订阅，
 * 订阅方（SSE 端点）只依赖 {@link events}，不受影响。
 *
 * 事件在写入提交之后发布；发布不等待订阅方，订阅方的异常不影响写入。
 */
@Injectable()
export class DocumentEventsService implements OnModuleDestroy {
  private readonly changes = new Subject<DocumentChangeEvent>();
  private readonly subscribers = new Map<number, number>();

  publish(event: DocumentChangeEvent): void {
    this.changes.next(event);
  }

  /**
   * 订阅某个文档的事件。取消订阅（含订阅方断开）后计数随之减少；
   * 应用关闭时流正常完成，SSE 连接随之结束，不会拖住 HTTP 服务器的关闭。
   */
  events(documentId: number): Observable<DocumentChangeEvent> {
    return new Observable<DocumentChangeEvent>((subscriber) => {
      this.subscribers.set(
        documentId,
        (this.subscribers.get(documentId) ?? 0) + 1,
      );
      const subscription = this.changes
        .pipe(filter((event) => event.documentId === documentId))
        .subscribe(subscriber);
      return () => {
        subscription.unsubscribe();
        const remaining = (this.subscribers.get(documentId) ?? 1) - 1;
        if (remaining > 0) this.subscribers.set(documentId, remaining);
        else this.subscribers.delete(documentId);
      };
    });
  }

  /** 某个文档当前的订阅数（用于测试断开后是否清理，也可用于诊断）。 */
  subscriberCount(documentId: number): number {
    return this.subscribers.get(documentId) ?? 0;
  }

  onModuleDestroy(): void {
    this.changes.complete();
  }
}
