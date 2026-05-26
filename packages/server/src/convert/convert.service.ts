import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execFile, exec } from 'child_process';
import { writeFile, readFile, unlink, mkdtemp, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir, platform, homedir } from 'os';

@Injectable()
export class ConvertService implements OnModuleInit {
  private readonly logger = new Logger(ConvertService.name);
  private detected = false;
  private sofficeBin = 'soffice';

  async onModuleInit() {
    await this.detectLibreOffice();
  }

  private async detectLibreOffice(): Promise<void> {
    if (process.env.SOFFICE_BIN) {
      this.sofficeBin = process.env.SOFFICE_BIN;
      this.detected = true;
      this.logger.log(`使用环境变量指定的 LibreOffice: ${this.sofficeBin}`);
      return;
    }

    if (platform() === 'darwin') {
      await this.detectMacOS();
    } else if (platform() === 'win32') {
      await this.detectWindows();
    } else {
      await this.detectLinux();
    }

    if (!this.detected) {
      this.logger.warn(
        '未检测到 LibreOffice。PDF 导出将不可用。请运行 pnpm setup 进行配置。',
      );
    }
  }

  private async detectMacOS(): Promise<void> {
    const localLibreOffice = join(homedir(), '.local/lib/LibreOffice.app/Contents/MacOS/soffice');
    if (await this.pathExists(localLibreOffice)) {
      this.detected = true;
      this.sofficeBin = localLibreOffice;
      this.logger.log(`检测到 LibreOffice (本地安装: ${localLibreOffice})`);
      return;
    }
    if (await this.pathExists('/Applications/LibreOffice.app')) {
      this.detected = true;
      this.sofficeBin = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
      this.logger.log('检测到 LibreOffice (/Applications)');
      return;
    }
    if (await this.commandExists('soffice')) {
      this.detected = true;
      this.logger.log('检测到 LibreOffice (PATH)');
      return;
    }
  }

  private async detectWindows(): Promise<void> {
    const portableSoffice = join(
      process.env.LOCALAPPDATA || join(homedir(), 'AppData/Local'),
      'ses-libreoffice/App/libreoffice/program/soffice.exe',
    );
    if (await this.pathExists(portableSoffice)) {
      this.detected = true;
      this.sofficeBin = portableSoffice;
      this.logger.log(`检测到 LibreOffice Portable: ${portableSoffice}`);
      return;
    }
    if (await this.commandExists('soffice')) {
      this.detected = true;
      this.logger.log('检测到 LibreOffice (PATH)');
      return;
    }
  }

  private async detectLinux(): Promise<void> {
    if (await this.commandExists('libreoffice')) {
      this.detected = true;
      this.sofficeBin = 'libreoffice';
      this.logger.log('检测到 LibreOffice (Linux)');
      return;
    }
    if (await this.commandExists('soffice')) {
      this.detected = true;
      this.logger.log('检测到 LibreOffice soffice (Linux)');
      return;
    }
  }

  // =================== 转换入口 ===================

  async convertDocxToPdf(
    docxBuffer: Buffer,
    originalName: string,
  ): Promise<Buffer> {
    if (!this.detected) {
      throw new Error(
        '未检测到 LibreOffice。请运行 pnpm setup 配置环境，或手动安装 LibreOffice。',
      );
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'ses-convert-'));
    const docxPath = join(tempDir, 'input.docx');
    const pdfPath = join(tempDir, 'input.pdf');

    this.logger.log(
      `转换 "${originalName}" [LibreOffice] 临时目录: ${tempDir}`,
    );

    try {
      await writeFile(docxPath, docxBuffer);
      await this.convertWithLibreOffice(docxPath, tempDir);

      const pdfBuffer = await readFile(pdfPath);
      this.logger.log(`转换成功: PDF ${pdfBuffer.length} bytes`);
      return pdfBuffer;
    } finally {
      await this.cleanup(docxPath, pdfPath, tempDir);
    }
  }

  // =================== LibreOffice 转换 ===================

  private convertWithLibreOffice(docxPath: string, outDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        this.sofficeBin,
        ['--headless', '--convert-to', 'pdf', '--outdir', outDir, docxPath],
        { timeout: 120_000 },
        (error, stdout, stderr) => {
          if (error) {
            this.logger.error(`LibreOffice 转换失败: ${stderr || error.message}`);
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
        reject(new Error(`无法启动 LibreOffice: ${err.message}`));
      });
    });
  }

  // =================== 工具方法 ===================

  private async pathExists(p: string): Promise<boolean> {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  }

  private commandExists(cmd: string): Promise<boolean> {
    return new Promise((resolve) => {
      const check = platform() === 'win32' ? `where ${cmd}` : `which ${cmd}`;
      exec(check, (error) => resolve(!error));
    });
  }

  private async cleanup(...paths: string[]): Promise<void> {
    for (const p of paths) {
      try { await unlink(p); } catch { /* ignore */ }
    }
    try {
      const { rmdir } = await import('fs/promises');
      await rmdir(paths[paths.length - 1]);
    } catch { /* ignore */ }
  }
}
