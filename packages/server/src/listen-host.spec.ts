import {
  DEFAULT_LISTEN_HOST,
  formatListenUrl,
  LISTEN_HOST_ENV,
  NON_LOOPBACK_WARNING,
  resolveListenAddress,
} from './listen-host';

const resolveWith = (value: string | undefined) =>
  resolveListenAddress(value === undefined ? {} : { [LISTEN_HOST_ENV]: value });

describe('resolveListenAddress：解析监听地址', () => {
  it('变量名是 SES_LISTEN_HOST，不是 HOST（HOST 常被设成机器名）', () => {
    expect(LISTEN_HOST_ENV).toBe('SES_LISTEN_HOST');
    // 只设了 HOST 时不受影响，仍是默认的本机地址。
    expect(resolveListenAddress({ HOST: 'my-laptop.local' })).toEqual({
      host: '127.0.0.1',
      loopback: true,
    });
    expect(resolveListenAddress({ HOST: '0.0.0.0' })).toEqual({
      host: '127.0.0.1',
      loopback: true,
    });
  });

  it('未设置、空串、纯空白：默认 127.0.0.1，是回环', () => {
    for (const value of [undefined, '', ' ', '\t\n ']) {
      expect(resolveWith(value)).toEqual({
        host: DEFAULT_LISTEN_HOST,
        loopback: true,
      });
    }
    expect(DEFAULT_LISTEN_HOST).toBe('127.0.0.1');
  });

  it('默认读取 process.env，每次调用都重新读取', () => {
    const original = process.env[LISTEN_HOST_ENV];
    try {
      delete process.env[LISTEN_HOST_ENV];
      expect(resolveListenAddress().host).toBe('127.0.0.1');
      process.env[LISTEN_HOST_ENV] = '0.0.0.0';
      expect(resolveListenAddress()).toEqual({
        host: '0.0.0.0',
        loopback: false,
      });
    } finally {
      if (original === undefined) delete process.env[LISTEN_HOST_ENV];
      else process.env[LISTEN_HOST_ENV] = original;
    }
  });

  it('去掉首尾空白后使用', () => {
    expect(resolveWith('  0.0.0.0\n')).toEqual({
      host: '0.0.0.0',
      loopback: false,
    });
    expect(resolveWith(' 127.0.0.1 ')).toEqual({
      host: '127.0.0.1',
      loopback: true,
    });
  });

  it.each([
    '127.0.0.1',
    '127.0.0.2',
    '127.255.255.254',
    '::1',
    '0:0:0:0:0:0:0:1',
    '::ffff:127.0.0.1',
    'localhost',
    'LOCALHOST',
  ])('回环：%s', (host) => {
    expect(resolveWith(host)).toEqual({ host, loopback: true });
  });

  it('带方括号的 IPv6 写法去掉括号（listen 不接受括号），仍判断为回环', () => {
    expect(resolveWith('[::1]')).toEqual({ host: '::1', loopback: true });
    expect(resolveWith('[::]')).toEqual({ host: '::', loopback: false });
  });

  it.each([
    '0.0.0.0', // 所有 IPv4 网卡
    '::', // 所有网卡
    '192.168.1.20',
    '10.0.0.5',
    '172.16.0.9',
    '8.8.8.8',
    '126.255.255.255', // 刚好在 127.0.0.0/8 之外
    '128.0.0.1',
    '::ffff:192.168.1.20',
    'fe80::1',
    '2001:db8::1',
    'my-laptop.local', // 主机名：解析结果不确定，按非本机处理
    'localhost.evil.com',
    '127.0.0.1.nip.io',
  ])('非回环：%s', (host) => {
    expect(resolveWith(host)).toEqual({ host, loopback: false });
  });

  it('带区域标识的 IPv6：不抛异常，按地址本身判断', () => {
    expect(resolveWith('fe80::1%lo0')).toEqual({
      host: 'fe80::1%lo0',
      loopback: false,
    });
    expect(resolveWith('::1%lo0').loopback).toBe(true);
  });

  it('只判断 host，不改写：大小写与原样保留', () => {
    expect(resolveWith('My-Host').host).toBe('My-Host');
  });
});

describe('formatListenUrl：启动日志里的地址', () => {
  it('IPv4 与主机名原样，IPv6 加方括号', () => {
    expect(formatListenUrl('127.0.0.1', 3000)).toBe('http://127.0.0.1:3000');
    expect(formatListenUrl('0.0.0.0', '8080')).toBe('http://0.0.0.0:8080');
    expect(formatListenUrl('::1', 3000)).toBe('http://[::1]:3000');
    expect(formatListenUrl('::', 3000)).toBe('http://[::]:3000');
    expect(formatListenUrl('localhost', 3000)).toBe('http://localhost:3000');
  });
});

describe('非回环警告', () => {
  it('说明没有鉴权、局域网内的设备可以读写全部文档', () => {
    expect(NON_LOOPBACK_WARNING).toContain('已监听非本机地址');
    expect(NON_LOOPBACK_WARNING).toContain('REST 接口没有鉴权');
    expect(NON_LOOPBACK_WARNING).toContain('局域网内的设备可以读写全部文档');
  });
});
