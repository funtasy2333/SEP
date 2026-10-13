import { Module } from '@nestjs/common';
import { DocumentModule } from '../document/document.module';
import { VersionModule } from '../version/version.module';
import { DocumentOpsController } from './document-ops.controller';
import { DocumentOpsService } from './document-ops.service';

@Module({
  imports: [DocumentModule, VersionModule],
  controllers: [DocumentOpsController],
  providers: [DocumentOpsService],
})
export class DocumentOpsModule {}
