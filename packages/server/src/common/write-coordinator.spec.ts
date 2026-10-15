import { WriteCoordinator } from './write-coordinator';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('WriteCoordinator', () => {
  it('不同调用方提交的写入一个接一个运行，不交错', async () => {
    const coordinator = new WriteCoordinator();
    const log: string[] = [];
    const write = (name: string) => async () => {
      log.push(`${name}:开始`);
      await tick();
      await tick();
      log.push(`${name}:结束`);
    };

    await Promise.all([
      coordinator.run(write('文档')),
      coordinator.run(write('版本')),
      coordinator.run(write('事务')),
    ]);
    expect(log).toEqual([
      '文档:开始',
      '文档:结束',
      '版本:开始',
      '版本:结束',
      '事务:开始',
      '事务:结束',
    ]);
  });

  it('写入失败不阻塞后面的写入', async () => {
    const coordinator = new WriteCoordinator();
    const failing = coordinator.run(async () => {
      await tick();
      throw new Error('写入失败');
    });
    const following = coordinator.run(() => Promise.resolve('后续写入'));
    await expect(failing).rejects.toThrow('写入失败');
    await expect(following).resolves.toBe('后续写入');
  });

  it('不可重入：写入任务里再次 run 会一直排队，所以事务内必须使用传入的 manager 而不是会加锁的方法', async () => {
    const coordinator = new WriteCoordinator();
    let innerStarted = false;
    const outer = coordinator.run(async () => {
      await coordinator.run(() => {
        innerStarted = true;
        return Promise.resolve();
      });
    });

    const outcome = await Promise.race([
      outer.then(() => '完成'),
      new Promise<string>((resolve) => setTimeout(() => resolve('卡住'), 100)),
    ]);
    expect(outcome).toBe('卡住');
    expect(innerStarted).toBe(false);
  });
});
