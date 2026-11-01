import {
  compareVersions,
  parseStableTag,
  parseVersion,
} from './version-compare';

describe('parseStableTag：稳定版标签', () => {
  it('只接受 v<x.y.z>-preview', () => {
    expect(parseStableTag('v0.1.2-preview')).toEqual([0, 1, 2]);
    expect(parseStableTag('v10.20.30-preview')).toEqual([10, 20, 30]);
  });

  it.each([
    'v0.1.2',
    '0.1.2-preview',
    'v0.1.2-preview.1',
    'v0.1-preview',
    'v0.1.2-rc1',
    'nightly',
    '',
    'xv0.1.2-preview',
    'v0.1.2-preview ',
  ])('拒绝 %j', (tag) => {
    expect(parseStableTag(tag)).toBeNull();
  });
});

describe('parseVersion：当前版本号', () => {
  it('接受 x.y.z、v 前缀与 -preview 后缀', () => {
    expect(parseVersion('0.1.1')).toEqual([0, 1, 1]);
    expect(parseVersion('v0.1.2')).toEqual([0, 1, 2]);
    expect(parseVersion('0.1.2-preview')).toEqual([0, 1, 2]);
  });

  it('无法识别时返回 null', () => {
    expect(parseVersion('abc')).toBeNull();
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('1.2.3-beta')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('逐段按数值比较（不是字符串比较）', () => {
    expect(compareVersions([0, 1, 1], [0, 1, 2])).toBeLessThan(0);
    expect(compareVersions([0, 1, 2], [0, 1, 2])).toBe(0);
    expect(compareVersions([0, 2, 0], [0, 1, 9])).toBeGreaterThan(0);
    expect(compareVersions([0, 1, 10], [0, 1, 9])).toBeGreaterThan(0);
    expect(compareVersions([1, 0, 0], [0, 99, 99])).toBeGreaterThan(0);
  });
});
