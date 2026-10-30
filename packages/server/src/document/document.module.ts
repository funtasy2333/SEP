import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WriteCoordinatorModule } from '../common/write-coordinator.module';
import { DocumentEntity } from './document.entity';
import { DocumentIdentityService } from './document-identity.service';
import { DocumentController } from './document.controller';
import {
  DEFAULT_HEARTBEAT_MS,
  DOCUMENT_EVENTS_HEARTBEAT_MS,
  DocumentEventsController,
} from './document-events.controller';
import { DocumentEventsService } from './document-events.service';
import { DocumentService } from './document.service';
import { VersionEntity } from '../version/version.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentEntity, VersionEntity]),
    WriteCoordinatorModule,
  ],
  controllers: [DocumentController, DocumentEventsController],
  providers: [
    DocumentService,
    DocumentIdentityService,
    DocumentEventsService,
    { provide: DOCUMENT_EVENTS_HEARTBEAT_MS, useValue: DEFAULT_HEARTBEAT_MS },
  ],
  exports: [DocumentService, DocumentEventsService],
})
export class DocumentModule {}
