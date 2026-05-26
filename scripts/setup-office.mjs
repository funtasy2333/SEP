#!/usr/bin/env node
/**
 * Office 环境检测与配置脚本
 *
 * 按优先级检测 Word > WPS > LibreOffice，
 * 若都未安装则自动下载 LibreOffice 到隐蔽目录。
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

function comClassExists(progId) {
  if (PLAT !== 'win32') return false;
  try {
    const out = execSync(
      `powershell -NoProfile -NonInteractive -Command "try { $null = New-Object -ComObject ${progId}; Write-Output 'OK' } catch { Write-Output 'FAIL' }"`,
      { timeout: 15_000, encoding: 'utf-8' },
    );
    return out.trim() === 'OK';
  } catch {
    return false;
  }
}

// =================== 检测逻辑 ===================

function detectEngine() {
  if (PLAT === 'darwin') return detectMacOS();
  if (PLAT === 'win32') return detectWindows();
  return detectLinux();
}

function detectMacOS() {
  const localLO = join(HOME, '.local/lib/LibreOffice.app/Contents/MacOS/soffice');
  if (pathExists(localLO)) {
    return { engine: 'libreoffice', bin: localLO, label: `LibreOffice (${localLO})` };
  }
  if (pathExists('/Applications/LibreOffice.app')) {
    return {
      engine: 'libreoffice',
      bin: '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      label: 'LibreOffice (/Applications)',
    };
  }
  if (commandExists('soffice') && commandWorks('soffice')) {
    return { engine: 'libreoffice', bin: 'soffice', label: 'LibreOffice (PATH)' };
  }
  if (pathExists('/Applications/Microsoft Word.app')) {
    return { engine: 'word', bin: '', label: 'Microsoft Word (/Applications)' };
  }
  if (pathExists('/Applications/wpsoffice.app')) {
    return { engine: 'wps', bin: '', label: 'WPS Office (/Applications)' };
  }
  return null;
}

function detectWindows() {
  const localAppData = process.env.LOCALAPPDATA || join(HOME, 'AppData/Local');
  const portableSoffice = join(localAppData, 'ses-libreoffice/App/libreoffice/program/soffice.exe');
  if (pathExists(portableSoffice)) {
    return {
      engine: 'libreoffice',
      bin: portableSoffice,
      label: `LibreOffice Portable (${portableSoffice})`,
    };
  }
  if (commandExists('soffice') && commandWorks('soffice')) {
    return { engine: 'libreoffice', bin: 'soffice', label: 'LibreOffice (PATH)' };
  }
  if (comClassExists('Word.Application')) {
    return { engine: 'word', bin: '', label: 'Microsoft Word (COM)' };
  }
  if (comClassExists('KWPS.Application')) {
    return { engine: 'wps', bin: '', label: 'WPS Office (COM)' };
  }
  return null;
}

function detectLinux() {
  if (commandExists('libreoffice') && commandWorks('libreoffice')) {
    return { engine: 'libreoffice', bin: 'libreoffice', label: 'LibreOffice (libreoffice)' };
  }
  if (commandExists('soffice') && commandWorks('soffice')) {
    return { engine: 'libreoffice', bin: 'soffice', label: 'LibreOffice (soffice)' };
  }
  return null;
}

// =================== .env 写入 ===================

function writeEnv(engine, bin) {
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

  setVar('OFFICE_ENGINE', engine);
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
  console.log('\n将下载 LibreOffice Portable 到 %LOCALAPPDATA%\\ses-libreoffice\\');
  console.log('不会写入注册表，不会注册文件关联。\n');

  const localAppData = process.env.LOCALAPPDATA || join(HOME, 'AppData/Local');
  const installDir = join(localAppData, 'ses-libreoffice');

  console.log('请手动安装 LibreOffice Portable：');
  console.log('1. 从 https://portableapps.com/apps/office/libreoffice_portable 下载');
  console.log(`2. 安装到: ${installDir}`);
  console.log('3. 重新运行 pnpm setup\n');
  process.exit(1);
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
  console.log('=== SES Office 环境配置 ===\n');
  console.log(`平台: ${PLAT}`);
  console.log('检测已安装的 Office 套件...\n');

  let result = detectEngine();

  if (result) {
    console.log(`✓ 检测到: ${result.label}`);
    console.log(`  引擎: ${result.engine}`);
    if (result.bin) console.log(`  路径: ${result.bin}`);
    writeEnv(result.engine, result.bin);
    console.log(`\n已写入 ${ENV_PATH}`);
    console.log('PDF 导出已就绪。');
    return;
  }

  console.log('✗ 未检测到 Word、WPS 或 LibreOffice。\n');
  console.log('PDF 导出需要以下任一软件：');
  console.log('  1. Microsoft Word（推荐，已安装则自动使用）');
  console.log('  2. WPS Office');
  console.log('  3. LibreOffice（可自动安装到隐蔽目录）\n');

  const answer = await ask('是否自动下载 LibreOffice？[Y/n] ');
  if (answer && answer !== 'y' && answer !== 'yes') {
    console.log('已跳过。PDF 导出功能将不可用，直到安装 Office 套件。');
    return;
  }

  let bin;
  if (PLAT === 'darwin') {
    bin = await installLibreOfficeMac();
  } else if (PLAT === 'win32') {
    await installLibreOfficeWindows();
  } else {
    await installLibreOfficeLinux();
  }

  if (bin) {
    writeEnv('libreoffice', bin);
    console.log(`\n✓ 安装完成！已写入 ${ENV_PATH}`);
    console.log('PDF 导出已就绪。');
  }
}

main().catch((err) => {
  console.error('setup 失败:', err.message);
  process.exit(1);
});
