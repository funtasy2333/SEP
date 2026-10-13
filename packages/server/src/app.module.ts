import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { DocumentModule } from './document/document.module';
import { DocumentOpsModule } from './document-ops/document-ops.module';
import { VersionModule } from './version/version.module';
import { ConvertModule } from './convert/convert.module';
import { ExportModule } from './export/export.module';
import { DocumentEntity } from './document/document.entity';
import { VersionEntity } from './version/version.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: join(process.cwd(), 'data', 'ses.db'),
      entities: [DocumentEntity, VersionEntity],
      synchronize: true,
    }),
    DocumentModule,
    DocumentOpsModule,
    VersionModule,
    ConvertModule,
    ExportModule,
  ],
})
export class AppModule {}
