/** /api/system 模块对外的数据结构，字段与前端、升级脚本共享，改动前先同步约定。 */

/** 启动脚本通过 SES_LAUNCHER 告知的托管方式；没有该变量即开发模式。 */
export type Launcher = 'macos' | 'windows';

/** 升级通道：stable = GitHub Release 稳定版，commit = main 分支最新提交。 */
export type UpdateChannel = 'stable' | 'commit';

export interface BuildInfo {
  version: string;
  channel: UpdateChannel | null;
  commit: string | null;
}

export type UpgradeState = 'running' | 'succeeded' | 'rolled-back' | 'failed';

/** 升级执行器写入 .ses-run/upgrade-status.json 的状态。 */
export interface UpgradeStatusFile {
  state: UpgradeState;
  step: string | null;
  from: string | null;
  to: string | null;
  message: string | null;
  log: string | null;
  updatedAt: string | null;
}

export type DownloadPhase =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'handing-off'
  | 'handed-off'
  | 'error';

export interface DownloadStatus {
  phase: DownloadPhase;
  receivedBytes: number;
  totalBytes: number | null;
  error: string | null;
  startedAt: string | null;
}

export interface SystemInfo {
  version: string;
  channel: UpdateChannel | null;
  commit: string | null;
  launcher: Launcher | null;
  canShutdown: boolean;
  shutdownBlockedReason: string | null;
  canUpgrade: boolean;
  upgradeBlockedReason: string | null;
  upgrade: { download: DownloadStatus; last: UpgradeStatusFile | null };
}

export interface UpdateCommit {
  sha: string;
  message: string;
  date: string;
  author: string | null;
}

export interface UpdateCheck {
  channel: UpdateChannel;
  current: {
    version: string;
    commit: string | null;
    channel: UpdateChannel | null;
  };
  latest: {
    version: string | null;
    commit: string;
    publishedAt: string | null;
    notes: string | null;
    url: string;
    assetSize: number | null;
  } | null;
  available: boolean;
  reason: string | null;
  commits: UpdateCommit[];
}

/** 下载目标：只在服务端内部使用，不出现在接口响应里。 */
export interface DownloadTarget {
  url: string;
  /** 小写十六进制 sha256；没有校验和时为 null。 */
  sha256: string | null;
  /** 已知的文件大小（字节），用于校验完整性与进度。 */
  size: number | null;
}

/** 升级交接文件 .ses-update/plan.json，由升级执行器读取。 */
export interface UpgradePlan {
  zip: string;
  channel: UpdateChannel;
  targetVersion: string | null;
  targetCommit: string | null;
  fromVersion: string;
  fromCommit: string | null;
  node: string;
  platform: Launcher;
  requestedAt: string;
}
