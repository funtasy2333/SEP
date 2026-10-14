import { randomBytes } from 'node:crypto';
import { lstat, open, rename, stat, unlink } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { HttpException } from '@nestjs/common';

/**
 * export_document 的 `outputPath`：把导出文件写到本机路径。
 *
 * **这是本地部署的能力**：服务端与用户在同一台机器上，AI 才有理由、也才有权限往用户的目录里写文件。
 * 云端部署（WP9.4）必须关闭它——设置环境变量 {@link FILE_WRITE_ENV} 为 `0` 或 `false`，此时给出 `outputPath`
 * 一律 403 `file-write-disabled`。本文件的写入逻辑不假设部署方式，开关由 {@link assertFileWriteEnabled} 在入口处检查。
 *
 * 写入的约束（都在这里实现，调用方不需要再做）：
 * - 路径必须是绝对路径，扩展名与格式对应，父目录必须已存在（不自动创建目录）；
 * - 默认不覆盖：用 `open(path, 'wx')`（O_CREAT | O_EXCL），目标已存在——包括目标是符号链接（指向别处或已失效）——
 *   一律失败，不会写穿链接；
 * - 覆盖时先写同目录的临时文件，写完再 `rename` 替换目标：替换的是目录项本身，目标是符号链接时换掉的是链接，
 *   链接指向的文件不受影响；中途失败不会留下写了一半的目标；
 * - 任何失败都清理自己创建的文件（临时文件，或不覆盖时刚创建的目标）；
 * - 错误消息可含路径（返回给发起调用的人），但**日志不得含路径**：本文件不写日志，调用方记日志时只用错误码。
 */

/** 环境变量：`0` / `false`（大小写不敏感）时禁用 outputPath；缺省或其他值为允许。 */
export const FILE_WRITE_ENV = 'SES_MCP_ALLOW_FILE_WRITE';

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
}
export interface OutputFileHandle {
  writeFile(data: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export const nodeOutputFs: OutputFs = { stat, lstat, open, rename, unlink };

/** 环境变量允许写文件吗？每次调用时读取，修改环境变量（或 .env）后无需改代码。 */
export function isFileWriteEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[FILE_WRITE_ENV]?.trim().toLowerCase();
  return value !== '0' && value !== 'false';
}

function assertFileWriteEnabled(): void {
  if (isFileWriteEnabled()) return;
  throw new OutputFileException(
    403,
    'file-write-disabled',
    `服务端已禁用写入本机文件（环境变量 ${FILE_WRITE_ENV}）；请去掉 outputPath，只使用返回的 downloadUrl`,
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
 * 校验并规范化 outputPath（入口检查，先于导出执行，避免白白生成一份 PDF 才发现路径不对）：
 * 1. 开关未关闭（否则 403）；
 * 2. 是绝对路径、不含 NUL，扩展名与 format 对应（400 `invalid-output-path` / `invalid-output-extension`）；
 * 3. 父目录已存在且是目录（400 `parent-not-found` / `parent-not-directory`）；
 * 4. 不覆盖时目标不能已存在（409 `file-exists`）。这里只是尽早失败，真正防止覆盖的是写入时的 O_EXCL。
 *
 * 返回规范化（消除 `.`、`..`）后的绝对路径，`savedTo` 就是它。
 */
export async function prepareOutputTarget(
  rawPath: string,
  format: OutputFormat,
  overwrite: boolean,
  fs: OutputFs = nodeOutputFs,
): Promise<string> {
  assertFileWriteEnabled();
  if (rawPath.includes('\0') || !isAbsolute(rawPath)) {
    throw new OutputFileException(
      400,
      'invalid-output-path',
      'outputPath 必须是本机上的绝对路径（不含空字符）；用户要把文件放在某个目录时，用该目录的绝对路径加文件名',
    );
  }
  const expected = FORMAT_EXTENSIONS[format];
  if (extname(rawPath).toLowerCase() !== expected) {
    throw new OutputFileException(
      400,
      'invalid-output-extension',
      `outputPath 的扩展名必须与 format 对应：${format} 的文件应以 ${expected} 结尾`,
    );
  }
  const target = resolve(rawPath);

  const parent = dirname(target);
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
