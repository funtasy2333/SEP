import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MAX_CLIENT_LENGTH } from '../version/version.service';
import { FALLBACK_CLIENT_NAME, normalizeClientName } from './mcp-client-name';
import {
  errorResult,
  INTERNAL_ERROR_MESSAGE,
  jsonResult,
  REREAD_HINT,
  toErrorBody,
} from './mcp-errors';
import {
  assertOnlyKeys,
  optionalEnum,
  optionalNonEmptyString,
  optionalString,
  parseDocumentId,
  requiredEnum,
  requiredNonEmptyString,
} from './mcp-tool-args';

describe('normalizeClientName', () => {
  it('普通名称原样返回', () => {
    expect(normalizeClientName('claude-code')).toBe('claude-code');
    expect(normalizeClientName('Claude Desktop 工具')).toBe(
      'Claude Desktop 工具',
    );
  });

  it('去掉首尾空白', () => {
    expect(normalizeClientName('  claude-code \t')).toBe('claude-code');
  });

  it('去掉控制字符（换行、制表、响铃、DEL、C1、NUL）', () => {
    expect(normalizeClientName('a\nb\tc\u0007d\u007fe\u0085f\u0000g')).toBe(
      'abcdefg',
    );
    expect(normalizeClientName('line1\r\nline2')).toBe('line1line2');
  });

  it('去掉零宽字符、双向文字覆盖符与行/段分隔符（防止伪造版本面板里的显示）', () => {
    expect(normalizeClientName('ev​il‮gnp.exe  ')).toBe('evilgnp.exe');
  });

  it('只含控制字符或空白、或不是字符串时用 mcp', () => {
    expect(FALLBACK_CLIENT_NAME).toBe('mcp');
    for (const name of [
      '',
      '   ',
      '\n\t',
      '\u0007\u0000',
      undefined,
      null,
      42,
    ]) {
      expect(normalizeClientName(name)).toBe('mcp');
    }
  });

  it(`超长截断到 ${MAX_CLIENT_LENGTH} 个字符`, () => {
    const long = normalizeClientName('x'.repeat(MAX_CLIENT_LENGTH + 100));
    expect(long).toBe('x'.repeat(MAX_CLIENT_LENGTH));
    expect(normalizeClientName('x'.repeat(MAX_CLIENT_LENGTH))).toHaveLength(
      MAX_CLIENT_LENGTH,
    );
    expect(normalizeClientName('甲'.repeat(1000))).toHaveLength(
      MAX_CLIENT_LENGTH,
    );
  });

  it('截断不会把代理对（如 emoji）切成两半，长度不超过上限', () => {
    // 每个 emoji 占 2 个 UTF-16 单元；199 个单元之后再来一个 emoji 会超出，应整体舍弃。
    const name = `${'a'.repeat(MAX_CLIENT_LENGTH - 1)}😀😀😀`;
    const result = normalizeClientName(name);
    expect(result).toBe('a'.repeat(MAX_CLIENT_LENGTH - 1));
    expect(result.length).toBeLessThanOrEqual(MAX_CLIENT_LENGTH);

    const emojis = normalizeClientName('😀'.repeat(300));
    expect(emojis).toBe('😀'.repeat(MAX_CLIENT_LENGTH / 2));
    // 没有落单的代理项
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(emojis)).toBe(false);
  });

  it('截断后末尾的空白也去掉', () => {
    const name = `${'a'.repeat(MAX_CLIENT_LENGTH - 1)} b`;
    expect(normalizeClientName(name)).toBe('a'.repeat(MAX_CLIENT_LENGTH - 1));
  });
});

describe('toErrorBody', () => {
  it('404：保留状态码与 code', () => {
    const body = toErrorBody(
      new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: '文档里没有节点 x',
        code: 'node-not-found',
      }),
    );
    expect(body).toEqual({
      status: 404,
      code: 'node-not-found',
      message: '文档里没有节点 x',
    });
  });

  it('404（Nest 默认形式，无 code）', () => {
    expect(toErrorBody(new NotFoundException('Document #9 not found'))).toEqual(
      { status: 404, message: 'Document #9 not found' },
    );
  });

  it('409：带当前 revision，消息提示重新读取', () => {
    const body = toErrorBody(
      new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: '文档已被修改',
        revision: 7,
      }),
    );
    expect(body).toEqual({
      status: 409,
      message: `文档已被修改；${REREAD_HINT}`,
      revision: 7,
    });
    expect(REREAD_HINT).toBe('请重新读取后再修改');
  });

  it('422：带 issues 与 problems', () => {
    const issues = [{ code: 'node-not-found', path: 'operations[0].nodeId' }];
    const problems = [{ source: 'schema', code: 'invalid-content' }];
    const body = toErrorBody(
      new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: '操作未通过检查',
        issues,
        problems,
        source: 'schema',
        detail: '不进入工具错误正文',
      }),
    );
    expect(body).toEqual({
      status: 422,
      message: '操作未通过检查',
      issues,
      problems,
    });
  });

  it('400：issues 保留，字符串消息与消息数组都能取到', () => {
    expect(
      toErrorBody(
        new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message: 'operations 不合法',
          issues: [{ code: 'missing-field' }],
        }),
      ),
    ).toEqual({
      status: 400,
      message: 'operations 不合法',
      issues: [{ code: 'missing-field' }],
    });
    expect(toErrorBody(new BadRequestException('参数错误')).message).toBe(
      '参数错误',
    );
    expect(
      toErrorBody(new BadRequestException({ message: ['甲', '乙'] })).message,
    ).toBe('甲；乙');
  });

  it('428 等其他 4xx 同样保留状态码', () => {
    const body = toErrorBody(new HttpException('必须提供 baseRevision', 428));
    expect(body).toEqual({ status: 428, message: '必须提供 baseRevision' });
  });

  it('非 HttpException 与 5xx：通用消息，不含异常内容', () => {
    for (const error of [
      new Error('SQLITE_ERROR: no such table: documents at /srv/ses/data.db'),
      new TypeError('x is not a function'),
      'a string',
      undefined,
      new InternalServerErrorException('带内部细节的 500'),
      new HttpException('网关错误 /etc/passwd', 502),
    ]) {
      const body = toErrorBody(error);
      expect(body).toEqual({ status: 500, message: INTERNAL_ERROR_MESSAGE });
      expect(JSON.stringify(body)).not.toMatch(/SQLITE|passwd|内部细节|srv/);
    }
    expect(INTERNAL_ERROR_MESSAGE).toBe('服务端内部错误');
  });

  it('jsonResult / errorResult：内容是 JSON 文本，成功时同时给 structuredContent', () => {
    const ok = jsonResult({ revision: 3, list: [1, 2] });
    expect(ok.isError).toBeUndefined();
    expect(JSON.parse((ok.content[0] as { text: string }).text)).toEqual({
      revision: 3,
      list: [1, 2],
    });
    expect(ok.structuredContent).toEqual({ revision: 3, list: [1, 2] });

    const failed = errorResult({ status: 404, message: '没有' });
    expect(failed.isError).toBe(true);
    expect(JSON.parse((failed.content[0] as { text: string }).text)).toEqual({
      status: 404,
      message: '没有',
    });
  });
});

describe('工具参数解析', () => {
  const messageOf = (run: () => unknown): string => {
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      return (error as BadRequestException).message;
    }
    throw new Error('应当抛出 400');
  };

  it('assertOnlyKeys：未知参数 400，列出支持的参数；值为 undefined 的键不算', () => {
    expect(() => assertOnlyKeys({ a: 1 }, ['a', 'b'])).not.toThrow();
    expect(() => assertOnlyKeys({ a: 1, c: undefined }, ['a'])).not.toThrow();
    const message = messageOf(() =>
      assertOnlyKeys({ node_id: 'x' }, ['nodeId']),
    );
    expect(message).toContain('node_id');
    expect(message).toContain('nodeId');
  });

  it('assertOnlyKeys：回显的未知参数名被截断', () => {
    const message = messageOf(() =>
      assertOnlyKeys({ ['k'.repeat(500)]: 1 }, []),
    );
    expect(message.length).toBeLessThan(200);
  });

  it('parseDocumentId：只接受正整数', () => {
    expect(parseDocumentId(1)).toBe(1);
    expect(parseDocumentId(42)).toBe(42);
    expect(messageOf(() => parseDocumentId(undefined))).toContain('documentId');
    for (const bad of [
      0,
      -1,
      1.5,
      '3',
      null,
      NaN,
      Infinity,
      2 ** 60,
      [1],
      {},
    ]) {
      expect(messageOf(() => parseDocumentId(bad))).toContain('正整数');
    }
  });

  it('字符串参数：类型与空串检查', () => {
    expect(optionalString({}, 'k')).toBeUndefined();
    expect(optionalString({ k: '' }, 'k')).toBe('');
    expect(messageOf(() => optionalString({ k: 1 }, 'k'))).toContain('字符串');

    expect(optionalNonEmptyString({}, 'k', '说明')).toBeUndefined();
    expect(optionalNonEmptyString({ k: 'v' }, 'k', '说明')).toBe('v');
    for (const bad of ['', '   ', 1, null, {}]) {
      expect(
        messageOf(() => optionalNonEmptyString({ k: bad }, 'k', '说明')),
      ).toContain('非空字符串');
    }
    expect(messageOf(() => requiredNonEmptyString({}, 'k', '说明'))).toContain(
      '缺少参数「k」',
    );
    expect(requiredNonEmptyString({ k: ' 题 ' }, 'k', '说明')).toBe(' 题 ');
  });

  it('枚举参数', () => {
    const allowed = ['a', 'b'] as const;
    expect(requiredEnum({ k: 'a' }, 'k', allowed)).toBe('a');
    expect(optionalEnum({}, 'k', allowed)).toBeUndefined();
    expect(optionalEnum({ k: 'b' }, 'k', allowed)).toBe('b');
    expect(messageOf(() => requiredEnum({}, 'k', allowed))).toContain(
      '缺少参数',
    );
    for (const bad of ['c', '', 1, null]) {
      expect(messageOf(() => requiredEnum({ k: bad }, 'k', allowed))).toContain(
        'a / b',
      );
      expect(messageOf(() => optionalEnum({ k: bad }, 'k', allowed))).toContain(
        'a / b',
      );
    }
  });
});
