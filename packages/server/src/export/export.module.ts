import { Module } from '@nestjs/common';
import { ConvertModule } from '../convert/convert.module';
import { DocumentModule } from '../document/document.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [DocumentModule, ConvertModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
