import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execFile, exec } from 'child_process';
import { writeFile, readFile, unlink, mkdtemp, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir, platform, homedir } from 'os';

type OfficeEngine = 'word' | 'wps' | 'libreoffice';

@Injectable()
export class ConvertService implements OnModuleInit {
  private readonly logger = new Logger(ConvertService.name);
  private engine: OfficeEngine | null = null;
  private sofficeBin = 'soffice';

  async onModuleInit() {
    await this.detectEngine();
  }

  private async detectEngine(): Promise<void> {
    const envEngine = process.env.OFFICE_ENGINE as OfficeEngine | undefined;
    if (envEngine && ['word', 'wps', 'libreoffice'].includes(envEngine)) {
      this.engine = envEngine;
      if (envEngine === 'libreoffice' && process.env.SOFFICE_BIN) {
        this.sofficeBin = process.env.SOFFICE_BIN;
      }
      this.logger.log(`使用环境变量指定的引擎: ${this.engine}`);
      return;
    }

    if (platform() === 'darwin') {
      await this.detectMacOS();
    } else if (platform() === 'win32') {
      await this.detectWindows();
    } else {
      await this.detectLinux();
    }

    if (!this.engine) {
      this.logger.warn(
        '未检测到 Office 套件 (Word / WPS / LibreOffice)。' +
        'PDF 导出将不可用。请运行 pnpm setup 进行配置。',
      );
    }
  }

  private async detectMacOS(): Promise<void> {
    const localLibreOffice = join(homedir(), '.local/lib/LibreOffice.app/Contents/MacOS/soffice');
    if (await this.pathExists(localLibreOffice)) {
      this.engine = 'libreoffice';
      this.sofficeBin = localLibreOffice;
      this.logger.log(`检测到 LibreOffice (本地安装: ${localLibreOffice})`);
      return;
    }
    if (await this.pathExists('/Applications/LibreOffice.app')) {
      this.engine = 'libreoffice';
      this.sofficeBin = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
      this.logger.log('检测到 LibreOffice (/Applications)');
      return;
    }
    if (await this.commandExists('soffice') && await this.commandWorks('soffice')) {
      this.engine = 'libreoffice';
      this.logger.log('检测到 LibreOffice (PATH)');
      return;
    }
    if (await this.pathExists('/Applications/Microsoft Word.app')) {
      this.engine = 'word';
      this.logger.log('检测到 Microsoft Word (macOS)');
      return;
    }
    if (await this.pathExists('/Applications/wpsoffice.app')) {
      this.engine = 'wps';
      this.logger.log('检测到 WPS Office (macOS)');
      return;
    }
  }

  private async detectWindows(): Promise<void> {
    const portableSoffice = join(
      process.env.LOCALAPPDATA || join(homedir(), 'AppData/Local'),
      'ses-libreoffice/App/libreoffice/program/soffice.exe',
    );
    if (await this.pathExists(portableSoffice)) {
      this.engine = 'libreoffice';
      this.sofficeBin = portableSoffice;
      this.logger.log(`检测到 LibreOffice Portable: ${portableSoffice}`);
      return;
    }
    if (await this.commandExists('soffice') && await this.commandWorks('soffice')) {
      this.engine = 'libreoffice';
      this.logger.log('检测到 LibreOffice (PATH)');
      return;
    }
    if (await this.comClassExists('Word.Application')) {
      this.engine = 'word';
      this.logger.log('检测到 Microsoft Word (Windows)');
      return;
    }
    if (await this.comClassExists('KWPS.Application')) {
      this.engine = 'wps';
      this.logger.log('检测到 WPS Office (Windows)');
      return;
    }
  }

  private async detectLinux(): Promise<void> {
    if (await this.commandExists('libreoffice') && await this.commandWorks('libreoffice')) {
      this.engine = 'libreoffice';
      this.sofficeBin = 'libreoffice';
      this.logger.log('检测到 LibreOffice (Linux)');
      return;
    }
    if (await this.commandExists('soffice') && await this.commandWorks('soffice')) {
      this.engine = 'libreoffice';
      this.logger.log('检测到 LibreOffice soffice (Linux)');
      return;
    }
  }

  // =================== 转换入口 ===================

  async convertDocxToPdf(
    docxBuffer: Buffer,
    originalName: string,
  ): Promise<Buffer> {
    if (!this.engine) {
      throw new Error(
        '未检测到可用的 Office 引擎 (Word / WPS / LibreOffice)。' +
        '请运行 pnpm setup 配置环境，或手动安装其中一个。',
      );
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'ses-convert-'));
    const docxPath = join(tempDir, 'input.docx');
    const pdfPath = join(tempDir, 'input.pdf');

    this.logger.log(
      `转换 "${originalName}" [引擎: ${this.engine}] 临时目录: ${tempDir}`,
    );

    try {
      await writeFile(docxPath, docxBuffer);

      switch (this.engine) {
        case 'word':
          await this.convertWithWord(docxPath, pdfPath);
          break;
        case 'wps':
          await this.convertWithWps(docxPath, pdfPath);
          break;
        case 'libreoffice':
          await this.convertWithLibreOffice(docxPath, tempDir);
          break;
      }

      const pdfBuffer = await readFile(pdfPath);
      this.logger.log(`转换成功: PDF ${pdfBuffer.length} bytes`);
      return pdfBuffer;
    } finally {
      await this.cleanup(docxPath, pdfPath, tempDir);
    }
  }

  // =================== Word 引擎 ===================

  private convertWithWord(docxPath: string, pdfPath: string): Promise<void> {
    if (platform() === 'darwin') {
      return this.convertWithWordMac(docxPath, pdfPath);
    }
    return this.convertWithWordWindows(docxPath, pdfPath);
  }

  private convertWithWordMac(docxPath: string, pdfPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = `
        set inputFile to POSIX file "${docxPath}"
        set outputFile to "${pdfPath}"
        tell application "Microsoft Word"
          open inputFile
          set theDoc to active document
          save as theDoc file name outputFile file format format PDF
          close theDoc saving no
        end tell
      `;
      execFile('osascript', ['-e', script], { timeout: 120_000 }, (error, stdout, stderr) => {
        if (error) {
          this.logger.error(`Word (macOS) 转换失败: ${stderr || error.message}`);
          reject(new Error(`Word 转换失败: ${stderr || error.message}`));
          return;
        }
        resolve();
      });
    });
  }

  private convertWithWordWindows(docxPath: string, pdfPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const absDocx = docxPath.replace(/\//g, '\\');
      const absPdf = pdfPath.replace(/\//g, '\\');
      const ps = `
        $word = New-Object -ComObject Word.Application
        $word.Visible = $false
        $word.DisplayAlerts = 0
        try {
          $doc = $word.Documents.Open("${absDocx}")
          $doc.SaveAs([ref]"${absPdf}", [ref]17)
          $doc.Close([ref]0)
        } finally {
          $word.Quit()
          [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
        }
      `;
      exec(
        `powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`,
        { timeout: 120_000 },
        (error, stdout, stderr) => {
          if (error) {
            this.logger.error(`Word (Windows) 转换失败: ${stderr || error.message}`);
            reject(new Error(`Word 转换失败: ${stderr || error.message}`));
            return;
          }
          resolve();
        },
      );
    });
  }

  // =================== WPS 引擎 ===================

  private convertWithWps(docxPath: string, pdfPath: string): Promise<void> {
    if (platform() === 'darwin') {
      return this.convertWithWpsMac(docxPath, pdfPath);
    }
    return this.convertWithWpsWindows(docxPath, pdfPath);
  }

  private convertWithWpsMac(docxPath: string, pdfPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = `
        set inputFile to POSIX file "${docxPath}"
        set outputFile to "${pdfPath}"
        tell application "wpsoffice"
          open inputFile
          set theDoc to active document
          save as theDoc file name outputFile file format format PDF
          close theDoc saving no
        end tell
      `;
      execFile('osascript', ['-e', script], { timeout: 120_000 }, (error, stdout, stderr) => {
        if (error) {
          this.logger.error(`WPS (macOS) 转换失败: ${stderr || error.message}`);
          reject(new Error(`WPS 转换失败: ${stderr || error.message}`));
          return;
        }
        resolve();
      });
    });
  }

  private convertWithWpsWindows(docxPath: string, pdfPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const absDocx = docxPath.replace(/\//g, '\\');
      const absPdf = pdfPath.replace(/\//g, '\\');
      const ps = `
        $wps = New-Object -ComObject KWPS.Application
        $wps.Visible = $false
        $wps.DisplayAlerts = 0
        try {
          $doc = $wps.Documents.Open("${absDocx}")
          $doc.SaveAs("${absPdf}", 17)
          $doc.Close(0)
        } finally {
          $wps.Quit()
          [System.Runtime.Interopservices.Marshal]::ReleaseComObject($wps) | Out-Null
        }
      `;
      exec(
        `powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`,
        { timeout: 120_000 },
        (error, stdout, stderr) => {
          if (error) {
            this.logger.error(`WPS (Windows) 转换失败: ${stderr || error.message}`);
            reject(new Error(`WPS 转换失败: ${stderr || error.message}`));
            return;
          }
          resolve();
        },
      );
    });
  }

  // =================== LibreOffice 引擎 ===================

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

  private commandWorks(cmd: string): Promise<boolean> {
    return new Promise((resolve) => {
      execFile(cmd, ['--version'], { timeout: 10_000 }, (error) => {
        if (error) {
          this.logger.warn(`${cmd} 存在于 PATH 但无法执行: ${error.message}`);
        }
        resolve(!error);
      });
    });
  }

  private comClassExists(progId: string): Promise<boolean> {
    if (platform() !== 'win32') return Promise.resolve(false);
    return new Promise((resolve) => {
      const ps = `
        try {
          $app = New-Object -ComObject ${progId}
          try { $app.Quit() } catch {}
          [System.Runtime.Interopservices.Marshal]::ReleaseComObject($app) | Out-Null
          Write-Output 'OK'
        } catch {
          Write-Output 'FAIL'
        }
      `;
      exec(
        `powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`,
        { timeout: 15_000 },
        (error, stdout) => resolve(stdout?.trim() === 'OK'),
      );
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
