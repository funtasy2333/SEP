import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentEntity } from './document.entity';
import { DocumentController } from './document.controller';
import {
  DEFAULT_HEARTBEAT_MS,
  DOCUMENT_EVENTS_HEARTBEAT_MS,
  DocumentEventsController,
} from './document-events.controller';
import { DocumentEventsService } from './document-events.service';
import { DocumentService } from './document.service';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentEntity])],
  controllers: [DocumentController, DocumentEventsController],
  providers: [
    DocumentService,
    DocumentEventsService,
    { provide: DOCUMENT_EVENTS_HEARTBEAT_MS, useValue: DEFAULT_HEARTBEAT_MS },
  ],
  exports: [DocumentService, DocumentEventsService],
})
export class DocumentModule {}
