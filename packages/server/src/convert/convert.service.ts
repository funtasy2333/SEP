import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

@Injectable()
export class ConvertService {
  private readonly logger = new Logger(ConvertService.name);

  /**
   * 将 DOCX 二进制数据转换为 PDF。
   *
   * 流程：
   * 1. 将 DOCX 写入临时文件
   * 2. 调用 Python docx2pdf（内部使用 Word COM 自动化）
   * 3. 读取生成的 PDF 并返回 Buffer
   * 4. 清理临时文件
   */
  async convertDocxToPdf(
    docxBuffer: Buffer,
    originalName: string,
  ): Promise<Buffer> {
    // 创建临时目录
    const tempDir = await mkdtemp(join(tmpdir(), 'ses-convert-'));
    // 使用固定的 ASCII 文件名避免中文路径编码问题
    const docxPath = join(tempDir, 'input.docx');
    const pdfPath = join(tempDir, 'input.pdf');

    this.logger.log(
      `转换 "${originalName}": 临时目录 ${tempDir}`,
    );

    try {
      // 1. 写入 DOCX 临时文件
      await writeFile(docxPath, docxBuffer);

      // 2. 调用 Python docx2pdf 进行转换
      await this.runDocx2Pdf(docxPath, pdfPath);

      // 3. 读取生成的 PDF
      const pdfBuffer = await readFile(pdfPath);
      this.logger.log(
        `转换成功: PDF ${pdfBuffer.length} bytes`,
      );

      return pdfBuffer;
    } finally {
      // 4. 清理临时文件
      await this.cleanup(docxPath, pdfPath, tempDir);
    }
  }

  /**
   * 调用 Python 执行 docx2pdf 转换
   */
  private runDocx2Pdf(docxPath: string, pdfPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const pythonScript = `
import sys
from docx2pdf import convert
try:
    convert(sys.argv[1], sys.argv[2])
    print("OK")
except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
`.trim();

      const proc = execFile(
        'python',
        ['-c', pythonScript, docxPath, pdfPath],
        { timeout: 120_000 }, // 2 分钟超时
        (error, stdout, stderr) => {
          if (error) {
            this.logger.error(`docx2pdf 执行失败: ${stderr || error.message}`);
            reject(
              new Error(`docx2pdf 转换失败: ${stderr || error.message}`),
            );
            return;
          }
          if (stderr) {
            this.logger.warn(`docx2pdf 警告: ${stderr}`);
          }
          this.logger.log(`docx2pdf 输出: ${stdout.trim()}`);
          resolve();
        },
      );

      proc.on('error', (err) => {
        reject(new Error(`无法启动 Python 进程: ${err.message}`));
      });
    });
  }

  /**
   * 清理临时文件和目录
   */
  private async cleanup(...paths: string[]): Promise<void> {
    for (const p of paths) {
      try {
        await unlink(p);
      } catch {
        // 文件可能不存在，忽略
      }
    }
    // 尝试删除临时目录（rmdir 只能删空目录，这里文件已删除）
    try {
      const { rmdir } = await import('fs/promises');
      await rmdir(paths[paths.length - 1]);
    } catch {
      // 忽略
    }
  }
}
