import { Module } from '@nestjs/common';
import { DocumentOpsModule } from '../document-ops/document-ops.module';
import { DocumentModule } from '../document/document.module';
import {
  DEFAULT_MCP_SESSION_OPTIONS,
  MCP_SESSION_OPTIONS,
  McpSessionService,
} from './mcp-sessions.service';
import { McpToolsService } from './mcp-tools.service';
import { McpController } from './mcp.controller';

/** MCP 服务（WP9.3）：`/mcp` 端点、会话管理与工具。写入全部经 DocumentOpsService / DocumentService。 */
@Module({
  imports: [DocumentModule, DocumentOpsModule],
  controllers: [McpController],
  providers: [
    McpSessionService,
    McpToolsService,
    { provide: MCP_SESSION_OPTIONS, useValue: DEFAULT_MCP_SESSION_OPTIONS },
  ],
})
export class McpModule {}
