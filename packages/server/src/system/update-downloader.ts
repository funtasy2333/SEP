import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { closeSync, openSync, readSync, rmSync } from 'fs';
import { open } from 'fs/promises';
import { describeNetworkError, GithubClient } from './github-client';
import { SYSTEM_CONFIG, type SystemConfig } from './system.config';
import type { DownloadTarget } from './system.types';

/** 下载或校验失败；message 是可直接展示给用户的中文原因。 */
export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadError';
  }
}

export interface DownloadHooks {
  onProgress: (receivedBytes: number, totalBytes: number | null) => void;
  /** 数据收完、开始校验时调用。 */
  onVerifying: () => void;
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** 流式下载更新包到 partial 文件并校验；失败时负责删除 partial。 */
@Injectable()
export class UpdateDownloader {
  constructor(
    @Inject(SYSTEM_CONFIG) private readonly config: SystemConfig,
    private readonly github: GithubClient,
  ) {}

  async download(
    target: DownloadTarget,
    partialFile: string,
    hooks: DownloadHooks,
  ): Promise<void> {
    try {
      const { receivedBytes, sha256 } = await this.fetchToFile(
        target,
        partialFile,
        hooks,
      );
      hooks.onVerifying();
      this.verify(target, partialFile, receivedBytes, sha256);
    } catch (error) {
      rmSync(partialFile, { force: true });
      throw error;
    }
  }

  private async fetchToFile(
    target: DownloadTarget,
    partialFile: string,
    hooks: DownloadHooks,
  ): Promise<{ receivedBytes: number; sha256: string }> {
    const { stallTimeoutMs } = this.config;
    const controller = new AbortController();
    let stalled = false;
    let timer: NodeJS.Timeout | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        controller.abort();
      }, stallTimeoutMs);
    };
    const disarm = () => clearTimeout(timer);

    const fail = (error: unknown): never => {
      if (error instanceof DownloadError) throw error;
      if (stalled) {
        throw new DownloadError(
          `下载停滞超过 ${Math.round(stallTimeoutMs / 1000)} 秒，已中止，请检查网络或代理`,
        );
      }
      throw new DownloadError(`下载失败：${describeNetworkError(error)}`);
    };

    const file = await open(partialFile, 'w');
    try {
      arm();
      let response: Response;
      try {
        response = await this.config.fetch(target.url, {
          headers: this.github.headers('application/octet-stream'),
          redirect: 'follow',
          signal: controller.signal,
        });
      } catch (error) {
        return fail(error);
      } finally {
        disarm();
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new DownloadError(`下载失败：服务器返回 HTTP ${response.status}`);
      }
      const length = Number(response.headers.get('content-length'));
      const total =
        target.size ?? (Number.isFinite(length) && length > 0 ? length : null);
      const hash = createHash('sha256');
      let received = 0;
      hooks.onProgress(0, total);
      const reader = response.body.getReader();
      try {
        for (;;) {
          arm();
          const { done, value } = await reader.read().finally(disarm);
          if (done) break;
          hash.update(value);
          await writeFully(file, value);
          received += value.length;
          hooks.onProgress(received, total);
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        return fail(error);
      }
      return { receivedBytes: received, sha256: hash.digest('hex') };
    } finally {
      disarm();
      await file.close();
    }
  }

  private verify(
    target: DownloadTarget,
    partialFile: string,
    receivedBytes: number,
    sha256: string,
  ): void {
    if (target.size !== null && receivedBytes !== target.size) {
      throw new DownloadError(
        `下载不完整（收到 ${receivedBytes} 字节，应为 ${target.size} 字节），请重试`,
      );
    }
    if (target.sha256 !== null && sha256 !== target.sha256) {
      throw new DownloadError(
        '更新包校验失败（SHA-256 与发布信息不一致），已丢弃',
      );
    }
    if (!startsWithZipMagic(partialFile)) {
      throw new DownloadError('下载的文件不是有效的 zip 压缩包，已丢弃');
    }
  }
}

async function writeFully(
  file: Awaited<ReturnType<typeof open>>,
  chunk: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await file.write(
      chunk,
      offset,
      chunk.length - offset,
    );
    offset += bytesWritten;
  }
}

function startsWithZipMagic(file: string): boolean {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(ZIP_MAGIC.length);
    const read = readSync(fd, head, 0, head.length, 0);
    return read === head.length && head.equals(ZIP_MAGIC);
  } finally {
    closeSync(fd);
  }
}
