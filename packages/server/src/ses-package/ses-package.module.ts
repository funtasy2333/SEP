import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WriteCoordinatorModule } from '../common/write-coordinator.module';
import { DocumentModule } from '../document/document.module';
import { DocumentEntity } from '../document/document.entity';
import { VersionEntity } from '../version/version.entity';
import { SesPackageController } from './ses-package.controller';
import { SesPackageService } from './ses-package.service';

@Module({
  imports: [
    DocumentModule,
    TypeOrmModule.forFeature([DocumentEntity, VersionEntity]),
    WriteCoordinatorModule,
  ],
  controllers: [SesPackageController],
  providers: [SesPackageService],
  exports: [SesPackageService],
})
export class SesPackageModule {}
