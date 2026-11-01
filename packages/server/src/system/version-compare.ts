/** 稳定版标签：v<x.y.z>-preview。 */
const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)-preview$/;
const PLAIN_VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-preview)?$/;

export type VersionTuple = [number, number, number];

/** 解析稳定版标签（严格匹配 v<x.y.z>-preview），不匹配返回 null。 */
export function parseStableTag(tag: string): VersionTuple | null {
  const m = STABLE_TAG.exec(tag);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** 解析当前版本号：接受 0.1.1、v0.1.1、0.1.2-preview（去掉 -preview 后缀后按 x.y.z 比较）。 */
export function parseVersion(version: string): VersionTuple | null {
  const m = PLAIN_VERSION.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** 比较两个 x.y.z：a 小于 b 返回负数，相等返回 0，大于返回正数。 */
export function compareVersions(a: VersionTuple, b: VersionTuple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}
