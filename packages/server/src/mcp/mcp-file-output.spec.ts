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
import {
  basename,
  delimiter,
  dirname,
  join,
  posix,
  resolve,
  win32,
} from 'node:path';
import {
  DEFAULT_OUTPUT_DIR_NAME,
  FILE_WRITE_ENV,
  isFileWriteEnabled,
  nodeOutputFs,
  OUTPUT_DIRS_ENV,
  OutputFileException,
  parseOutputDirs,
  prepareOutputTarget,
  resolveAllowedOutputDirs,
  toOutputFileException,
  writeOutputFile,
  type OutputEnvironment,
  type OutputFileHandle,
  type OutputFormat,
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

const NOT_ALLOWED = { status: 403, code: 'output-dir-not-allowed' };

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

describe('parseOutputDirs：SES_MCP_OUTPUT_DIRS 的解析', () => {
  it('POSIX：用冒号分隔，保持配置顺序', () => {
    expect(parseOutputDirs('/a:/b/c:/d', posix)).toEqual(['/a', '/b/c', '/d']);
  });

  it('Windows：用分号分隔，盘符里的冒号不是分隔符', () => {
    expect(win32.delimiter).toBe(';');
    expect(parseOutputDirs('C:\\exports;D:\\docs\\out', win32)).toEqual([
      'C:\\exports',
      'D:\\docs\\out',
    ]);
  });

  it('相对路径、空项、纯空白项、含空字符的项一律忽略', () => {
    expect(
      parseOutputDirs('rel/dir::./x:../y: :/ok:/bad\0dir:~/docs', posix),
    ).toEqual(['/ok']);
    expect(
      parseOutputDirs('exports;;  ;.\\x;C:\\ok;..\\up;sub\\dir', win32),
    ).toEqual(['C:\\ok']);
  });

  it('每项去掉首尾空白，规范化（消除 . 与 ..、末尾分隔符），去重', () => {
    expect(parseOutputDirs(' /a/ : /b/../c : /a ', posix)).toEqual([
      '/a',
      '/c',
    ]);
    expect(parseOutputDirs('C:\\a\\;C:\\b\\..\\c;C:\\a', win32)).toEqual([
      'C:\\a',
      'C:\\c',
    ]);
  });

  it('未设置、空串、没有有效项：空数组', () => {
    expect(parseOutputDirs(undefined, posix)).toEqual([]);
    expect(parseOutputDirs('', posix)).toEqual([]);
    expect(parseOutputDirs(':::', posix)).toEqual([]);
    expect(parseOutputDirs('relative;also-relative', win32)).toEqual([]);
  });

  it('默认按当前平台的 path.delimiter 与绝对路径规则', () => {
    const a = resolve('/ses-out-a');
    const b = resolve('/ses-out-b');
    expect(parseOutputDirs([a, 'relative', b].join(delimiter))).toEqual([a, b]);
  });
});

describe('resolveAllowedOutputDirs：允许目录', () => {
  const home = resolve('/home/tester');
  const defaultDir = join(home, DEFAULT_OUTPUT_DIR_NAME);
  const homedir = () => home;

  it('默认导出目录是 <主目录>/SES-exports', () => {
    expect(DEFAULT_OUTPUT_DIR_NAME).toBe('SES-exports');
    expect(resolveAllowedOutputDirs({ env: {}, homedir })).toEqual({
      dirs: [defaultDir],
      isDefault: true,
    });
  });

  it('未配置、空串、纯空白、没有任何有效项：只有默认导出目录', () => {
    for (const value of [
      undefined,
      '',
      '   ',
      delimiter,
      ['relative', 'also/relative'].join(delimiter),
    ]) {
      expect(
        resolveAllowedOutputDirs({
          env: value === undefined ? {} : { [OUTPUT_DIRS_ENV]: value },
          homedir,
        }),
      ).toEqual({ dirs: [defaultDir], isDefault: true });
    }
  });

  it('配置了有效项：只有配置的目录，不再包含默认导出目录', () => {
    const a = resolve('/ses-out-a');
    const b = resolve('/ses-out-b');
    expect(
      resolveAllowedOutputDirs({
        env: { [OUTPUT_DIRS_ENV]: ['relative', a, b].join(delimiter) },
        homedir,
      }),
    ).toEqual({ dirs: [a, b], isDefault: false });
  });

  it('主目录取不到（抛异常、返回空串或相对路径）：没有可用目录', () => {
    for (const bad of [
      () => {
        throw new Error('no home');
      },
      () => '',
      () => 'relative/home',
    ]) {
      expect(resolveAllowedOutputDirs({ env: {}, homedir: bad })).toEqual({
        dirs: [],
        isDefault: true,
      });
    }
  });

  it('默认读取 process.env 与 os.homedir()，每次调用都重新读取', () => {
    const original = process.env[OUTPUT_DIRS_ENV];
    try {
      process.env[OUTPUT_DIRS_ENV] = resolve('/ses-out-a');
      expect(resolveAllowedOutputDirs().dirs).toEqual([resolve('/ses-out-a')]);
      delete process.env[OUTPUT_DIRS_ENV];
      expect(resolveAllowedOutputDirs().isDefault).toBe(true);
    } finally {
      if (original === undefined) delete process.env[OUTPUT_DIRS_ENV];
      else process.env[OUTPUT_DIRS_ENV] = original;
    }
  });
});

describe('outputPath 的写入', () => {
  /** 允许目录（SES_MCP_OUTPUT_DIRS 默认指向它）。 */
  let dir: string;
  /** 允许目录之外的另一个目录。 */
  let other: string;
  /** 注入的「用户主目录」：测试不会碰真实的 ~/SES-exports。 */
  let home: string;
  /** 注入的环境变量（不读取真实的 process.env）。 */
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ses-file-output-'));
    other = await mkdtemp(join(tmpdir(), 'ses-file-output-other-'));
    home = await mkdtemp(join(tmpdir(), 'ses-file-output-home-'));
    env = { [OUTPUT_DIRS_ENV]: dir };
    delete process.env[FILE_WRITE_ENV];
  });
  afterEach(async () => {
    delete process.env[FILE_WRITE_ENV];
    for (const path of [dir, `${dir}-evil`, other, home]) {
      await rm(path, { recursive: true, force: true });
    }
  });

  const environment = (): OutputEnvironment => ({ env, homedir: () => home });
  const prepare = (
    rawPath: string,
    format: OutputFormat,
    overwrite = false,
    fs: OutputFs = nodeOutputFs,
  ) => prepareOutputTarget(rawPath, format, overwrite, fs, environment());
  const listing = (path: string) => readdir(path).then((list) => list.sort());
  const names = () => listing(dir);

  // ---------------------------------------------------------------------------
  describe('prepareOutputTarget：入口检查', () => {
    it('合法路径：返回规范化后的绝对路径', async () => {
      expect(await prepare(join(dir, 'a.docx'), 'docx')).toBe(
        join(dir, 'a.docx'),
      );
      // 消除 . 与 ..
      const messy = `${dir}/sub/../b.pdf`;
      await mkdir(join(dir, 'sub'));
      expect(await prepare(messy, 'pdf')).toBe(join(dir, 'b.pdf'));
    });

    it('相对路径（含只给文件名）相对于第一个允许目录解析', async () => {
      await mkdir(join(dir, 'sub'));
      const cases: Array<[string, OutputFormat, string]> = [
        ['规范.docx', 'docx', join(dir, '规范.docx')],
        ['./a.pdf', 'pdf', join(dir, 'a.pdf')],
        ['sub/a.html', 'html', join(dir, 'sub', 'a.html')],
        ['sub/../b.json', 'json', join(dir, 'b.json')],
      ];
      for (const [path, format, expected] of cases) {
        expect(await prepare(path, format)).toBe(expected);
      }
    });

    it('路径含空字符 → 400', async () => {
      for (const path of [`${dir}/a\0.docx`, 'a\0.docx']) {
        const error = await failure(() => prepare(path, 'docx'));
        expect(codeOf(error)).toEqual({
          status: 400,
          code: 'invalid-output-path',
        });
      }
    });

    it('扩展名与格式不符（含没有扩展名、以点开头的文件名）→ 400 invalid-output-extension', async () => {
      const cases: Array<[string, OutputFormat]> = [
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
        // 绝对路径与只给文件名两种写法，规则相同。
        for (const path of [join(dir, name), name]) {
          const error = await failure(() => prepare(path, format));
          expect(codeOf(error)).toEqual({
            status: 400,
            code: 'invalid-output-extension',
          });
          expect(error.message).toContain(`.${format}`);
        }
      }
    });

    it('扩展名大小写不敏感', async () => {
      for (const [name, format] of [
        ['a.DOCX', 'docx'],
        ['a.Pdf', 'pdf'],
        ['a.HTML', 'html'],
        ['a.JSON', 'json'],
      ] as const) {
        await expect(prepare(join(dir, name), format)).resolves.toBe(
          join(dir, name),
        );
      }
    });

    it('父目录不存在 → 400 parent-not-found，不会创建它（配置的目录下的子目录从不自动创建）', async () => {
      for (const path of [join(dir, 'missing', 'a.docx'), 'missing/a.docx']) {
        const error = await failure(() => prepare(path, 'docx'));
        expect(codeOf(error)).toEqual({
          status: 400,
          code: 'parent-not-found',
        });
        expect(error.message).toContain(join(dir, 'missing'));
      }
      expect(await names()).toEqual([]);
    });

    it('父路径是文件 → 400 parent-not-directory（父路径本身是文件，或再上一级是文件）', async () => {
      await writeFile(join(dir, 'file'), 'x');
      for (const path of [
        join(dir, 'file', 'a.docx'),
        join(dir, 'file', 'deeper', 'a.docx'),
        'file/a.docx',
      ]) {
        const error = await failure(() => prepare(path, 'docx'));
        expect(codeOf(error)).toEqual({
          status: 400,
          code: 'parent-not-directory',
        });
      }
    });

    it('目标已存在且不覆盖 → 409 file-exists，消息含路径与 overwrite 提示；覆盖时通过', async () => {
      const target = join(dir, 'a.docx');
      await writeFile(target, 'old');
      const error = await failure(() => prepare(target, 'docx'));
      expect(codeOf(error)).toEqual({ status: 409, code: 'file-exists' });
      expect(error.message).toContain(target);
      expect(error.message).toContain('overwrite');
      await expect(prepare(target, 'docx', true)).resolves.toBe(target);
      expect(await readFile(target, 'utf8')).toBe('old');
    });

    it('目标是目录：不覆盖 → 409（已存在）', async () => {
      await mkdir(join(dir, 'a.docx'));
      const error = await failure(() => prepare(join(dir, 'a.docx'), 'docx'));
      expect(codeOf(error)).toEqual({ status: 409, code: 'file-exists' });
    });

    itPosix('父目录可以是指向允许目录内目录的符号链接', async () => {
      await mkdir(join(dir, 'real'));
      await symlink(join(dir, 'real'), join(dir, 'link'));
      await expect(prepare(join(dir, 'link', 'a.json'), 'json')).resolves.toBe(
        join(dir, 'link', 'a.json'),
      );
    });

    it('开关关闭 → 403 file-write-disabled，先于其他检查（不在允许目录内、不存在的目录、扩展名不符也是 403）', async () => {
      for (const value of ['0', 'false', 'FALSE']) {
        env[FILE_WRITE_ENV] = value;
        for (const path of [
          join(dir, 'a.docx'),
          'relative.docx',
          join(dir, 'missing', 'a.docx'),
          join(dir, 'a.txt'),
          join(other, 'a.docx'),
        ]) {
          const error = await failure(() => prepare(path, 'docx'));
          expect(codeOf(error)).toEqual({
            status: 403,
            code: 'file-write-disabled',
          });
          expect(error.message).toContain(FILE_WRITE_ENV);
        }
      }
      expect(await names()).toEqual([]);
      expect(await listing(home)).toEqual([]);
    });

    it('开关关闭时不触碰文件系统（也不创建默认导出目录）', async () => {
      env = { [FILE_WRITE_ENV]: '0' };
      const touched = jest.fn(() => Promise.reject(new Error('不应被调用')));
      const fs: OutputFs = {
        stat: touched,
        lstat: touched,
        open: touched,
        rename: touched,
        unlink: touched,
        mkdir: touched,
        realpath: touched,
      };
      await failure(() => prepare('a.docx', 'docx', false, fs));
      expect(touched).not.toHaveBeenCalled();
      expect(await listing(home)).toEqual([]);
    });

    it('开关读取注入的环境，不读 process.env', async () => {
      process.env[FILE_WRITE_ENV] = '0';
      await expect(prepare(join(dir, 'a.docx'), 'docx')).resolves.toBe(
        join(dir, 'a.docx'),
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe('prepareOutputTarget：只能写到允许目录', () => {
    it('绝对路径在允许目录之外 → 403 output-dir-not-allowed', async () => {
      const error = await failure(() => prepare(join(other, 'a.docx'), 'docx'));
      expect(codeOf(error)).toEqual(NOT_ALLOWED);
      expect(await listing(other)).toEqual([]);
    });

    it('错误消息：目标、允许的目录、只给文件名即可保存到第一个目录、请用户加入 SES_MCP_OUTPUT_DIRS', async () => {
      const target = join(other, 'a.docx');
      const error = await failure(() => prepare(target, 'docx'));
      expect(error.message).toContain(target);
      expect(error.message).toContain(`允许的目录：${dir}`);
      expect(error.message).toContain(`只给文件名即可保存到 ${dir}`);
      expect(error.message).toContain(
        `请用户把它加入环境变量 ${OUTPUT_DIRS_ENV}`,
      );
      expect(error.message).toContain(delimiter);
      // 响应体与其他 4xx 同形。
      expect(error.getResponse()).toMatchObject({
        statusCode: 403,
        code: 'output-dir-not-allowed',
        message: error.message,
      });
    });

    it.each([
      ['上一级', () => '../escape.docx'],
      ['多级回退', () => 'sub/../../escape.docx'],
      ['回退后进入兄弟目录', () => `../${basename(other)}/escape.docx`],
      ['绝对路径里的 ..', () => `${dir}/../escape.docx`],
      ['回退到文件系统根', () => `${'../'.repeat(40)}escape.docx`],
    ])('相对路径用 .. 逃逸：%s → 403', async (_name, path) => {
      await mkdir(join(dir, 'sub'));
      const error = await failure(() => prepare(path(), 'docx'));
      expect(codeOf(error)).toEqual(NOT_ALLOWED);
      expect(await listing(other)).toEqual([]);
    });

    it('名字以允许目录开头的兄弟目录不算在内（不是简单的前缀比较）', async () => {
      await mkdir(`${dir}-evil`);
      const error = await failure(() =>
        prepare(join(`${dir}-evil`, 'a.docx'), 'docx'),
      );
      expect(codeOf(error)).toEqual(NOT_ALLOWED);
    });

    it('目录名以两个点开头（如 ..data）的子目录是允许目录之内，不被误判为 ..', async () => {
      await mkdir(join(dir, '..data'));
      await expect(prepare('..data/a.docx', 'docx')).resolves.toBe(
        join(dir, '..data', 'a.docx'),
      );
    });

    it('允许目录本身可以直接作为父目录；子目录需已存在', async () => {
      await mkdir(join(dir, 'a', 'b'), { recursive: true });
      await expect(
        prepare(join(dir, 'a', 'b', 'x.docx'), 'docx'),
      ).resolves.toBe(join(dir, 'a', 'b', 'x.docx'));
    });

    it('检查顺序：扩展名先于允许目录，目录不存在先于允许目录，允许目录先于「已存在」', async () => {
      // 扩展名错误 → 400（而不是 403）
      expect(
        codeOf(await failure(() => prepare(join(other, 'a.txt'), 'docx'))),
      ).toEqual({ status: 400, code: 'invalid-output-extension' });
      // 父目录不存在 → 400（而不是 403）
      expect(
        codeOf(
          await failure(() =>
            prepare(join(other, 'missing', 'a.docx'), 'docx'),
          ),
        ),
      ).toEqual({ status: 400, code: 'parent-not-found' });
      // 允许目录之外已存在的文件 → 403（不泄露它存不存在），而不是 409
      await writeFile(join(other, 'exists.docx'), 'x');
      expect(
        codeOf(
          await failure(() => prepare(join(other, 'exists.docx'), 'docx')),
        ),
      ).toEqual(NOT_ALLOWED);
    });

    describe('多个允许目录', () => {
      beforeEach(() => {
        env = { [OUTPUT_DIRS_ENV]: [dir, other].join(delimiter) };
      });

      it('每个目录都可以写；相对路径与只给文件名相对于第一个', async () => {
        expect(await prepare('a.docx', 'docx')).toBe(join(dir, 'a.docx'));
        expect(await prepare(join(dir, 'b.docx'), 'docx')).toBe(
          join(dir, 'b.docx'),
        );
        expect(await prepare(join(other, 'c.docx'), 'docx')).toBe(
          join(other, 'c.docx'),
        );
      });

      it('顺序决定第一个目录', async () => {
        env = { [OUTPUT_DIRS_ENV]: [other, dir].join(delimiter) };
        expect(await prepare('a.docx', 'docx')).toBe(join(other, 'a.docx'));
      });

      it('不在任何一个里 → 403，消息列出全部允许的目录', async () => {
        const error = await failure(() =>
          prepare(join(home, 'd.docx'), 'docx'),
        );
        expect(codeOf(error)).toEqual(NOT_ALLOWED);
        expect(error.message).toContain(`${dir}、${other}`);
        expect(error.message).toContain(`只给文件名即可保存到 ${dir}`);
      });

      it('第一个目录不存在：只给文件名 → 400 parent-not-found，不自动创建；第二个目录照常可用', async () => {
        const missing = join(dir, 'not-created');
        env = { [OUTPUT_DIRS_ENV]: [missing, other].join(delimiter) };
        const error = await failure(() => prepare('a.docx', 'docx'));
        expect(codeOf(error)).toEqual({
          status: 400,
          code: 'parent-not-found',
        });
        expect(await names()).toEqual([]);
        expect(await listing(home)).toEqual([]);
        expect(await prepare(join(other, 'a.docx'), 'docx')).toBe(
          join(other, 'a.docx'),
        );
      });
    });

    describe('无效配置项被忽略', () => {
      it('相对路径、空项、空白项忽略，有效项照常生效', async () => {
        env = {
          [OUTPUT_DIRS_ENV]: ['relative/dir', '', '  ', './x', dir, '..'].join(
            delimiter,
          ),
        };
        expect(await prepare('a.docx', 'docx')).toBe(join(dir, 'a.docx'));
        // 相对项没有被当成允许目录：允许的目录里只有 dir。
        const error = await failure(() =>
          prepare(join(other, 'a.docx'), 'docx'),
        );
        expect(codeOf(error)).toEqual(NOT_ALLOWED);
        expect(error.message).toContain(`允许的目录：${dir}。`);
        expect(error.message).not.toContain('relative');
      });

      it('全部无效 → 按未配置处理，只允许默认导出目录', async () => {
        env = {
          [OUTPUT_DIRS_ENV]: ['relative', '', ' '].join(delimiter),
        };
        const target = await prepare('a.docx', 'docx');
        expect(target).toBe(join(home, DEFAULT_OUTPUT_DIR_NAME, 'a.docx'));
        const error = await failure(() => prepare(join(dir, 'a.docx'), 'docx'));
        expect(codeOf(error)).toEqual(NOT_ALLOWED);
      });
    });

    describe('未配置：默认导出目录 <主目录>/SES-exports', () => {
      let defaultDir: string;
      beforeEach(() => {
        env = {};
        defaultDir = join(home, DEFAULT_OUTPUT_DIR_NAME);
      });

      it('只给文件名：目录不存在时先创建（0o700），返回目录内的路径，可以写入', async () => {
        await expect(stat(defaultDir)).rejects.toThrow();
        const target = await prepare('规范.docx', 'docx');
        expect(target).toBe(join(defaultDir, '规范.docx'));
        expect((await stat(defaultDir)).isDirectory()).toBe(true);
        if (process.platform !== 'win32') {
          expect((await stat(defaultDir)).mode & 0o777).toBe(0o700);
        }
        await writeOutputFile(target, BYTES, false);
        expect((await readFile(target)).equals(BYTES)).toBe(true);
        expect(await listing(defaultDir)).toEqual(['规范.docx']);
        expect(await listing(home)).toEqual([DEFAULT_OUTPUT_DIR_NAME]);
      });

      it('默认导出目录里的绝对路径同样接受（并在需要时创建目录）', async () => {
        const target = join(defaultDir, 'a.json');
        expect(await prepare(target, 'json')).toBe(target);
        expect((await stat(defaultDir)).isDirectory()).toBe(true);
      });

      itPosix('目录已存在：不改动其权限，也不影响已有内容', async () => {
        await mkdir(defaultDir, { mode: 0o755 });
        await writeFile(join(defaultDir, 'old.docx'), 'old');
        const before = (await stat(defaultDir)).mode & 0o777;
        await prepare('new.docx', 'docx');
        expect((await stat(defaultDir)).mode & 0o777).toBe(before);
        expect(await listing(defaultDir)).toEqual(['old.docx']);
      });

      it('不在默认导出目录内 → 403，且不会为此创建默认导出目录', async () => {
        for (const path of [
          join(other, 'a.docx'),
          join(home, 'a.docx'),
          '../a.docx',
          `../../${basename(other)}/a.docx`,
        ]) {
          const error = await failure(() => prepare(path, 'docx'));
          expect(codeOf(error)).toEqual(NOT_ALLOWED);
          expect(error.message).toContain(defaultDir);
          expect(error.message).toContain('默认导出目录');
          expect(error.message).toContain(`只给文件名即可保存到 ${defaultDir}`);
        }
        expect(await listing(home)).toEqual([]);
      });

      it('默认导出目录里的子目录不会自动创建 → 400 parent-not-found', async () => {
        const error = await failure(() => prepare('sub/a.docx', 'docx'));
        expect(codeOf(error)).toEqual({
          status: 400,
          code: 'parent-not-found',
        });
        expect(error.message).toContain(join(defaultDir, 'sub'));
        expect(await listing(home)).toEqual([]);
      });

      it('默认导出目录的位置被文件占用 → 400 parent-not-directory', async () => {
        await writeFile(defaultDir, 'x');
        const error = await failure(() => prepare('a.docx', 'docx'));
        expect(codeOf(error)).toEqual({
          status: 400,
          code: 'parent-not-directory',
        });
        expect(await readFile(defaultDir, 'utf8')).toBe('x');
      });

      it('创建目录失败（没有权限等）→ 映射为 4xx', async () => {
        const fs: OutputFs = {
          ...nodeOutputFs,
          mkdir: () => Promise.reject(errno('EACCES')),
        };
        const error = await failure(() => prepare('a.docx', 'docx', false, fs));
        expect(codeOf(error)).toEqual({
          status: 403,
          code: 'file-write-denied',
        });
      });

      it('使用 mkdir 时传入 recursive 与 0o700，且只对默认导出目录调用', async () => {
        const calls: Array<[string, unknown]> = [];
        const fs: OutputFs = {
          ...nodeOutputFs,
          mkdir: (path, options) => {
            calls.push([path, options]);
            return nodeOutputFs.mkdir(path, options);
          },
        };
        await prepare('a.docx', 'docx', false, fs);
        expect(calls).toEqual([[defaultDir, { recursive: true, mode: 0o700 }]]);
        // 配置了目录时从不调用 mkdir。
        calls.length = 0;
        env = { [OUTPUT_DIRS_ENV]: dir };
        await prepare('b.docx', 'docx', false, fs);
        await failure(() => prepare('missing/c.docx', 'docx', false, fs));
        expect(calls).toEqual([]);
      });

      it('主目录取不到 → 403 output-dir-not-allowed，提示配置 SES_MCP_OUTPUT_DIRS', async () => {
        const error = await failure(() =>
          prepareOutputTarget('a.docx', 'docx', false, nodeOutputFs, {
            env: {},
            homedir: () => {
              throw new Error('no home');
            },
          }),
        );
        expect(codeOf(error)).toEqual(NOT_ALLOWED);
        expect(error.message).toContain(OUTPUT_DIRS_ENV);
      });

      it('配置了目录时不使用、也不创建默认导出目录；它即使已存在也不在允许范围内', async () => {
        env = { [OUTPUT_DIRS_ENV]: dir };
        await prepare('a.docx', 'docx');
        // 默认导出目录不存在：按「父目录不存在」报错，且不会被创建。
        const missing = await failure(() =>
          prepare(join(defaultDir, 'a.docx'), 'docx'),
        );
        expect(codeOf(missing)).toEqual({
          status: 400,
          code: 'parent-not-found',
        });
        expect(await listing(home)).toEqual([]);
        // 已存在时：不在允许目录内。
        await mkdir(defaultDir);
        const error = await failure(() =>
          prepare(join(defaultDir, 'a.docx'), 'docx'),
        );
        expect(codeOf(error)).toEqual(NOT_ALLOWED);
      });
    });

    describe('符号链接逃逸（realpath 判断）', () => {
      itPosix(
        '允许目录内指向外部的符号链接目录 → 403，绝对与相对路径都一样',
        async () => {
          await mkdir(join(other, 'inner'));
          await symlink(other, join(dir, 'out'));
          for (const path of [
            join(dir, 'out', 'a.docx'),
            'out/a.docx',
            'out/inner/a.docx',
            './out/../out/a.docx',
          ]) {
            const error = await failure(() => prepare(path, 'docx'));
            expect(codeOf(error)).toEqual(NOT_ALLOWED);
          }
          expect(await listing(other)).toEqual(['inner']);
        },
      );

      itPosix('符号链接链（链接指向链接，最终在外部）同样被拒绝', async () => {
        await symlink(other, join(dir, 'hop2'));
        await symlink(join(dir, 'hop2'), join(dir, 'hop1'));
        const error = await failure(() => prepare('hop1/a.docx', 'docx'));
        expect(codeOf(error)).toEqual(NOT_ALLOWED);
      });

      itPosix(
        '指向另一个允许目录的符号链接：允许（真实路径在允许目录内）',
        async () => {
          env = { [OUTPUT_DIRS_ENV]: [dir, other].join(delimiter) };
          await symlink(other, join(dir, 'to-other'));
          await expect(prepare('to-other/a.docx', 'docx')).resolves.toBe(
            join(dir, 'to-other', 'a.docx'),
          );
        },
      );

      itPosix(
        '允许目录本身是符号链接：两边都取 realpath，真实路径与链接路径都能写',
        async () => {
          const alias = join(home, 'alias');
          await symlink(dir, alias);
          env = { [OUTPUT_DIRS_ENV]: alias };
          await expect(prepare('a.docx', 'docx')).resolves.toBe(
            join(alias, 'a.docx'),
          );
          await expect(prepare(join(dir, 'b.docx'), 'docx')).resolves.toBe(
            join(dir, 'b.docx'),
          );
          // 链接里再套一层指向外部的链接，仍然被拒绝。
          await symlink(other, join(dir, 'out'));
          const error = await failure(() => prepare('out/c.docx', 'docx'));
          expect(codeOf(error)).toEqual(NOT_ALLOWED);
        },
      );

      itPosix(
        '已失效的符号链接目录：按父目录不存在处理（400），不会创建链接指向的位置',
        async () => {
          await symlink(join(other, 'missing'), join(dir, 'gone'));
          const error = await failure(() => prepare('gone/a.docx', 'docx'));
          expect(codeOf(error)).toEqual({
            status: 400,
            code: 'parent-not-found',
          });
          expect(await listing(other)).toEqual([]);
        },
      );

      itPosix(
        '默认导出目录本身是指向别处的符号链接：真实路径与自身比较，允许写入',
        async () => {
          env = {};
          const real = join(other, 'real-exports');
          await mkdir(real);
          await symlink(real, join(home, DEFAULT_OUTPUT_DIR_NAME));
          const target = await prepare('a.docx', 'docx');
          expect(target).toBe(join(home, DEFAULT_OUTPUT_DIR_NAME, 'a.docx'));
          await writeOutputFile(target, BYTES, false);
          expect(await listing(real)).toEqual(['a.docx']);
        },
      );

      itPosix(
        '目标文件本身是指向外部的符号链接：沿用现有规则（不覆盖 → 409；覆盖 → 只替换链接）',
        async () => {
          const victim = join(other, 'victim.docx');
          await writeFile(victim, '外部文件的原内容');
          await symlink(victim, join(dir, 'link.docx'));

          const exists = await failure(() => prepare('link.docx', 'docx'));
          expect(codeOf(exists)).toEqual({ status: 409, code: 'file-exists' });

          const target = await prepare('link.docx', 'docx', true);
          expect(target).toBe(join(dir, 'link.docx'));
          await writeOutputFile(target, BYTES, true);
          expect((await lstat(target)).isSymbolicLink()).toBe(false);
          expect((await readFile(target)).equals(BYTES)).toBe(true);
          expect(await readFile(victim, 'utf8')).toBe('外部文件的原内容');
        },
      );
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
    const target = await prepare(`${dir}/sub/../out.json`, 'json');
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
