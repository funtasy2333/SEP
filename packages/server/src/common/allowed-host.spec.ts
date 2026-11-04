import {
  ALLOWED_HOSTS_ENV,
  isAllowedHost,
  isHostAllowed,
  resolveAllowedHostRules,
} from './allowed-host';

const env = (vars: Record<string, string | undefined> = {}) =>
  vars as NodeJS.ProcessEnv;

describe('isAllowedHost：本机 Host', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'LocalHost:3000',
    'localhost:0',
    'localhost:65535',
    '127.0.0.1',
    '127.0.0.1:3000',
    '[::1]',
    '[::1]:5173',
  ])('%s 放行', (host) => {
    expect(isAllowedHost(host)).toBe(true);
  });

  it.each([
    undefined,
    '',
    ' ',
    'localhost:65536',
    'localhost:999999',
    'localhost:',
    'localhost:abc',
    '127.0.0.1:65536',
    'localhost.evil.com',
    'localhost.evil.com:3000',
    'evil-localhost',
    'evil.com/localhost',
    'localhost@evil.com',
    'evil.com@localhost',
    '127.0.0.1.nip.io',
    '127.0.0.1.nip.io:3000',
    '127.0.0.2',
    '0.0.0.0',
    '::1',
    'attacker.example:3000',
  ])('%p 拒绝', (host) => {
    expect(isAllowedHost(host)).toBe(false);
  });
});

describe('resolveAllowedHostRules：环境变量解析', () => {
  it('没有配置时没有额外规则', () => {
    const rules = resolveAllowedHostRules(env());
    expect(rules.anyPort.size).toBe(0);
    expect(rules.withPort.size).toBe(0);
  });

  it('SES_ALLOWED_HOSTS：逗号分隔、去空白、忽略空项、小写；带端口的项精确匹配端口', () => {
    const rules = resolveAllowedHostRules(
      env({
        [ALLOWED_HOSTS_ENV]: ' 192.168.1.20 ,, My-PC.local:3000 ,  ,[FE80::1] ',
      }),
    );
    expect([...rules.anyPort].sort()).toEqual(['192.168.1.20', '[fe80::1]']);
    expect([...rules.withPort]).toEqual(['my-pc.local:3000']);
  });

  it('忽略格式不合法的项（通配符、带协议或路径、端口越界、未加方括号的 IPv6）', () => {
    const rules = resolveAllowedHostRules(
      env({
        [ALLOWED_HOSTS_ENV]:
          '*,*.evil.com,http://a.com,a.com/x,a.com:65536,a.com:0,fe80::1,a b,[nonsense]',
      }),
    );
    expect(rules.anyPort.size).toBe(0);
    expect(rules.withPort.size).toBe(0);
  });

  it('IPv6 写成压缩形式匹配浏览器发送的 Host', () => {
    const rules = resolveAllowedHostRules(
      env({ [ALLOWED_HOSTS_ENV]: '[FE80:0:0:0:0:0:0:1]:3000' }),
    );
    expect([...rules.withPort]).toEqual(['[fe80::1]:3000']);
  });

  it('SES_LISTEN_HOST 是具体地址时自动加入（任意端口）', () => {
    expect([
      ...resolveAllowedHostRules(env({ SES_LISTEN_HOST: '192.168.1.20' }))
        .anyPort,
    ]).toEqual(['192.168.1.20']);
    expect([
      ...resolveAllowedHostRules(env({ SES_LISTEN_HOST: 'fe80::1' })).anyPort,
    ]).toEqual(['[fe80::1]']);
    expect([
      ...resolveAllowedHostRules(env({ SES_LISTEN_HOST: '[fe80::1]' })).anyPort,
    ]).toEqual(['[fe80::1]']);
  });

  it.each(['0.0.0.0', '::', '[::]', '0:0:0:0:0:0:0:0', '', '  '])(
    'SES_LISTEN_HOST=%p（通配或空）不加入',
    (value) => {
      const rules = resolveAllowedHostRules(env({ SES_LISTEN_HOST: value }));
      expect(rules.anyPort.size).toBe(0);
      expect(rules.withPort.size).toBe(0);
    },
  );
});

describe('isHostAllowed：综合判断', () => {
  it('缺失 Host 拒绝，即使配置了额外 Host', () => {
    expect(isHostAllowed(undefined, env())).toBe(false);
    expect(
      isHostAllowed(undefined, env({ [ALLOWED_HOSTS_ENV]: 'a.com' })),
    ).toBe(false);
  });

  it('没有配置时只放行本机三者', () => {
    expect(isHostAllowed('127.0.0.1:3000', env())).toBe(true);
    expect(isHostAllowed('Localhost', env())).toBe(true);
    expect(isHostAllowed('[::1]:3000', env())).toBe(true);
    expect(isHostAllowed('attacker.example:3000', env())).toBe(false);
    expect(isHostAllowed('192.168.1.20:3000', env())).toBe(false);
    expect(isHostAllowed('localhost:65536', env())).toBe(false);
  });

  it('SES_ALLOWED_HOSTS 的项不带端口：任意端口放行，大小写不敏感', () => {
    const e = env({ [ALLOWED_HOSTS_ENV]: 'My-PC.local, 192.168.1.20' });
    expect(isHostAllowed('my-pc.local', e)).toBe(true);
    expect(isHostAllowed('MY-PC.LOCAL:3000', e)).toBe(true);
    expect(isHostAllowed('192.168.1.20:5173', e)).toBe(true);
    expect(isHostAllowed('192.168.1.20:65536', e)).toBe(false);
  });

  it('SES_ALLOWED_HOSTS 的项带端口：只放行该端口', () => {
    const e = env({ [ALLOWED_HOSTS_ENV]: 'my-pc.local:3000' });
    expect(isHostAllowed('my-pc.local:3000', e)).toBe(true);
    expect(isHostAllowed('my-pc.local:3001', e)).toBe(false);
    expect(isHostAllowed('my-pc.local', e)).toBe(false);
  });

  it('精确匹配：不做子串或后缀匹配', () => {
    const e = env({ [ALLOWED_HOSTS_ENV]: 'my-pc.local,192.168.1.20' });
    for (const host of [
      'my-pc.local.evil.com',
      'evil-my-pc.local',
      'evil.com.my-pc.local',
      'x.my-pc.local',
      '192.168.1.20.nip.io',
      '192.168.1.200',
      '192.168.1.2',
    ]) {
      expect(isHostAllowed(host, e)).toBe(false);
    }
  });

  it('IPv6 配置项匹配浏览器发送的 Host', () => {
    const e = env({ [ALLOWED_HOSTS_ENV]: '[fd00::5]' });
    expect(isHostAllowed('[fd00::5]:3000', e)).toBe(true);
    expect(isHostAllowed('[FD00::5]', e)).toBe(true);
    expect(isHostAllowed('[fd00::6]:3000', e)).toBe(false);
  });

  it('SES_LISTEN_HOST 为具体地址时自动放行该地址，通配地址不放行任何额外 Host', () => {
    const lan = env({ SES_LISTEN_HOST: '192.168.1.20' });
    expect(isHostAllowed('192.168.1.20:3000', lan)).toBe(true);
    expect(isHostAllowed('192.168.1.21:3000', lan)).toBe(false);
    expect(isHostAllowed('127.0.0.1:3000', lan)).toBe(true);

    const wildcard = env({ SES_LISTEN_HOST: '0.0.0.0' });
    expect(isHostAllowed('0.0.0.0:3000', wildcard)).toBe(false);
    expect(isHostAllowed('192.168.1.20:3000', wildcard)).toBe(false);
    expect(isHostAllowed('localhost:3000', wildcard)).toBe(true);
  });

  it('格式不合法的 Host 一律拒绝', () => {
    const e = env({ [ALLOWED_HOSTS_ENV]: 'a.com' });
    for (const host of [
      '',
      'a.com/',
      'a.com:abc',
      'a.com:',
      'a.com@b.com',
      'a b',
    ]) {
      expect(isHostAllowed(host, e)).toBe(false);
    }
  });
});
