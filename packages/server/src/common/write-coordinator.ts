import { Injectable } from '@nestjs/common';
import { AsyncMutex } from './async-mutex';

/**
 * 全服务端唯一的「写库协调者」：所有会修改数据库的操作都必须经过 {@link run}，一次只运行一个。
 *
 * 为什么需要它：TypeORM 的 better-sqlite3 驱动整个进程只有一个连接、一个 QueryRunner，而不是一个连接池。
 * 数据库事务属于这个连接，而不属于发起它的那次 HTTP 请求：事务打开期间（`await` 让出事件循环时）
 * 别的请求发出的任何语句——INSERT、DELETE、UPDATE，甚至另一个 `transaction()`（变成 SAVEPOINT）——
 * 都会在这个事务里执行。事务一旦回滚，这些写入连同它们已经返回给调用方的「成功」响应一起消失；
 * 反过来，事务里的一条语句失败，也可能让别人刚完成的删除被撤销（已删除的文档复活）。
 * 所以写入之间必须在应用层串行化；这个类就是那把全局锁。
 *
 * 约定（必须遵守，否则死锁）：
 * 1. 每一个写库的公开入口（`save` / `delete` / `insert` / `update` / `remove` / `transaction` /
 *    写操作的 QueryBuilder）都包在一次 `run()` 里。新增写入时先问自己：它经过协调者了吗？
 * 2. 锁不可重入。在 `run()` 的任务里（含 `DocumentService.transaction` 的回调）再调用 `run()`，
 *    或调用任何会 `run()` 的公开方法（`DocumentService.create/update/remove/transaction`、`VersionService.create`），
 *    都会永远等待自己。任务内部的写入一律使用调用方传入的 `EntityManager`，且自己不再加锁，
 *    例如 `DocumentService.updateWithin(manager, …)`、`VersionService.createForAiWrite(manager, …)`。
 *    这类方法的文档注释里都有这条说明：新增类似方法时照此办理。
 * 3. 任务要尽量短，不要在任务里等待外部输入（用户、网络）：任务不结束，之后所有写入都在排队。
 *
 * 读不受这把锁约束：单条读语句本身是原子的，但事务打开期间它读到的是事务内尚未提交的数据
 * ——这是共享连接的已知限制。
 *
 * 提供方式：`WriteCoordinatorModule` 导出它，DocumentModule 与 VersionModule 各自导入该模块。
 * Nest 的静态模块是单例，所以全应用共享同一个实例（同一把锁）。
 */
@Injectable()
export class WriteCoordinator {
  private readonly mutex = new AsyncMutex();

  /** 排队执行 `task`：前面的写入全部结束（成功或失败）后才开始，期间不会有别的写入开始。 */
  run<T>(task: () => Promise<T>): Promise<T> {
    return this.mutex.runExclusive(task);
  }
}
