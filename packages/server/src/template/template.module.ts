import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WriteCoordinatorModule } from '../common/write-coordinator.module';
import { ConvertModule } from '../convert/convert.module';
import { DocumentModule } from '../document/document.module';
import { TemplateController } from './template.controller';
import {
  DEFAULT_TEMPLATE_HEARTBEAT_MS,
  TEMPLATE_EVENTS_HEARTBEAT_MS,
  TemplateEventsService,
} from './template-events.service';
import { TemplateEntity } from './template.entity';
import { TemplateService } from './template.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TemplateEntity]),
    WriteCoordinatorModule,
    DocumentModule,
    ConvertModule,
  ],
  controllers: [TemplateController],
  providers: [
    TemplateService,
    TemplateEventsService,
    {
      provide: TEMPLATE_EVENTS_HEARTBEAT_MS,
      useValue: DEFAULT_TEMPLATE_HEARTBEAT_MS,
    },
  ],
  exports: [TemplateService, TemplateEventsService],
})
export class TemplateModule {}
