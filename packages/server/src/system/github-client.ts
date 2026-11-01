import { Inject, Injectable } from '@nestjs/common';
import { GITHUB_REPO, SYSTEM_CONFIG, type SystemConfig } from './system.config';

/** GitHub 访问失败：status 为 HTTP 状态码，网络层失败（超时、DNS、拒绝连接）时为 null。 */
export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'GithubError';
  }
}

export interface GithubReleaseAsset {
  name: string;
  size: number | null;
  browserDownloadUrl: string;
  /** "sha256:<hex>" 形式的校验和，GitHub 较早上传的资产没有。 */
  digest: string | null;
}

export interface GithubRelease {
  tagName: string;
  draft: boolean;
  prerelease: boolean;
  body: string | null;
  htmlUrl: string;
  publishedAt: string | null;
  assets: GithubReleaseAsset[];
}

export interface GithubCommit {
  sha: string;
  message: string;
  date: string | null;
  author: string | null;
}

export type CompareStatus = 'identical' | 'ahead' | 'behind' | 'diverged';

export interface GithubCompare {
  status: CompareStatus;
  /** 旧 → 新的提交列表（GitHub 原始顺序）。 */
  commits: GithubCommit[];
}

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** 取嵌套字段，沿途遇到非对象就得到 undefined。 */
function dig(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Json)[key];
  }
  return current;
}

function toCommit(raw: Json): GithubCommit {
  const message = str(dig(raw, 'commit', 'message')) ?? '';
  return {
    sha: String(raw.sha),
    message: message.split(/\r?\n/, 1)[0],
    date:
      str(dig(raw, 'commit', 'committer', 'date')) ??
      str(dig(raw, 'commit', 'author', 'date')),
    author:
      str(dig(raw, 'author', 'login')) ??
      str(dig(raw, 'commit', 'author', 'name')),
  };
}

/** 只负责向 GitHub REST API 取数据并整理成内部结构；所有网络访问都经过 config.fetch。 */
@Injectable()
export class GithubClient {
  constructor(@Inject(SYSTEM_CONFIG) private readonly config: SystemConfig) {}

  /** 通用请求头：GitHub 要求带 User-Agent。 */
  headers(accept = 'application/vnd.github+json'): Record<string, string> {
    return {
      Accept: accept,
      'User-Agent': `SES/${this.config.serverVersion}`,
    };
  }

  private async getJson(path: string): Promise<Json> {
    let response: Response;
    try {
      response = await this.config.fetch(
        `${this.config.githubApiBase}${path}`,
        {
          headers: this.headers(),
          signal: AbortSignal.timeout(this.config.apiTimeoutMs),
        },
      );
    } catch (error) {
      throw new GithubError(describeNetworkError(error), null);
    }
    if (!response.ok) {
      // 把响应体丢掉：只需要状态码，避免挂着未读取的连接
      await response.body?.cancel().catch(() => undefined);
      throw new GithubError(
        describeHttpStatus(response.status),
        response.status,
      );
    }
    try {
      return (await response.json()) as Json;
    } catch (error) {
      throw new GithubError(describeNetworkError(error), null);
    }
  }

  async listReleases(): Promise<GithubRelease[]> {
    const raw = (await this.getJson(
      `/repos/${GITHUB_REPO}/releases?per_page=30`,
    )) as unknown;
    if (!Array.isArray(raw)) {
      throw new GithubError('GitHub 返回了无法识别的发布列表', null);
    }
    return (raw as Json[]).map((r) => ({
      tagName: str(r.tag_name) ?? '',
      draft: r.draft === true,
      prerelease: r.prerelease === true,
      body: str(r.body),
      htmlUrl: str(r.html_url) ?? `https://github.com/${GITHUB_REPO}/releases`,
      publishedAt: str(r.published_at),
      assets: Array.isArray(r.assets)
        ? (r.assets as Json[]).map((a) => ({
            name: str(a.name) ?? '',
            size: typeof a.size === 'number' ? a.size : null,
            browserDownloadUrl: str(a.browser_download_url) ?? '',
            digest: str(a.digest),
          }))
        : [],
    }));
  }

  /** ref 可以是分支名、标签名或 sha。 */
  async getCommit(ref: string): Promise<GithubCommit> {
    const raw = await this.getJson(
      `/repos/${GITHUB_REPO}/commits/${encodeURIComponent(ref)}`,
    );
    if (typeof raw.sha !== 'string') {
      throw new GithubError('GitHub 返回了无法识别的提交信息', null);
    }
    return toCommit(raw);
  }

  async compare(base: string, head: string): Promise<GithubCompare> {
    const raw = await this.getJson(
      `/repos/${GITHUB_REPO}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    );
    const status = raw.status;
    if (
      status !== 'identical' &&
      status !== 'ahead' &&
      status !== 'behind' &&
      status !== 'diverged'
    ) {
      throw new GithubError('GitHub 返回了无法识别的比较结果', null);
    }
    return {
      status,
      commits: Array.isArray(raw.commits)
        ? (raw.commits as Json[]).map(toCommit)
        : [],
    };
  }
}

function describeHttpStatus(status: number): string {
  if (status === 403 || status === 429) {
    return `GitHub 拒绝了请求（HTTP ${status}，可能触发了访问频率限制）`;
  }
  return `GitHub 返回 HTTP ${status}`;
}

export function describeNetworkError(error: unknown): string {
  // 不用 instanceof：超时的 DOMException、undici 的错误可能来自另一个运行时域（如 jest 沙箱），按字段判断
  const e = error as {
    name?: unknown;
    message?: unknown;
    cause?: unknown;
  } | null;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return '请求超时';
  const cause = e?.cause as { message?: unknown } | null | undefined;
  if (typeof cause?.message === 'string' && cause.message) return cause.message;
  if (typeof e?.message === 'string' && e.message) return e.message;
  return String(error);
}
