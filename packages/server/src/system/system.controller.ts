import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { DesktopIntegrator } from './desktop-integrator';
import { LocalWriteGuard } from './local-write.guard';
import { SystemService } from './system.service';
import type {
  DesktopAutoStartResult,
  DesktopShortcutResult,
  DesktopStatus,
  DownloadStatus,
  SystemInfo,
  UpdateChannel,
  UpdateCheck,
} from './system.types';

function parseChannel(value: unknown): UpdateChannel {
  if (value === 'stable' || value === 'commit') return value;
  throw new BadRequestException('channel 必须是 stable 或 commit');
}

/** 应用内升级与退出。写接口（POST）经 {@link LocalWriteGuard} 防跨站；不暴露给 MCP。 */
@Controller('system')
export class SystemController {
  constructor(
    private readonly system: SystemService,
    private readonly desktop: DesktopIntegrator,
  ) {}

  /** GET /api/system/info：当前版本、运行方式，以及能否升级 / 退出。 */
  @Get('info')
  info(): SystemInfo {
    return this.system.info();
  }

  /** GET /api/system/desktop：桌面快捷方式与开机后台自启状态。 */
  @Get('desktop')
  desktopStatus(): Promise<DesktopStatus> {
    return this.desktop.status();
  }

  /** POST /api/system/desktop/shortcuts：创建或重建桌面与开始菜单/应用程序快捷方式。 */
  @Post('desktop/shortcuts')
  @UseGuards(LocalWriteGuard)
  @HttpCode(HttpStatus.OK)
  createDesktopShortcuts(): Promise<DesktopShortcutResult> {
    return this.desktop.createShortcuts();
  }

  /** POST /api/system/desktop/autostart：开启或关闭开机后台自启。 */
  @Post('desktop/autostart')
  @UseGuards(LocalWriteGuard)
  @HttpCode(HttpStatus.OK)
  setDesktopAutoStart(
    @Body() body: { enabled?: unknown },
  ): Promise<DesktopAutoStartResult> {
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('enabled 必须是布尔值');
    }
    return this.desktop.setAutoStart(body.enabled);
  }

  /** GET /api/system/update/check?channel=stable|commit：对比 GitHub 上的最新版本。 */
  @Get('update/check')
  checkUpdate(@Query('channel') channel: unknown): Promise<UpdateCheck> {
    return this.system.check(parseChannel(channel));
  }

  /** GET /api/system/update/status：更新包下载进度。 */
  @Get('update/status')
  updateStatus(): DownloadStatus {
    return this.system.downloadStatus();
  }

  /** POST /api/system/update：确认升级，后台下载并交接给升级脚本。 */
  @Post('update')
  @UseGuards(LocalWriteGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async startUpdate(
    @Body() body: { channel?: unknown; commit?: unknown },
  ): Promise<{ accepted: true }> {
    const channel = parseChannel(body?.channel);
    if (
      typeof body.commit !== 'string' ||
      !/^[0-9a-f]{7,40}$/i.test(body.commit)
    ) {
      throw new BadRequestException('commit 必须是检查更新返回的提交 sha');
    }
    await this.system.startUpdate(channel, body.commit);
    return { accepted: true };
  }

  /** POST /api/system/shutdown：退出 SES（响应发出后由退出脚本停掉服务）。 */
  @Post('shutdown')
  @UseGuards(LocalWriteGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  shutdown(@Res({ passthrough: true }) res: Response): { accepted: true } {
    this.system.assertCanShutdown();
    // 响应送达后再动手：finish 之后服务端才可以被停掉；连接被提前断开（close）也照常执行
    let triggered = false;
    const run = () => {
      if (triggered) return;
      triggered = true;
      void this.system.runShutdown();
    };
    res.once('finish', run);
    res.once('close', run);
    return { accepted: true };
  }
}
