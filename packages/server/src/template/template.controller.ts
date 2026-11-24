import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DOCX_MIME_TYPE } from '@ses/io';
import { parseDocumentOperationsRequest } from '../document-ops/operations-request';
import { attachmentDisposition, buildWarningHeaders } from '../export/export-http';
import {
  TEMPLATE_CHANGED_EVENT,
  TEMPLATE_EVENTS_HEARTBEAT_MS,
  TemplateEventsService,
  type TemplateChangeEvent,
} from './template-events.service';
import {
  parseTemplatePackage,
  SES_TEMPLATE_MIME,
} from './template-package-format';
import { TemplateService } from './template.service';

const RECONNECT_DELAY_MS = 3_000;

function formatTemplateEvent(event: TemplateChangeEvent): string {
  return `event: ${TEMPLATE_CHANGED_EVENT}\nid: ${event.revision}\ndata: ${JSON.stringify(event)}\n\n`;
}

function parseOptionalIntQuery(
  query: Record<string, unknown>,
  name: string,
  allowZero: boolean,
): number | undefined {
  const raw = query[name];
  if (raw === undefined) return undefined;
  if (
    typeof raw !== 'string' ||
    !/^(0|[1-9]\d*)$/.test(raw) ||
    (!allowZero && raw === '0')
  ) {
    throw new BadRequestException(
      `${name} 必须是${allowZero ? '非负' : '正'}整数`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new BadRequestException(
      `${name} 必须是${allowZero ? '非负' : '正'}整数`,
    );
  }
  return value;
}

@Controller('templates')
export class TemplateController {
  constructor(
    private readonly templates: TemplateService,
    private readonly events: TemplateEventsService,
    @Inject(TEMPLATE_EVENTS_HEARTBEAT_MS)
    private readonly heartbeatMs: number,
  ) {}

  @Get()
  list() {
    return this.templates.list();
  }

  /** SSE 实时同步通道：放在 :id 路由之前避免被当成模板 ID 匹配。 */
  @Get('events')
  stream(@Req() req: Request, @Res() res: Response): void {
    if (res.destroyed) return;
    req.socket.setKeepAlive(true);
    req.socket.setNoDelay(true);
    req.socket.setTimeout(0);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`retry: ${RECONNECT_DELAY_MS}\n\n`);

    const write = (chunk: string): void => {
      try {
        res.write(chunk);
      } catch {
        // 连接已关闭，由 res.on('close') 清理
      }
    };
    const subscription = this.events.events().subscribe({
      next: (event) => write(formatTemplateEvent(event)),
      complete: () => res.end(),
    });
    const heartbeat = setInterval(
      () => write(': heartbeat\n\n'),
      this.heartbeatMs,
    );
    res.on('close', () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
    });
  }

  @Post()
  create(@Body() body: unknown) {
    return this.templates.create(body, 'human');
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  async importPackage(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const contentType = req.headers['content-type'];
    const mediaType =
      typeof contentType === 'string'
        ? contentType.split(';', 1)[0].trim().toLowerCase()
        : undefined;
    if (mediaType !== SES_TEMPLATE_MIME) {
      throw new UnsupportedMediaTypeException(
        `Content-Type 必须是 ${SES_TEMPLATE_MIME}`,
      );
    }
    const mode = query.mode;
    if (
      typeof mode !== 'string' ||
      !['preview', 'new', 'update'].includes(mode)
    ) {
      throw new BadRequestException('mode 必须是 preview / new / update');
    }
    if (!Buffer.isBuffer(req.body)) {
      throw new BadRequestException('模板包请求体必须是原始字节');
    }
    const pkg = parseTemplatePackage(req.body);
    if (mode === 'preview') {
      return this.templates.previewImport(pkg);
    }
    const targetId = parseOptionalIntQuery(query, 'targetId', false);
    const baseRevision = parseOptionalIntQuery(query, 'baseRevision', true);
    return this.templates.importPackage(pkg, mode as 'new' | 'update', {
      targetId,
      baseRevision,
    });
  }

  @Post('from-document/:documentId')
  createFromDocument(
    @Param('documentId', ParseIntPipe) documentId: number,
    @Body() body: unknown,
  ) {
    return this.templates.createFromDocument(documentId, body);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.templates.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.templates.update(id, body, 'human');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.templates.remove(id);
  }

  @Post(':id/revert')
  @HttpCode(HttpStatus.OK)
  revert(@Param('id') id: string, @Body() body: unknown) {
    const baseRevision =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>).baseRevision
        : undefined;
    return this.templates.revert(id, baseRevision);
  }

  @Post(':id/operations')
  @HttpCode(HttpStatus.OK)
  applyOperations(@Param('id') id: string, @Body() body: unknown) {
    const bodyObj =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const request = parseDocumentOperationsRequest({
      ...bodyObj,
      source: bodyObj.source ?? 'human',
    });
    return this.templates.applyOperations(id, request);
  }

  @Get(':id/export')
  async exportPackage(@Param('id') id: string): Promise<StreamableFile> {
    const result = await this.templates.exportPackage(id);
    return new StreamableFile(result.bytes, {
      type: SES_TEMPLATE_MIME,
      disposition: attachmentDisposition(result.filename),
      length: result.bytes.length,
    });
  }

  @Post(':id/preview/docx')
  @HttpCode(HttpStatus.OK)
  async previewDocx(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.templates.previewDocx(id);
    res.set(buildWarningHeaders(result.warnings as never[]));
    return new StreamableFile(result.bytes, {
      type: DOCX_MIME_TYPE,
      disposition: attachmentDisposition(result.filename),
      length: result.bytes.length,
    });
  }

  @Post(':id/preview/pdf')
  @HttpCode(HttpStatus.OK)
  async previewPdf(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.templates.previewPdf(id);
    res.set(buildWarningHeaders(result.warnings as never[]));
    return new StreamableFile(result.bytes, {
      type: 'application/pdf',
      disposition: attachmentDisposition(result.filename),
      length: result.bytes.length,
    });
  }
}
