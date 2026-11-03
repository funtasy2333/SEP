import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { closeSync, openSync, readSync, rmSync } from 'fs';
import { open } from 'fs/promises';
import type { IncomingMessage } from 'http';
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

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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
    let response: IncomingMessage | undefined;
    try {
      try {
        arm();
        response = await this.openResponse(target.url, controller.signal, arm);
        const length = Number(response.headers['content-length']);
        const expected = Number.isFinite(length) && length > 0 ? length : null;
        const total = target.size ?? expected;
        const hash = createHash('sha256');
        let received = 0;
        hooks.onProgress(0, total);
        // 只有等待网络数据时才计停滞；写盘期间不计
        const iterator = response[Symbol.asyncIterator]();
        for (;;) {
          arm();
          const next = await iterator.next().finally(disarm);
          if (next.done) break;
          const chunk = next.value as Buffer;
          hash.update(chunk);
          await writeFully(file, chunk);
          received += chunk.length;
          hooks.onProgress(received, total);
        }
        if (expected !== null && received !== expected) {
          throw new DownloadError(
            `下载不完整（收到 ${received} 字节，应为 ${expected} 字节），请重试`,
          );
        }
        return { receivedBytes: received, sha256: hash.digest('hex') };
      } catch (error) {
        return fail(error);
      }
    } finally {
      disarm();
      response?.destroy();
      await file.close();
    }
  }

  /** 发起 GET 并跟随重定向，返回最终的 2xx 响应；所有失败都以 reject 传出。 */
  private async openResponse(
    startUrl: string,
    signal: AbortSignal,
    arm: () => void,
  ): Promise<IncomingMessage> {
    let current = new URL(startUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        throw new DownloadError(
          `下载失败：不支持的下载地址协议 ${current.protocol}`,
        );
      }
      arm();
      const response = await this.requestOnce(current, signal);
      const status = response.statusCode ?? 0;
      if (REDIRECT_STATUSES.has(status)) {
        const location = response.headers.location;
        response.destroy();
        if (!location) {
          throw new DownloadError(
            `下载失败：服务器返回 HTTP ${status} 但没有给出跳转地址`,
          );
        }
        if (hop === MAX_REDIRECTS) {
          throw new DownloadError(
            `下载失败：重定向次数过多（超过 ${MAX_REDIRECTS} 次）`,
          );
        }
        current = new URL(location, current);
        continue;
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        throw new DownloadError(`下载失败：服务器返回 HTTP ${status}`);
      }
      return response;
    }
    /* istanbul ignore next */
    throw new DownloadError('下载失败：重定向次数过多');
  }

  private requestOnce(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
    return new Promise<IncomingMessage>((resolve, reject) => {
      const request = this.config.httpGet(url, {
        headers: this.github.headers('application/octet-stream'),
        signal,
      });
      // 常驻的 error 监听：响应到达之后请求上再出错也不能变成未捕获异常
      request.on('error', reject);
      request.once('response', (response) => {
        // 同理：响应流的错误在迭代器接管之前也要有人接
        response.on('error', () => undefined);
        resolve(response);
      });
    });
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
