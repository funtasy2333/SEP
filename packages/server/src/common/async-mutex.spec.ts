import { AsyncMutex } from './async-mutex';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('AsyncMutex', () => {
  it('任务按调用顺序一个接一个运行，不交错', async () => {
    const mutex = new AsyncMutex();
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name}:开始`);
      await tick();
      await tick();
      log.push(`${name}:结束`);
      return name;
    };

    const results = await Promise.all(
      ['甲', '乙', '丙'].map((name) => mutex.runExclusive(task(name))),
    );
    expect(results).toEqual(['甲', '乙', '丙']);
    expect(log).toEqual([
      '甲:开始',
      '甲:结束',
      '乙:开始',
      '乙:结束',
      '丙:开始',
      '丙:结束',
    ]);
  });

  it('前一个任务失败不影响后面的任务，失败只传给它自己的调用方', async () => {
    const mutex = new AsyncMutex();
    const failing = mutex.runExclusive(async () => {
      await tick();
      throw new Error('失败的任务');
    });
    const following = mutex.runExclusive(() => Promise.resolve('后续任务'));

    await expect(failing).rejects.toThrow('失败的任务');
    await expect(following).resolves.toBe('后续任务');
    // 失败之后锁仍然可用。
    await expect(mutex.runExclusive(() => Promise.resolve(1))).resolves.toBe(1);
  });

  it('不同的锁互不影响', async () => {
    const first = new AsyncMutex();
    const second = new AsyncMutex();
    let release!: () => void;
    const held = first.runExclusive(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    await expect(
      second.runExclusive(() => Promise.resolve('不受阻塞')),
    ).resolves.toBe('不受阻塞');
    release();
    await held;
  });
});
