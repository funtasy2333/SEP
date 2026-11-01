import { Module } from '@nestjs/common';
import { GithubClient } from './github-client';
import { LocalWriteGuard } from './local-write.guard';
import { PROCESS_SPAWNER, spawnDetachedProcess } from './process-spawner';
import { createSystemConfig, SYSTEM_CONFIG } from './system.config';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';
import { UpdateChecker } from './update-checker';
import { UpdateDownloader } from './update-downloader';

@Module({
  controllers: [SystemController],
  providers: [
    { provide: SYSTEM_CONFIG, useFactory: () => createSystemConfig() },
    { provide: PROCESS_SPAWNER, useValue: spawnDetachedProcess },
    GithubClient,
    UpdateChecker,
    UpdateDownloader,
    LocalWriteGuard,
    SystemService,
  ],
})
export class SystemModule {}
