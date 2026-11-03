import { Inject, Injectable } from '@nestjs/common';
import { GithubClient, GithubError, type GithubRelease } from './github-client';
import { readBuildInfo } from './system-files';
import { GITHUB_REPO, SYSTEM_CONFIG, type SystemConfig } from './system.config';
import type {
  BuildInfo,
  DownloadTarget,
  UpdateChannel,
  UpdateCheck,
  UpdateCommit,
} from './system.types';
import {
  compareVersions,
  parseStableTag,
  parseVersion,
  type VersionTuple,
} from './version-compare';

/** 检查结果 + 下载目标（后者含下载地址与校验和，不出现在接口响应里）。 */
export interface CheckOutcome {
  check: UpdateCheck;
  target: DownloadTarget | null;
}

/** 新提交列表最多返回的条数。 */
export const MAX_COMMITS = 50;

const REASON_UP_TO_DATE = '已是最新版本';
const REASON_STABLE_BEHIND_CURRENT =
  '当前提交版比最新稳定版更新，等下一个稳定版发布后再切换';
const REASON_COMMIT_UNKNOWN = '无法确认当前提交，升级后将以 main 最新提交为准';

interface Verdict {
  available: boolean;
  reason: string | null;
  commits: UpdateCommit[];
}

/**
 * 检查更新：把 GitHub 上的最新稳定版 / main 最新提交与当前构建比较，并防止降级
 * （TypeORM synchronize 会删除新实体里不存在的列，降级会丢数据）。
 */
@Injectable()
export class UpdateChecker {
  constructor(
    @Inject(SYSTEM_CONFIG) private readonly config: SystemConfig,
    private readonly github: GithubClient,
  ) {}

  currentBuild(): BuildInfo {
    return readBuildInfo(this.config.root, this.config.serverVersion);
  }

  async evaluate(channel: UpdateChannel): Promise<CheckOutcome> {
    const current = this.currentBuild();
    const base: UpdateCheck = {
      channel,
      current: {
        version: current.version,
        commit: current.commit,
        channel: current.channel,
      },
      latest: null,
      available: false,
      reason: null,
      commits: [],
    };
    try {
      return channel === 'stable'
        ? await this.evaluateStable(base, current)
        : await this.evaluateCommit(base, current);
    } catch (error) {
      if (!(error instanceof GithubError)) throw error;
      return {
        check: {
          ...base,
          reason: `无法连接 GitHub：${error.message}，请检查网络或代理`,
        },
        target: null,
      };
    }
  }

  private platformName(): 'macos' | 'windows' {
    return (
      this.config.launcher ??
      (this.config.platform === 'win32' ? 'windows' : 'macos')
    );
  }

  private async evaluateStable(
    base: UpdateCheck,
    current: BuildInfo,
  ): Promise<CheckOutcome> {
    const best = pickLatestStable(await this.github.listReleases());
    if (!best) {
      return {
        check: { ...base, reason: '尚未发布稳定版' },
        target: null,
      };
    }
    const { release, version } = best;
    const versionName = release.tagName.replace(/^v/, '');
    const platform = this.platformName();
    const assetName = `SES-${versionName}-${platform}.zip`;
    const asset = release.assets.find((a) => a.name === assetName);
    const targetCommit = (await this.github.getCommit(release.tagName)).sha;
    const latest: NonNullable<UpdateCheck['latest']> = {
      version: versionName,
      commit: targetCommit,
      publishedAt: release.publishedAt,
      notes: release.body,
      url: release.htmlUrl,
      assetSize: asset?.size ?? null,
    };
    const verdict = await this.judge('stable', current, targetCommit, version);
    // 已是最新或会降级时直接给出原因；只有确实要升级而缺少安装包时才报缺资产
    if (
      verdict.available &&
      (!asset || !/^https?:\/\//.test(asset.browserDownloadUrl))
    ) {
      return {
        check: {
          ...base,
          latest,
          reason: `最新稳定版 ${release.tagName} 缺少 ${platform} 安装包（${assetName}）`,
        },
        target: null,
      };
    }
    const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset?.digest ?? '');
    return {
      check: { ...base, latest, ...verdict },
      target:
        verdict.available && asset
          ? {
              url: asset.browserDownloadUrl,
              sha256: digest ? digest[1].toLowerCase() : null,
              size: asset.size,
            }
          : null,
    };
  }

  private async evaluateCommit(
    base: UpdateCheck,
    current: BuildInfo,
  ): Promise<CheckOutcome> {
    const head = await this.github.getCommit('main');
    const latest: NonNullable<UpdateCheck['latest']> = {
      version: null,
      commit: head.sha,
      publishedAt: head.date,
      notes: null,
      url: `https://github.com/${GITHUB_REPO}/commit/${head.sha}`,
      assetSize: null,
    };
    const verdict = await this.judge('commit', current, head.sha, null);
    return {
      check: { ...base, latest, ...verdict },
      target: verdict.available
        ? {
            url: `${this.config.codeloadBase}/${GITHUB_REPO}/zip/${head.sha}`,
            sha256: null,
            size: null,
          }
        : null,
    };
  }

  /** 防降级判定。当前提交已知时以 GitHub compare 为准；未知（或 GitHub 不认识该提交）时按通道各自的回退规则。 */
  private async judge(
    channel: UpdateChannel,
    current: BuildInfo,
    targetCommit: string,
    targetVersion: VersionTuple | null,
  ): Promise<Verdict> {
    if (current.commit) {
      if (current.commit === targetCommit.toLowerCase()) {
        return { available: false, reason: REASON_UP_TO_DATE, commits: [] };
      }
      try {
        const compare = await this.github.compare(current.commit, targetCommit);
        switch (compare.status) {
          case 'identical':
            return { available: false, reason: REASON_UP_TO_DATE, commits: [] };
          case 'ahead':
            return {
              available: true,
              reason: null,
              commits: compare.commits
                .slice(-MAX_COMMITS)
                .reverse()
                .map((c) => ({
                  sha: c.sha,
                  message: c.message,
                  date: c.date ?? '',
                  author: c.author,
                })),
            };
          case 'behind':
            return {
              available: false,
              reason:
                channel === 'stable'
                  ? REASON_STABLE_BEHIND_CURRENT
                  : '当前提交比 main 最新提交更新，无法降级',
              commits: [],
            };
          case 'diverged':
            return {
              available: false,
              reason:
                channel === 'stable'
                  ? '当前提交与最新稳定版已分叉，无法安全升级'
                  : '当前提交与 main 最新提交已分叉，无法安全升级',
              commits: [],
            };
        }
      } catch (error) {
        // 404/422：GitHub 不认识当前提交（例如本地未推送的提交），按“当前提交未知”处理
        const unknownToGithub =
          error instanceof GithubError &&
          (error.status === 404 || error.status === 422);
        if (!unknownToGithub) throw error;
      }
    }
    return this.judgeWithoutCommit(channel, current, targetVersion);
  }

  private judgeWithoutCommit(
    channel: UpdateChannel,
    current: BuildInfo,
    targetVersion: VersionTuple | null,
  ): Verdict {
    if (channel === 'commit' || !targetVersion) {
      return { available: true, reason: REASON_COMMIT_UNKNOWN, commits: [] };
    }
    const currentVersion = parseVersion(current.version);
    if (!currentVersion) {
      return {
        available: false,
        reason: `无法识别当前版本号 ${current.version}，无法判断是否需要升级`,
        commits: [],
      };
    }
    const order = compareVersions(currentVersion, targetVersion);
    if (order < 0) return { available: true, reason: null, commits: [] };
    return {
      available: false,
      reason: order === 0 ? REASON_UP_TO_DATE : REASON_STABLE_BEHIND_CURRENT,
      commits: [],
    };
  }
}

/** 取版本最高的稳定版：排除 draft，标签必须严格匹配 v<x.y.z>-preview。 */
export function pickLatestStable(
  releases: GithubRelease[],
): { release: GithubRelease; version: VersionTuple } | null {
  let best: { release: GithubRelease; version: VersionTuple } | null = null;
  for (const release of releases) {
    if (release.draft) continue;
    const version = parseStableTag(release.tagName);
    if (!version) continue;
    if (!best || compareVersions(version, best.version) > 0) {
      best = { release, version };
    }
  }
  return best;
}
