import { Module } from '@nestjs/common';
import { DocumentModule } from '../document/document.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [DocumentModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
