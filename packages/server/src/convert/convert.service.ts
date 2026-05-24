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
   * 2. 调用 LibreOffice CLI 转换为 PDF
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

      // 2. 调用 LibreOffice CLI 进行转换
      await this.runLibreOfficeConvert(docxPath, pdfPath);

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
   * 使用 LibreOffice CLI 执行转换（无 Python/docx2pdf 运行时依赖）
   */
  private runLibreOfficeConvert(docxPath: string, pdfPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const outDir = pdfPath.replace(/[/\\][^/\\]+$/, '');
      execFile(
        'soffice',
        ['--headless', '--convert-to', 'pdf', '--outdir', outDir, docxPath],
        { timeout: 120_000 },
        async (error, stdout, stderr) => {
          if (error) {
            this.logger.error(`LibreOffice 执行失败: ${stderr || error.message}`);
            reject(new Error(`LibreOffice 转换失败: ${stderr || error.message}`));
            return;
          }
          if (stderr) {
            this.logger.warn(`LibreOffice 警告: ${stderr}`);
          }
          this.logger.log(`LibreOffice 输出: ${stdout.trim()}`);
          resolve();
        },
      ).on('error', (err) => {
        reject(new Error(`无法启动 LibreOffice 进程: ${err.message}`));
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
