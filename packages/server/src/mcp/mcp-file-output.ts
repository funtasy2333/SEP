import { randomBytes } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  type PlatformPath,
} from 'node:path';
import { HttpException } from '@nestjs/common';

/**
 * export_document 的 `outputPath`：把导出文件写到本机的**允许目录**里。
 *
 * **这是本地部署的能力**：服务端与用户在同一台机器上，AI 才有理由、也才有权限往用户的目录里写文件。
 * 云端部署（WP9.4）必须关闭它——设置环境变量 {@link FILE_WRITE_ENV} 为 `0` 或 `false`，此时给出 `outputPath`
 * 一律 403 `file-write-disabled`。本文件的写入逻辑不假设部署方式，开关由 {@link assertFileWriteEnabled} 在入口处检查。
 *
 * 写入的约束（都在这里实现，调用方不需要再做）：
 * - 只能写到允许目录：环境变量 {@link OUTPUT_DIRS_ENV} 配置（多个目录用平台的 `path.delimiter` 分隔，每项必须是绝对路径）；
 *   未配置（或没有任何有效项）时只允许默认导出目录 `<用户主目录>/SES-exports`，它不存在时在首次写入前自动创建
 *   （模式 0o700），用户配置的目录必须已存在、不会自动创建。不在允许目录内 → 403 `output-dir-not-allowed`；
 * - `outputPath` 可以是绝对路径，也可以是相对路径（含只给文件名），相对路径相对于**第一个**允许目录解析；
 * - 包含关系对目标的父目录与每个允许目录各取 `realpath` 后判断，所以允许目录内指向外部的符号链接目录逃不出去；
 * - 扩展名与格式对应，父目录必须已存在（默认导出目录除外）；
 * - 默认不覆盖：用 `open(path, 'wx')`（O_CREAT | O_EXCL），目标已存在——包括目标是符号链接（指向别处或已失效）——
 *   一律失败，不会写穿链接；
 * - 覆盖时先写同目录的临时文件，写完再 `rename` 替换目标：替换的是目录项本身，目标是符号链接时换掉的是链接，
 *   链接指向的文件不受影响；中途失败不会留下写了一半的目标；
 * - 任何失败都清理自己创建的文件（临时文件，或不覆盖时刚创建的目标）；
 * - 错误消息可含路径（返回给发起调用的人），但**日志不得含路径**：本文件不写日志，调用方记日志时只用错误码。
 */

/** 环境变量：`0` / `false`（大小写不敏感）时禁用 outputPath；缺省或其他值为允许。 */
export const FILE_WRITE_ENV = 'SES_MCP_ALLOW_FILE_WRITE';

/**
 * 环境变量：允许 `outputPath` 写入的目录。多个目录用 `path.delimiter` 分隔（POSIX 为 `:`，Windows 为 `;`），
 * 每项必须是绝对路径，相对路径、空项与含空字符的项忽略。每次调用时读取。
 */
export const OUTPUT_DIRS_ENV = 'SES_MCP_OUTPUT_DIRS';

/** 默认导出目录的名字：位于用户主目录下，未配置 {@link OUTPUT_DIRS_ENV} 时是唯一允许的目录。 */
export const DEFAULT_OUTPUT_DIR_NAME = 'SES-exports';

/** export_document 的 format 与文件扩展名的对应（扩展名比较不区分大小写）。 */
const FORMAT_EXTENSIONS = {
  docx: '.docx',
  pdf: '.pdf',
  html: '.html',
  json: '.json',
} as const;
export type OutputFormat = keyof typeof FORMAT_EXTENSIONS;

/** 本文件产生的错误：携带机器可读的 `code`，响应体与其他 4xx 同形，由 `toErrorBody` 原样映射。 */
export class OutputFileException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
  ) {
    super({ statusCode: status, message, code }, status);
  }
}

/** 文件系统操作的最小接口：生产用 node:fs/promises，测试可以逐项替换来模拟失败。 */
export interface OutputFs {
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  lstat(path: string): Promise<unknown>;
  open(path: string, flags: 'wx'): Promise<OutputFileHandle>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  /** 只用于创建默认导出目录（recursive、模式 0o700）。 */
  mkdir(
    path: string,
    options: { recursive: true; mode: number },
  ): Promise<unknown>;
  /** 解析符号链接后的真实路径；目录包含关系按它判断。 */
  realpath(path: string): Promise<string>;
}
export interface OutputFileHandle {
  writeFile(data: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export const nodeOutputFs: OutputFs = {
  stat,
  lstat,
  open,
  rename,
  unlink,
  mkdir,
  realpath,
};

/**
 * 决定允许目录所需的环境：缺省取真实进程环境与 `os.homedir()`。测试注入自己的环境变量与主目录，
 * 不读取、更不写入真实的 `~/SES-exports`。
 */
export interface OutputEnvironment {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
}

/** 环境变量允许写文件吗？每次调用时读取，修改环境变量（或 .env）后无需改代码。 */
export function isFileWriteEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[FILE_WRITE_ENV]?.trim().toLowerCase();
  return value !== '0' && value !== 'false';
}

function assertFileWriteEnabled(env: NodeJS.ProcessEnv): void {
  if (isFileWriteEnabled(env)) return;
  throw new OutputFileException(
    403,
    'file-write-disabled',
    `服务端已禁用写入本机文件（环境变量 ${FILE_WRITE_ENV}）；请去掉 outputPath，只使用返回的 downloadUrl`,
  );
}

/** 解析 {@link OUTPUT_DIRS_ENV} 只用到路径模块的这三个成员；测试可以传 `path.win32` 验证 Windows 的分隔符与绝对路径规则。 */
export type OutputPathApi = Pick<
  PlatformPath,
  'delimiter' | 'isAbsolute' | 'resolve'
>;

/**
 * 解析 {@link OUTPUT_DIRS_ENV} 的值：按 `delimiter` 分隔，每项去掉首尾空白；空项、含空字符的项、
 * 不是绝对路径的项一律忽略；其余规范化（消除 `.`、`..` 与末尾分隔符）并去重，保持配置的先后顺序
 * （第一项是相对路径的解析基准）。
 */
export function parseOutputDirs(
  value: string | undefined,
  pathApi: OutputPathApi = { delimiter, isAbsolute, resolve },
): string[] {
  const dirs: string[] = [];
  for (const item of (value ?? '').split(pathApi.delimiter)) {
    const entry = item.trim();
    if (entry === '' || entry.includes('\0') || !pathApi.isAbsolute(entry)) {
      continue;
    }
    const dir = pathApi.resolve(entry);
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  return dirs;
}

/** 当前允许写入的目录。`dirs[0]` 是相对路径的解析基准；`isDefault` 表示用的是默认导出目录。 */
export interface AllowedOutputDirs {
  dirs: string[];
  isDefault: boolean;
}

/**
 * 允许目录 = 环境变量里的有效项；没有配置、或配置后没有任何有效项时，只有默认导出目录
 * `<主目录>/SES-exports`。（主目录取不到或不是绝对路径时 `dirs` 为空，调用方按「没有可用目录」处理。）
 */
export function resolveAllowedOutputDirs(
  environment: OutputEnvironment = {},
): AllowedOutputDirs {
  const env = environment.env ?? process.env;
  const configured = parseOutputDirs(env[OUTPUT_DIRS_ENV]);
  if (configured.length > 0) return { dirs: configured, isDefault: false };
  let home: string | undefined;
  try {
    home = (environment.homedir ?? homedir)();
  } catch {
    home = undefined;
  }
  if (home === undefined || !isAbsolute(home)) {
    return { dirs: [], isDefault: true };
  }
  return { dirs: [join(home, DEFAULT_OUTPUT_DIR_NAME)], isDefault: true };
}

/** `child` 等于 `parent` 或位于它之内（两者都应是规范化的绝对路径；符号链接由调用方先解析）。 */
function isInsideDirectory(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  if (rel === '') return true;
  // 不同盘符时 relative 返回绝对路径；`..` 开头的是兄弟或上级目录（「..foo」这样的目录名不算）。
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

function outputDirNotAllowed(
  allowed: AllowedOutputDirs,
  target: string,
): OutputFileException {
  if (allowed.dirs.length === 0) {
    return new OutputFileException(
      403,
      'output-dir-not-allowed',
      `没有可用的导出目录（无法确定用户主目录）；请用户设置环境变量 ${OUTPUT_DIRS_ENV}，或去掉 outputPath，只使用返回的 downloadUrl`,
    );
  }
  const first = allowed.dirs[0];
  return new OutputFileException(
    403,
    'output-dir-not-allowed',
    `outputPath 不在允许写入的目录内（目标：${target}）。允许的目录：${allowed.dirs.join('、')}${allowed.isDefault ? '（默认导出目录）' : ''}。` +
      `只给文件名即可保存到 ${first}；要保存到其他目录，请用户把它加入环境变量 ${OUTPUT_DIRS_ENV}（多个目录用「${delimiter}」分隔）`,
  );
}

function errnoOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * 文件系统错误 → 带 `code` 的 4xx。消息由这里按 errno 自己组织（含路径与 errno 名），
 * 不使用原始的 `error.message`。未列出的 errno（磁盘满、配额、I/O 错误等）归为 422 `file-write-failed`，
 * 消息里带 errno 名供排查。已经是 {@link OutputFileException} 的原样返回。
 */
export function toOutputFileException(
  error: unknown,
  path: string,
): OutputFileException {
  if (error instanceof OutputFileException) return error;
  const errno = errnoOf(error);
  switch (errno) {
    case 'EEXIST':
      return new OutputFileException(
        409,
        'file-exists',
        `目标文件已存在：${path}；确认可以替换时把 overwrite 设为 true，或换一个文件名`,
      );
    case 'EISDIR':
      return new OutputFileException(
        400,
        'path-is-directory',
        `outputPath 指向的是一个目录：${path}；请给出文件的完整路径`,
      );
    case 'ENOENT':
      return new OutputFileException(
        400,
        'parent-not-found',
        `outputPath 的父目录不存在：${dirname(path)}；服务端不会自动创建目录`,
      );
    case 'ENOTDIR':
      return new OutputFileException(
        400,
        'parent-not-directory',
        `outputPath 的父路径不是目录：${dirname(path)}`,
      );
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return new OutputFileException(
        403,
        'file-write-denied',
        `没有权限写入：${path}（${errno}）`,
      );
    case 'ENAMETOOLONG':
    case 'ELOOP':
      return new OutputFileException(
        400,
        'invalid-output-path',
        `outputPath 无法使用：${path}（${errno}）`,
      );
    default:
      return new OutputFileException(
        422,
        'file-write-failed',
        `写入文件失败：${path}（${errno ?? '未知错误'}）`,
      );
  }
}

/**
 * 校验并规范化 outputPath（入口检查，先于导出执行，避免白白生成一份 PDF 才发现路径不对）。顺序：
 * 1. 开关未关闭（否则 403 `file-write-disabled`）；不含空字符（400 `invalid-output-path`）；
 * 2. 解析路径：绝对路径照用，相对路径（含只给文件名）相对于**第一个**允许目录；规范化（消除 `.`、`..`）；
 * 3. 扩展名与 format 对应（400 `invalid-output-extension`）；
 * 4. 父目录已存在且是目录（400 `parent-not-found` / `parent-not-directory`）。使用默认导出目录、目标就在其中时，
 *    目录不存在会先创建（recursive，0o700）；用户配置的目录与其他任何目录都不会自动创建；
 * 5. 父目录在允许目录之内（403 `output-dir-not-allowed`）：对父目录和每个允许目录取 `realpath`，
 *    父目录必须等于某个允许目录或位于其内。符号链接在这里被解析，所以允许目录里指向外部的符号链接目录
 *    （以及 `..` 逃逸）都会被拒绝；不存在或无法解析的允许目录不参与比较；
 * 6. 不覆盖时目标不能已存在（409 `file-exists`）。这里只是尽早失败，真正防止覆盖的是写入时的 O_EXCL。
 *
 * 返回规范化后的绝对路径（目标文件本身不解析符号链接，沿用写入规则：不覆盖 → O_EXCL 失败；覆盖 → rename 只替换链接），
 * `savedTo` 就是它。
 */
export async function prepareOutputTarget(
  rawPath: string,
  format: OutputFormat,
  overwrite: boolean,
  fs: OutputFs = nodeOutputFs,
  environment: OutputEnvironment = {},
): Promise<string> {
  assertFileWriteEnabled(environment.env ?? process.env);
  if (rawPath.includes('\0')) {
    throw new OutputFileException(
      400,
      'invalid-output-path',
      'outputPath 不能含空字符；给出文件名，或允许目录内的绝对路径',
    );
  }
  const allowed = resolveAllowedOutputDirs(environment);
  if (allowed.dirs.length === 0) throw outputDirNotAllowed(allowed, rawPath);
  const target = resolve(allowed.dirs[0], rawPath);

  const expected = FORMAT_EXTENSIONS[format];
  if (extname(target).toLowerCase() !== expected) {
    throw new OutputFileException(
      400,
      'invalid-output-extension',
      `outputPath 的扩展名必须与 format 对应：${format} 的文件应以 ${expected} 结尾`,
    );
  }

  const parent = dirname(target);
  if (allowed.isDefault && relative(allowed.dirs[0], parent) === '') {
    await ensureDefaultDirectory(fs, parent, target);
  }
  let parentIsDirectory: boolean;
  try {
    parentIsDirectory = (await fs.stat(parent)).isDirectory();
  } catch (error) {
    throw toOutputFileException(error, target);
  }
  if (!parentIsDirectory) {
    throw new OutputFileException(
      400,
      'parent-not-directory',
      `outputPath 的父路径不是目录：${parent}`,
    );
  }

  // 包含关系按真实路径判断。parent 刚确认存在；允许目录不存在或无法解析时跳过它。
  let realParent: string;
  try {
    realParent = await fs.realpath(parent);
  } catch (error) {
    throw toOutputFileException(error, target);
  }
  let inside = false;
  for (const dir of allowed.dirs) {
    const realDir = await fs.realpath(dir).catch(() => undefined);
    if (realDir !== undefined && isInsideDirectory(realDir, realParent)) {
      inside = true;
      break;
    }
  }
  if (!inside) throw outputDirNotAllowed(allowed, target);

  if (!overwrite) {
    // lstat：不跟随符号链接，指向别处或已失效的链接也算「已存在」。
    const exists = await fs.lstat(target).then(
      () => true,
      () => false,
    );
    if (exists) throw toOutputFileException({ code: 'EEXIST' }, target);
  }
  return target;
}

/**
 * 默认导出目录不存在时创建它（recursive，模式 0o700：导出文件是用户的文档，不对其他用户开放）。
 * 目录已存在是正常情况；`EEXIST`（路径上是文件、或已失效的符号链接）不在这里报错，交给随后的
 * stat 给出 `parent-not-directory` / `parent-not-found`。其他失败（没有权限等）映射为 4xx。
 */
async function ensureDefaultDirectory(
  fs: OutputFs,
  directory: string,
  target: string,
): Promise<void> {
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  } catch (error) {
    if (errnoOf(error) !== 'EEXIST') throw toOutputFileException(error, target);
  }
}

/** 以 O_EXCL 创建 `path` 并写满内容。失败时关闭句柄并删除刚创建的文件，错误原样抛出。 */
async function createAndFill(
  fs: OutputFs,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const handle = await fs.open(path, 'wx');
  try {
    try {
      await handle.writeFile(bytes);
      // 先落盘再让文件可见（rename 之前），崩溃后不会留下空文件顶替原文件。
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await fs.unlink(path).catch(() => undefined);
    throw error;
  }
}

/**
 * 把导出文件写到 `target`（{@link prepareOutputTarget} 的返回值）。
 * - `overwrite` 为 false：直接 O_EXCL 创建目标，已存在（含符号链接）→ 409 `file-exists`；
 * - `overwrite` 为 true：写同目录的临时文件再 `rename` 到目标，原子替换。
 * 失败时抛 {@link OutputFileException}，不留下临时文件或写了一半的文件。
 */
export async function writeOutputFile(
  target: string,
  bytes: Uint8Array,
  overwrite: boolean,
  fs: OutputFs = nodeOutputFs,
): Promise<void> {
  try {
    if (!overwrite) {
      await createAndFill(fs, target, bytes);
      return;
    }
    // 临时文件名固定长度，不受目标文件名长度限制；同目录保证 rename 不跨文件系统。
    const temp = join(
      dirname(target),
      `.ses-export-${randomBytes(8).toString('hex')}.tmp`,
    );
    await createAndFill(fs, temp, bytes);
    try {
      await fs.rename(temp, target);
    } catch (error) {
      await fs.unlink(temp).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    throw toOutputFileException(error, target);
  }
}
