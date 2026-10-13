/**
 * 进程内的异步互斥锁：同一时刻只运行一个 `runExclusive` 的任务，其余按调用顺序排队。
 *
 * 用途见 DocumentService.transaction：TypeORM 的 SQLite 驱动整个进程只有一个连接、一个 QueryRunner，
 * 并发的 `transaction()` 不会彼此隔离（后开始的会变成前者事务里的 SAVEPOINT），必须由应用层串行化。
 *
 * 不可重入：任务内部再对同一把锁调用 `runExclusive` 会永远等待自己。
 */
export class AsyncMutex {
  private tail: Promise<unknown> = Promise.resolve();

  runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    // 前一个任务失败不能阻塞后面的任务；失败本身由 result 的调用方处理。
    this.tail = result.catch(() => undefined);
    return result;
  }
}
