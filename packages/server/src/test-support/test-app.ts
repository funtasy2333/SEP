import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DOCUMENT_EVENTS_HEARTBEAT_MS } from '../document/document-events.controller';
import { DocumentEventsService } from '../document/document-events.service';
import { DocumentEntity } from '../document/document.entity';
import { DocumentModule } from '../document/document.module';
import { DocumentService } from '../document/document.service';
import { DocumentOpsModule } from '../document-ops/document-ops.module';
import { DocumentOpsService } from '../document-ops/document-ops.service';
import { VersionEntity } from '../version/version.entity';
import { VersionModule } from '../version/version.module';
import { VersionService } from '../version/version.service';

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof request>;
  /** 监听地址，如 http://127.0.0.1:34567（SSE 用 node:http 直接连接）。 */
  url: string;
  events: DocumentEventsService;
  documents: DocumentService;
  versions: VersionService;
  ops: DocumentOpsService;
  dataSource: DataSource;
}

/**
 * 起完整的文档/版本/操作模块（内存 SQLite 或给定的临时文件，不触碰 data/ses.db）。
 * 监听真实端口：并发用例与 SSE 都需要。
 */
export async function createTestApp(
  options: { database?: string; heartbeatMs?: number } = {},
): Promise<TestApp> {
  let builder = Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'better-sqlite3',
        database: options.database ?? ':memory:',
        entities: [DocumentEntity, VersionEntity],
        synchronize: true,
      }),
      DocumentModule,
      VersionModule,
      DocumentOpsModule,
    ],
  });
  if (options.heartbeatMs !== undefined) {
    builder = builder
      .overrideProvider(DOCUMENT_EVENTS_HEARTBEAT_MS)
      .useValue(options.heartbeatMs);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  return {
    app,
    http: request(url),
    url,
    events: app.get(DocumentEventsService),
    documents: app.get(DocumentService),
    versions: app.get(VersionService),
    ops: app.get(DocumentOpsService),
    dataSource: app.get(DataSource),
  };
}
