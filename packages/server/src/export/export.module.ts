import { Module } from '@nestjs/common';
import { ConvertModule } from '../convert/convert.module';
import { DocumentModule } from '../document/document.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [DocumentModule, ConvertModule],
  controllers: [ExportController],
  providers: [ExportService],
  // MCP 的 validate_document / export_document 与 REST 导出接口走同一个服务。
  exports: [ExportService],
})
export class ExportModule {}
