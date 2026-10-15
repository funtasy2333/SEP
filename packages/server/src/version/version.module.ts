import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WriteCoordinatorModule } from '../common/write-coordinator.module';
import { DocumentEntity } from '../document/document.entity';
import { VersionEntity } from './version.entity';
import { VersionController } from './version.controller';
import { VersionService } from './version.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([VersionEntity, DocumentEntity]),
    WriteCoordinatorModule,
  ],
  controllers: [VersionController],
  providers: [VersionService],
  exports: [VersionService],
})
export class VersionModule {}
