import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { configureApp } from '../app-setup';
import { DOCUMENT_EVENTS_HEARTBEAT_MS } from '../document/document-events.controller';
import { DocumentEventsService } from '../document/document-events.service';
import { DocumentEntity } from '../document/document.entity';
import { DocumentModule } from '../document/document.module';
import { DocumentService } from '../document/document.service';
import { DocumentOpsModule } from '../document-ops/document-ops.module';
import { DocumentOpsService } from '../document-ops/document-ops.service';
import { ExportModule } from '../export/export.module';
import {
  DEFAULT_MCP_SESSION_OPTIONS,
  MCP_SESSION_OPTIONS,
  McpSessionService,
  type McpSessionOptions,
} from '../mcp/mcp-sessions.service';
import { McpModule } from '../mcp/mcp.module';
import { VersionEntity } from '../version/version.entity';
import { VersionModule } from '../version/version.module';
import { VersionService } from '../version/version.service';
import { SesPackageModule } from '../ses-package/ses-package.module';

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof request>;
  /** 监听地址，如 http://127.0.0.1:34567（SSE 用 node:http 直接连接）。 */
  url: string;
  events: DocumentEventsService;
  documents: DocumentService;
  versions: VersionService;
  ops: DocumentOpsService;
  mcp: McpSessionService;
  dataSource: DataSource;
}

/**
 * 起完整的文档/版本/操作/MCP 模块（内存 SQLite 或给定的临时文件，不触碰 data/ses.db）。
 * 监听真实端口：并发用例与 SSE 都需要。
 */
export async function createTestApp(
  options: {
    database?: string;
    heartbeatMs?: number;
    /** 覆盖 MCP 会话管理的参数（空闲超时、会话上限、时钟）。 */
    mcp?: Partial<McpSessionOptions>;
  } = {},
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
      ExportModule,
      SesPackageModule,
      McpModule,
    ],
  });
  if (options.heartbeatMs !== undefined) {
    builder = builder
      .overrideProvider(DOCUMENT_EVENTS_HEARTBEAT_MS)
      .useValue(options.heartbeatMs);
  }
  if (options.mcp !== undefined) {
    builder = builder
      .overrideProvider(MCP_SESSION_OPTIONS)
      .useValue({ ...DEFAULT_MCP_SESSION_OPTIONS, ...options.mcp });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
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
    mcp: app.get(McpSessionService),
    dataSource: app.get(DataSource),
  };
}
