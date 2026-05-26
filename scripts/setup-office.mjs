#!/usr/bin/env node
/**
 * LibreOffice 环境检测与配置脚本
 *
 * 检测 LibreOffice，若未安装则引导安装。
 *
 * 用法: node scripts/setup-office.mjs
 */

import { execSync } from 'child_process';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { homedir, platform } from 'os';
import { createInterface } from 'readline';

const PLAT = platform();
const HOME = homedir();
const ROOT = resolve(import.meta.dirname, '..');
const ENV_PATH = join(ROOT, '.env');

// =================== 平台检测 ===================

function pathExists(p) {
  return existsSync(p);
}

function commandExists(cmd) {
  try {
    execSync(PLAT === 'win32' ? `where ${cmd}` : `which ${cmd}`, {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function commandWorks(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    console.log(`  ⚠ ${cmd} 存在于 PATH 但无法执行（可能是残留的 wrapper）`);
    return false;
  }
}

// =================== 检测逻辑 ===================

function detectLibreOffice() {
  if (PLAT === 'darwin') return detectMacOS();
  if (PLAT === 'win32') return detectWindows();
  return detectLinux();
}

function detectMacOS() {
  const localLO = join(HOME, '.local/lib/LibreOffice.app/Contents/MacOS/soffice');
  if (pathExists(localLO)) {
    return { bin: localLO, label: `LibreOffice (${localLO})` };
  }
  if (pathExists('/Applications/LibreOffice.app')) {
    return {
      bin: '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      label: 'LibreOffice (/Applications)',
    };
  }
  if (commandExists('soffice') && commandWorks('soffice')) {
    return { bin: 'soffice', label: 'LibreOffice (PATH)' };
  }
  return null;
}

function detectWindows() {
  const localAppData = process.env.LOCALAPPDATA || join(HOME, 'AppData/Local');
  const portableSoffice = join(localAppData, 'ses-libreoffice/App/libreoffice/program/soffice.exe');
  if (pathExists(portableSoffice)) {
    return {
      bin: portableSoffice,
      label: `LibreOffice Portable (${portableSoffice})`,
    };
  }
  if (commandExists('soffice') && commandWorks('soffice')) {
    return { bin: 'soffice', label: 'LibreOffice (PATH)' };
  }
  return null;
}

function detectLinux() {
  if (commandExists('libreoffice') && commandWorks('libreoffice')) {
    return { bin: 'libreoffice', label: 'LibreOffice (libreoffice)' };
  }
  if (commandExists('soffice') && commandWorks('soffice')) {
    return { bin: 'soffice', label: 'LibreOffice (soffice)' };
  }
  return null;
}

// =================== .env 写入 ===================

function writeEnv(bin) {
  let content = '';
  if (existsSync(ENV_PATH)) {
    content = readFileSync(ENV_PATH, 'utf-8');
  }

  const setVar = (key, val) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${val}`;
    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      content = content.trimEnd() + (content ? '\n' : '') + line + '\n';
    }
  };

  // 清理旧的 OFFICE_ENGINE 变量（如果存在）
  content = content.replace(/^OFFICE_ENGINE=.*\n?/m, '');

  if (bin) setVar('SOFFICE_BIN', bin);

  writeFileSync(ENV_PATH, content, 'utf-8');
}

// =================== 自动安装 LibreOffice ===================

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function installLibreOfficeMac() {
  console.log('\n将 LibreOffice 安装到隐蔽目录 ~/.local/lib/LibreOffice.app');
  console.log('不会注册文件关联，不会出现在 Launchpad 中。\n');

  const appDir = join(HOME, '.local/lib');
  mkdirSync(appDir, { recursive: true });

  if (commandExists('brew')) {
    console.log('检测到 Homebrew，使用 brew 安装...');
    try {
      execSync(`brew install --cask libreoffice --appdir="${appDir}"`, {
        stdio: 'inherit',
        timeout: 600_000,
      });
    } catch {
      console.log('brew --appdir 安装失败，尝试手动方式...');
      return installLibreOfficeMacManual(appDir);
    }
  } else {
    return installLibreOfficeMacManual(appDir);
  }

  const soffice = join(appDir, 'LibreOffice.app/Contents/MacOS/soffice');
  if (!pathExists(soffice)) {
    console.error('安装后未找到 soffice，请手动安装 LibreOffice。');
    process.exit(1);
  }

  return soffice;
}

async function installLibreOfficeMacManual(appDir) {
  console.log('\n请手动安装 LibreOffice：');
  console.log('1. 从 https://www.libreoffice.org/download/ 下载 macOS 版');
  console.log('2. 打开 DMG，将 LibreOffice.app 拖到以下目录：');
  console.log(`   ${appDir}/`);
  console.log('3. 重新运行 pnpm setup\n');
  process.exit(1);
}

async function installLibreOfficeWindows() {
  // 策略 1: 尝试 winget（大多数 Windows 10/11 自带）
  if (commandExists('winget')) {
    console.log('检测到 winget，尝试安装 LibreOffice...\n');
    try {
      execSync(
        'winget install --id TheDocumentFoundation.LibreOffice --accept-package-agreements --accept-source-agreements',
        { stdio: 'inherit', timeout: 600_000 },
      );
      const candidates = [
        join(process.env.ProgramFiles || 'C:\\Program Files', 'LibreOffice/program/soffice.exe'),
        join(process.env.ProgramW6432 || 'C:\\Program Files', 'LibreOffice/program/soffice.exe'),
        join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'LibreOffice/program/soffice.exe'),
      ];
      for (const p of candidates) {
        if (pathExists(p)) return p;
      }
      if (commandExists('soffice') && commandWorks('soffice')) {
        return 'soffice';
      }
      console.log('winget 安装完成，但未找到 soffice。请重新运行 pnpm setup。');
      process.exit(1);
    } catch {
      console.log('winget 安装失败，尝试其他方式...\n');
    }
  }

  // 策略 2: PowerShell 下载 LibreOffice Portable
  const localAppData = process.env.LOCALAPPDATA || join(HOME, 'AppData/Local');
  const installDir = join(localAppData, 'ses-libreoffice');
  const tmpInstaller = join(process.env.TEMP || join(HOME, 'AppData/Local/Temp'), 'LibreOfficePortable.paf.exe');

  console.log(`将 LibreOffice Portable 安装到 ${installDir}`);
  console.log('不会写入注册表，不会注册文件关联。\n');

  const downloadUrl = 'https://download.documentfoundation.org/libreoffice/portable/25.2/LibreOfficePortable_25.2.4_MultilingualAll.paf.exe';

  console.log('正在下载 LibreOffice Portable（约 400 MB，请耐心等待）...');
  try {
    execSync(
      `powershell -NoProfile -Command "` +
      `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ` +
      `Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${tmpInstaller}' -UseBasicParsing"`,
      { stdio: 'inherit', timeout: 600_000 },
    );
  } catch {
    console.log('\n下载失败。请手动安装：');
    console.log('1. 从 https://www.libreoffice.org/download/portable-versions/ 下载');
    console.log(`2. 运行安装程序，安装目录选择: ${installDir}`);
    console.log('3. 重新运行 pnpm setup\n');
    process.exit(1);
  }

  mkdirSync(installDir, { recursive: true });
  console.log('正在解压安装...');
  try {
    execSync(`"${tmpInstaller}" /S /D=${installDir}`, {
      stdio: 'inherit',
      timeout: 300_000,
    });
  } catch {
    console.log('\n静默安装失败，尝试手动运行安装程序...');
    try {
      execSync(`start "" "${tmpInstaller}"`, { stdio: 'inherit' });
      console.log(`请在安装程序中将安装目录设为: ${installDir}`);
      console.log('安装完成后重新运行 pnpm setup\n');
    } catch {
      console.log(`请手动运行安装程序: ${tmpInstaller}`);
      console.log(`安装目录设为: ${installDir}`);
      console.log('安装完成后重新运行 pnpm setup\n');
    }
    process.exit(1);
  }

  const sofficePath = join(installDir, 'App/libreoffice/program/soffice.exe');
  if (!pathExists(sofficePath)) {
    console.error('安装后未找到 soffice.exe，请手动安装 LibreOffice。');
    process.exit(1);
  }

  try { execSync(`del "${tmpInstaller}"`, { stdio: 'ignore' }); } catch { /* ignore */ }

  return sofficePath;
}

async function installLibreOfficeLinux() {
  console.log('\n请通过包管理器安装 LibreOffice：');
  console.log('  Ubuntu/Debian: sudo apt install libreoffice');
  console.log('  Fedora: sudo dnf install libreoffice');
  console.log('  Arch: sudo pacman -S libreoffice-still');
  console.log('\n安装后重新运行 pnpm setup');
  process.exit(1);
}

// =================== 主流程 ===================

async function main() {
  console.log('=== SES LibreOffice 环境配置 ===\n');
  console.log(`平台: ${PLAT}`);
  console.log('检测 LibreOffice...\n');

  let result = detectLibreOffice();

  if (result) {
    console.log(`✓ 检测到: ${result.label}`);
    if (result.bin) console.log(`  路径: ${result.bin}`);
    writeEnv(result.bin);
    console.log(`\n已写入 ${ENV_PATH}`);
    console.log('PDF 导出已就绪。');
    return;
  }

  console.log('✗ 未检测到 LibreOffice。\n');
  console.log('PDF 导出需要 LibreOffice（可自动安装到隐蔽目录）。\n');

  const answer = await ask('是否自动下载 LibreOffice？[Y/n] ');
  if (answer && answer !== 'y' && answer !== 'yes') {
    console.log('已跳过。PDF 导出功能将不可用，直到安装 LibreOffice。');
    return;
  }

  let bin;
  if (PLAT === 'darwin') {
    bin = await installLibreOfficeMac();
  } else if (PLAT === 'win32') {
    bin = await installLibreOfficeWindows();
  } else {
    await installLibreOfficeLinux();
  }

  if (bin) {
    writeEnv(bin);
    console.log(`\n✓ 安装完成！已写入 ${ENV_PATH}`);
    console.log('PDF 导出已就绪。');
  }
}

main().catch((err) => {
  console.error('setup 失败:', err.message);
  process.exit(1);
});
