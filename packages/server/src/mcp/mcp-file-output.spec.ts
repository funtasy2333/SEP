import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  FILE_WRITE_ENV,
  isFileWriteEnabled,
  nodeOutputFs,
  OutputFileException,
  prepareOutputTarget,
  toOutputFileException,
  writeOutputFile,
  type OutputFileHandle,
  type OutputFs,
} from './mcp-file-output';

/** 符号链接与「文件覆盖目录」的行为随平台而异（Windows 创建符号链接需要权限），相关用例只在 POSIX 上运行。 */
const itPosix = process.platform === 'win32' ? it.skip : it;

const BYTES = Buffer.from('新内容-NEW', 'utf8');

/** 期望异步函数以 {@link OutputFileException} 失败，返回它以便检查状态码与 code。 */
async function failure(
  run: () => Promise<unknown>,
): Promise<OutputFileException> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(OutputFileException);
    return error as OutputFileException;
  }
  throw new Error('应当失败');
}

const codeOf = (error: OutputFileException) => ({
  status: error.getStatus(),
  code: error.code,
});

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: 内部细节 /secret/path`), { code });
}

describe('isFileWriteEnabled：环境变量 SES_MCP_ALLOW_FILE_WRITE', () => {
  it('缺省、空串、空白、1、true 等：允许', () => {
    for (const value of [undefined, '', '  ', '1', 'true', 'TRUE', 'yes']) {
      expect(isFileWriteEnabled({ [FILE_WRITE_ENV]: value })).toBe(true);
    }
  });

  it('0 与 false（大小写不敏感，忽略首尾空白）：禁用', () => {
    for (const value of ['0', 'false', 'FALSE', 'False', ' false ', ' 0\n']) {
      expect(isFileWriteEnabled({ [FILE_WRITE_ENV]: value })).toBe(false);
    }
  });

  it('默认读取 process.env，每次调用都重新读取', () => {
    const original = process.env[FILE_WRITE_ENV];
    try {
      process.env[FILE_WRITE_ENV] = '0';
      expect(isFileWriteEnabled()).toBe(false);
      process.env[FILE_WRITE_ENV] = '1';
      expect(isFileWriteEnabled()).toBe(true);
    } finally {
      if (original === undefined) delete process.env[FILE_WRITE_ENV];
      else process.env[FILE_WRITE_ENV] = original;
    }
  });
});

describe('outputPath 的写入', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ses-file-output-'));
    delete process.env[FILE_WRITE_ENV];
  });
  afterEach(async () => {
    delete process.env[FILE_WRITE_ENV];
    await rm(dir, { recursive: true, force: true });
  });

  const names = () => readdir(dir).then((list) => list.sort());

  // ---------------------------------------------------------------------------
  describe('prepareOutputTarget：入口检查', () => {
    it('合法路径：返回规范化后的绝对路径', async () => {
      expect(
        await prepareOutputTarget(join(dir, 'a.docx'), 'docx', false),
      ).toBe(join(dir, 'a.docx'));
      // 消除 . 与 ..
      const messy = `${dir}/sub/../b.pdf`;
      await mkdir(join(dir, 'sub'));
      expect(await prepareOutputTarget(messy, 'pdf', false)).toBe(
        join(dir, 'b.pdf'),
      );
    });

    it('相对路径 → 400 invalid-output-path，包括 ./x、../x、仅文件名', async () => {
      for (const path of ['a.docx', './a.docx', '../a.docx', 'sub/a.docx']) {
        const error = await failure(() =>
          prepareOutputTarget(path, 'docx', false),
        );
        expect(codeOf(error)).toEqual({
          status: 400,
          code: 'invalid-output-path',
        });
        expect(error.message).toContain('绝对路径');
      }
    });

    it('路径含空字符 → 400', async () => {
      const error = await failure(() =>
        prepareOutputTarget(`${dir}/a\0.docx`, 'docx', false),
      );
      expect(codeOf(error)).toEqual({
        status: 400,
        code: 'invalid-output-path',
      });
    });

    it('扩展名与格式不符（含没有扩展名、以点开头的文件名）→ 400 invalid-output-extension', async () => {
      const cases: Array<[string, 'docx' | 'pdf' | 'html' | 'json']> = [
        ['a.pdf', 'docx'],
        ['a.docx', 'pdf'],
        ['a.htm', 'html'],
        ['a.json', 'html'],
        ['a', 'json'],
        ['a.docx.txt', 'docx'],
        ['.docx', 'docx'],
        ['a.docx.', 'docx'],
      ];
      for (const [name, format] of cases) {
        const error = await failure(() =>
          prepareOutputTarget(join(dir, name), format, false),
        );
        expect(codeOf(error)).toEqual({
          status: 400,
          code: 'invalid-output-extension',
        });
        expect(error.message).toContain(`.${format}`);
      }
    });

    it('扩展名大小写不敏感', async () => {
      for (const [name, format] of [
        ['a.DOCX', 'docx'],
        ['a.Pdf', 'pdf'],
        ['a.HTML', 'html'],
        ['a.JSON', 'json'],
      ] as const) {
        await expect(
          prepareOutputTarget(join(dir, name), format, false),
        ).resolves.toBe(join(dir, name));
      }
    });

    it('父目录不存在 → 400 parent-not-found，不会创建它', async () => {
      const error = await failure(() =>
        prepareOutputTarget(join(dir, 'missing', 'a.docx'), 'docx', false),
      );
      expect(codeOf(error)).toEqual({
        status: 400,
        code: 'parent-not-found',
      });
      expect(error.message).toContain(join(dir, 'missing'));
      expect(await names()).toEqual([]);
    });

    it('父路径是文件 → 400 parent-not-directory（父路径本身是文件，或再上一级是文件）', async () => {
      await writeFile(join(dir, 'file'), 'x');
      for (const path of [
        join(dir, 'file', 'a.docx'),
        join(dir, 'file', 'deeper', 'a.docx'),
      ]) {
        const error = await failure(() =>
          prepareOutputTarget(path, 'docx', false),
        );
        expect(codeOf(error)).toEqual({
          status: 400,
          code: 'parent-not-directory',
        });
      }
    });

    it('目标已存在且不覆盖 → 409 file-exists，消息含路径与 overwrite 提示；覆盖时通过', async () => {
      const target = join(dir, 'a.docx');
      await writeFile(target, 'old');
      const error = await failure(() =>
        prepareOutputTarget(target, 'docx', false),
      );
      expect(codeOf(error)).toEqual({ status: 409, code: 'file-exists' });
      expect(error.message).toContain(target);
      expect(error.message).toContain('overwrite');
      await expect(prepareOutputTarget(target, 'docx', true)).resolves.toBe(
        target,
      );
      expect(await readFile(target, 'utf8')).toBe('old');
    });

    it('目标是目录：不覆盖 → 409（已存在）', async () => {
      await mkdir(join(dir, 'a.docx'));
      const error = await failure(() =>
        prepareOutputTarget(join(dir, 'a.docx'), 'docx', false),
      );
      expect(codeOf(error)).toEqual({ status: 409, code: 'file-exists' });
    });

    itPosix('父目录可以是指向目录的符号链接', async () => {
      await mkdir(join(dir, 'real'));
      await symlink(join(dir, 'real'), join(dir, 'link'));
      await expect(
        prepareOutputTarget(join(dir, 'link', 'a.json'), 'json', false),
      ).resolves.toBe(join(dir, 'link', 'a.json'));
    });

    it('开关关闭 → 403 file-write-disabled，先于其他检查（相对路径、不存在的目录也是 403）', async () => {
      for (const value of ['0', 'false', 'FALSE']) {
        process.env[FILE_WRITE_ENV] = value;
        for (const path of [
          join(dir, 'a.docx'),
          'relative.docx',
          join(dir, 'missing', 'a.docx'),
          join(dir, 'a.txt'),
        ]) {
          const error = await failure(() =>
            prepareOutputTarget(path, 'docx', false),
          );
          expect(codeOf(error)).toEqual({
            status: 403,
            code: 'file-write-disabled',
          });
          expect(error.message).toContain(FILE_WRITE_ENV);
        }
      }
      expect(await names()).toEqual([]);
    });

    it('开关关闭时不触碰文件系统', async () => {
      process.env[FILE_WRITE_ENV] = '0';
      const touched = jest.fn(() => Promise.reject(new Error('不应被调用')));
      const fs: OutputFs = {
        stat: touched,
        lstat: touched,
        open: touched,
        rename: touched,
        unlink: touched,
      };
      await failure(() =>
        prepareOutputTarget(join(dir, 'a.docx'), 'docx', false, fs),
      );
      expect(touched).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  describe('writeOutputFile：不覆盖（O_EXCL）', () => {
    it('创建新文件，内容逐字节相同，不留任何其他文件', async () => {
      const target = join(dir, 'a.docx');
      await writeOutputFile(target, BYTES, false);
      expect((await readFile(target)).equals(BYTES)).toBe(true);
      expect(await names()).toEqual(['a.docx']);
    });

    it('目标已存在 → 409 file-exists，原文件不变，不留临时文件', async () => {
      const target = join(dir, 'a.docx');
      await writeFile(target, '原内容');
      const error = await failure(() => writeOutputFile(target, BYTES, false));
      expect(codeOf(error)).toEqual({ status: 409, code: 'file-exists' });
      expect(await readFile(target, 'utf8')).toBe('原内容');
      expect(await names()).toEqual(['a.docx']);
    });

    itPosix('目标是指向别处的符号链接 → 409，不写穿到链接目标', async () => {
      const real = join(dir, 'real.docx');
      const link = join(dir, 'link.docx');
      await writeFile(real, '链接目标的原内容');
      await symlink(real, link);
      const error = await failure(() => writeOutputFile(link, BYTES, false));
      expect(codeOf(error)).toEqual({ status: 409, code: 'file-exists' });
      expect(await readFile(real, 'utf8')).toBe('链接目标的原内容');
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
      expect(await names()).toEqual(['link.docx', 'real.docx']);
    });

    itPosix(
      '目标是已失效的符号链接 → 409，链接指向的位置不会被创建',
      async () => {
        const dangling = join(dir, 'gone.docx');
        const link = join(dir, 'link.docx');
        await symlink(dangling, link);
        const error = await failure(() => writeOutputFile(link, BYTES, false));
        expect(codeOf(error)).toEqual({ status: 409, code: 'file-exists' });
        await expect(lstat(dangling)).rejects.toThrow();
        expect(await readlink(link)).toBe(dangling);
      },
    );

    it('并发写同一目标：恰好一个成功，另一个 409，成功者的内容完整', async () => {
      const target = join(dir, 'race.docx');
      const a = Buffer.alloc(256 * 1024, 'a');
      const b = Buffer.alloc(256 * 1024, 'b');
      const results = await Promise.allSettled([
        writeOutputFile(target, a, false),
        writeOutputFile(target, b, false),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      )!;
      expect(codeOf(rejected.reason as OutputFileException)).toEqual({
        status: 409,
        code: 'file-exists',
      });
      const content = await readFile(target);
      expect(content.equals(a) || content.equals(b)).toBe(true);
      expect(await names()).toEqual(['race.docx']);
    });

    it('写入中途失败：删除刚创建的半成品，错误映射为 4xx', async () => {
      const target = join(dir, 'a.docx');
      const error = await failure(() =>
        writeOutputFile(
          target,
          BYTES,
          false,
          failingHandleFs({ writeFile: 'ENOSPC' }),
        ),
      );
      expect(codeOf(error)).toEqual({ status: 422, code: 'file-write-failed' });
      expect(error.message).toContain('ENOSPC');
      expect(await names()).toEqual([]);
    });

    it('落盘（fsync）或关闭失败同样清理', async () => {
      for (const step of ['sync', 'close'] as const) {
        await failure(() =>
          writeOutputFile(
            join(dir, 'a.docx'),
            BYTES,
            false,
            failingHandleFs({ [step]: 'EIO' }),
          ),
        );
        expect(await names()).toEqual([]);
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('writeOutputFile：覆盖（临时文件 + rename）', () => {
    it('目标不存在时同样创建', async () => {
      const target = join(dir, 'a.json');
      await writeOutputFile(target, BYTES, true);
      expect((await readFile(target)).equals(BYTES)).toBe(true);
      expect(await names()).toEqual(['a.json']);
    });

    it('替换已有文件，成功后没有临时文件', async () => {
      const target = join(dir, 'a.html');
      await writeFile(target, '旧内容');
      await writeOutputFile(target, BYTES, true);
      expect((await readFile(target)).equals(BYTES)).toBe(true);
      expect(await names()).toEqual(['a.html']);
    });

    it('临时文件在目标的同一目录（rename 不跨文件系统），名字固定长度、以点开头', async () => {
      const target = join(dir, `${'长'.repeat(80)}.docx`);
      const renames: Array<[string, string]> = [];
      const fs: OutputFs = {
        ...nodeOutputFs,
        rename: (from, to) => {
          renames.push([from, to]);
          return nodeOutputFs.rename(from, to);
        },
      };
      await writeOutputFile(target, BYTES, true, fs);
      expect(renames).toHaveLength(1);
      const [from, to] = renames[0];
      expect(to).toBe(target);
      expect(dirname(from)).toBe(dir);
      expect(from).toMatch(/\.ses-export-[0-9a-f]{16}\.tmp$/);
      expect(await readFile(target, 'utf8')).toBe('新内容-NEW');
    });

    itPosix(
      '目标是符号链接：替换的是链接本身，链接指向的文件内容不变',
      async () => {
        const real = join(dir, 'real.docx');
        const link = join(dir, 'link.docx');
        await writeFile(real, '链接目标的原内容');
        await symlink(real, link);

        await writeOutputFile(link, BYTES, true);

        expect((await lstat(link)).isSymbolicLink()).toBe(false);
        expect((await readFile(link)).equals(BYTES)).toBe(true);
        expect(await readFile(real, 'utf8')).toBe('链接目标的原内容');
        expect(await names()).toEqual(['link.docx', 'real.docx']);
      },
    );

    itPosix(
      '目标是已失效的符号链接：同样只替换链接，不创建链接指向的位置',
      async () => {
        const dangling = join(dir, 'gone.docx');
        const link = join(dir, 'link.docx');
        await symlink(dangling, link);
        await writeOutputFile(link, BYTES, true);
        expect((await readFile(link)).equals(BYTES)).toBe(true);
        await expect(lstat(dangling)).rejects.toThrow();
      },
    );

    itPosix(
      '目标是目录：rename 失败 → 400 path-is-directory，目录与其内容不变，临时文件被清理',
      async () => {
        const target = join(dir, 'a.docx');
        await mkdir(target);
        await writeFile(join(target, 'inner.txt'), 'x');
        const error = await failure(() => writeOutputFile(target, BYTES, true));
        expect(codeOf(error)).toEqual({
          status: 400,
          code: 'path-is-directory',
        });
        expect((await stat(target)).isDirectory()).toBe(true);
        expect(await readdir(target)).toEqual(['inner.txt']);
        expect(await names()).toEqual(['a.docx']);
      },
    );

    it('rename 失败：删除临时文件，原文件不变', async () => {
      const target = join(dir, 'a.pdf');
      await writeFile(target, '旧内容');
      const fs: OutputFs = {
        ...nodeOutputFs,
        rename: () => Promise.reject(errno('EACCES')),
      };
      const error = await failure(() =>
        writeOutputFile(target, BYTES, true, fs),
      );
      expect(codeOf(error)).toEqual({ status: 403, code: 'file-write-denied' });
      expect(await readFile(target, 'utf8')).toBe('旧内容');
      expect(await names()).toEqual(['a.pdf']);
    });

    it('写临时文件中途失败：删除临时文件，原文件不变', async () => {
      const target = join(dir, 'a.pdf');
      await writeFile(target, '旧内容');
      await failure(() =>
        writeOutputFile(
          target,
          BYTES,
          true,
          failingHandleFs({ writeFile: 'ENOSPC' }),
        ),
      );
      expect(await readFile(target, 'utf8')).toBe('旧内容');
      expect(await names()).toEqual(['a.pdf']);
    });

    it('创建临时文件失败（目录不可写）：没有临时文件，目标不变', async () => {
      const target = join(dir, 'a.pdf');
      await writeFile(target, '旧内容');
      const fs: OutputFs = {
        ...nodeOutputFs,
        open: () => Promise.reject(errno('EACCES')),
      };
      const error = await failure(() =>
        writeOutputFile(target, BYTES, true, fs),
      );
      expect(codeOf(error)).toEqual({ status: 403, code: 'file-write-denied' });
      expect(await names()).toEqual(['a.pdf']);
    });
  });

  // ---------------------------------------------------------------------------
  describe('错误映射：errno → 4xx 与 code', () => {
    const path = '/work/out/报告.docx';
    const cases: Array<[string, number, string]> = [
      ['EEXIST', 409, 'file-exists'],
      ['EISDIR', 400, 'path-is-directory'],
      ['ENOENT', 400, 'parent-not-found'],
      ['ENOTDIR', 400, 'parent-not-directory'],
      ['EACCES', 403, 'file-write-denied'],
      ['EPERM', 403, 'file-write-denied'],
      ['EROFS', 403, 'file-write-denied'],
      ['ENAMETOOLONG', 400, 'invalid-output-path'],
      ['ELOOP', 400, 'invalid-output-path'],
      ['ENOSPC', 422, 'file-write-failed'],
      ['EDQUOT', 422, 'file-write-failed'],
      ['EIO', 422, 'file-write-failed'],
    ];

    it.each(cases)('%s → %i %s', (code, status, expectedCode) => {
      const mapped = toOutputFileException(errno(code), path);
      expect(codeOf(mapped)).toEqual({ status, code: expectedCode });
      // 消息可以含路径（返回给调用方本人），但不是原始异常消息（那里有内部细节）。
      expect(mapped.message).not.toContain('内部细节');
      expect(mapped.message).not.toContain('/secret/path');
      // 响应体与其他 4xx 同形：toErrorBody 取 code 与 message。
      expect(mapped.getResponse()).toMatchObject({
        statusCode: status,
        code: expectedCode,
        message: mapped.message,
      });
    });

    it('消息含路径（返回给调用方），非 errno 的异常归入 422 file-write-failed', () => {
      expect(toOutputFileException(errno('EACCES'), path).message).toContain(
        path,
      );
      const unknown = toOutputFileException(new Error('boom'), path);
      expect(codeOf(unknown)).toEqual({
        status: 422,
        code: 'file-write-failed',
      });
      expect(unknown.message).toContain('未知错误');
      expect(unknown.message).not.toContain('boom');
    });

    it('已经是 OutputFileException 的原样返回', () => {
      const original = new OutputFileException(409, 'file-exists', '已存在');
      expect(toOutputFileException(original, path)).toBe(original);
    });
  });

  // ---------------------------------------------------------------------------
  it('规范化后的路径就是实际写入的位置', async () => {
    await mkdir(join(dir, 'sub'));
    const target = await prepareOutputTarget(
      `${dir}/sub/../out.json`,
      'json',
      false,
    );
    await writeOutputFile(target, BYTES, false);
    expect(target).toBe(resolve(dir, 'out.json'));
    expect(await names()).toEqual(['out.json', 'sub']);
  });
});

/** 在真实文件系统上包一层：指定的句柄操作以给定 errno 失败（其余照常，使失败发生在文件已创建之后）。 */
function failingHandleFs(
  failing: Partial<Record<'writeFile' | 'sync' | 'close', string>>,
): OutputFs {
  return {
    ...nodeOutputFs,
    async open(path, flags) {
      const handle = await nodeOutputFs.open(path, flags);
      const wrapped: OutputFileHandle = {
        async writeFile(data) {
          if (failing.writeFile) throw errno(failing.writeFile);
          await handle.writeFile(data);
        },
        async sync() {
          if (failing.sync) throw errno(failing.sync);
          await handle.sync();
        },
        async close() {
          if (failing.close) {
            await handle.close();
            throw errno(failing.close);
          }
          await handle.close();
        },
      };
      return wrapped;
    },
  };
}
