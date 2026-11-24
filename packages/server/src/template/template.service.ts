import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  applyDocumentOperations,
  buildDocx,
  buildPdfExportRequest,
  checkExportGuard,
  type DocumentOperationWarning,
  type OperationEffect,
  type DocumentProblem,
} from '@ses/io';
import {
  BUILTIN_TEMPLATES,
  DocumentStage,
  PDF_EXPORT_DISABLED_MESSAGE,
  PDF_EXPORT_ENABLED,
  StandardType,
  cloneCoverLayout,
  createDefaultDocumentContent,
  getBuiltinTemplate,
  instantiateTemplateDocument,
  irMetaFromDocumentMeta,
  validateCoverLayout,
  type CoverLayoutConfig,
  type DocumentMeta,
  type PMJsonNode,
  type StandardTemplate,
  type TemplateDefaultMeta,
  type TemplateSource,
} from '@ses/shared';
import { unprocessable } from '../common/http-errors';
import { WriteCoordinator } from '../common/write-coordinator';
import { ConvertService } from '../convert/convert.service';
import type { DocumentOperationsRequest } from '../document-ops/operations-request';
import { parseBaseRevision } from '../document/document-update';
import { DocumentService, revisionConflict } from '../document/document.service';
import {
  editorContentValidator,
  normalizeContent,
} from '../editor-schema/editor-schema';
import { blockExternalImages } from '../export/external-images';
import { TemplateEventsService } from './template-events.service';
import { TemplateEntity } from './template.entity';
import {
  buildTemplatePackage,
  validateTemplateContent,
  validateTemplateDefaultMeta,
  type SesTemplatePackage,
  type SesTemplatePackagePayload,
} from './template-package-format';

const STANDARD_TYPE_SET = new Set<string>(Object.values(StandardType));
const DOCUMENT_STAGE_SET = new Set<string>(Object.values(DocumentStage));

export interface CreateTemplateDto {
  name: string;
  description?: string;
  baseType: StandardType;
  defaultStage?: DocumentStage;
  defaultMeta?: TemplateDefaultMeta;
  coverLayout?: CoverLayoutConfig;
  content?: Record<string, unknown>;
  fromDocumentId?: number;
  fromTemplateId?: string | number;
}

export interface UpdateTemplateDto {
  baseRevision: number;
  name?: string;
  description?: string;
  baseType?: StandardType;
  defaultStage?: DocumentStage;
  defaultMeta?: TemplateDefaultMeta;
  coverLayout?: CoverLayoutConfig | null;
  content?: Record<string, unknown>;
}

export interface TemplateImportPreview {
  status: 'new' | 'match';
  incoming: SesTemplatePackagePayload;
  existing: StandardTemplate | null;
}

export interface TemplateOperationsResult {
  template: StandardTemplate;
  revision: number;
  operations: OperationEffect[];
  problems: DocumentProblem[];
  warnings: DocumentOperationWarning[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNumericTemplateId(idParam: string | number): number {
  if (typeof idParam === 'number') {
    if (!Number.isSafeInteger(idParam) || idParam < 1) {
      throw new BadRequestException('模板 id 必须是正整数或内置模板标识');
    }
    return idParam;
  }
  if (!/^[1-9]\d*$/.test(idParam)) {
    throw new BadRequestException('模板 id 必须是正整数或内置模板标识');
  }
  const parsed = Number(idParam);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new BadRequestException('模板 id 必须是正整数或内置模板标识');
  }
  return parsed;
}

function toStandardTemplate(entity: TemplateEntity): StandardTemplate {
  return {
    id: entity.id,
    uid: entity.uid,
    name: entity.name,
    description: entity.description,
    baseType: entity.baseType,
    defaultStage: entity.defaultStage,
    defaultMeta: entity.defaultMeta ?? {},
    ...(entity.coverLayout ? { coverLayout: entity.coverLayout } : {}),
    content: entity.content,
    source: entity.source,
    readonly: false,
    revision: entity.revision,
    hasPreviousContent: entity.previousContent !== null && entity.previousContent !== undefined,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function deriveStdPrefix(stdNo: string | undefined): string | undefined {
  const trimmed = stdNo?.trim();
  if (!trimmed) return undefined;
  const idx = trimmed.indexOf(' ');
  return idx > 0 ? trimmed.slice(0, idx) : undefined;
}

function extractTemplateMetaFromDocMeta(meta: DocumentMeta): TemplateDefaultMeta {
  const out: TemplateDefaultMeta = {};
  const keys = [
    'standardType',
    'icsCode',
    'ccsCode',
    'titleEn',
    'issuer',
    'applicant',
    'proposer',
    'technicalCommittee',
    'replaces',
    'consistency',
    'filingNo',
    'industryName',
    'regionName',
    'coverDesignation',
  ] as const;
  for (const key of keys) {
    const val = meta[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      (out as Record<string, string>)[key] = val;
    }
  }
  const prefix = deriveStdPrefix(meta.standardNo);
  if (prefix) out.stdPrefix = prefix;
  return out;
}

@Injectable()
export class TemplateService {
  constructor(
    @InjectRepository(TemplateEntity)
    private readonly repo: Repository<TemplateEntity>,
    private readonly writes: WriteCoordinator,
    private readonly documents: DocumentService,
    private readonly convertService: ConvertService,
    private readonly events: TemplateEventsService,
  ) {}

  async list(): Promise<StandardTemplate[]> {
    const customs = await this.writes.run(() =>
      this.repo.find({ order: { updatedAt: 'DESC', id: 'DESC' } }),
    );
    return [
      ...BUILTIN_TEMPLATES.map((tpl) => structuredClone(tpl)),
      ...customs.map(toStandardTemplate),
    ];
  }

  async findOne(idParam: string | number): Promise<StandardTemplate> {
    const builtin = getBuiltinTemplate(String(idParam));
    if (builtin && (typeof idParam === 'string' && (idParam.startsWith('builtin:') || idParam.includes('-')))) {
      return structuredClone(builtin);
    }
    const id = parseNumericTemplateId(idParam);
    const entity = await this.writes.run(() => this.repo.findOne({ where: { id } }));
    if (!entity) throw new NotFoundException(`Template #${idParam} not found`);
    return toStandardTemplate(entity);
  }

  /** 支持按数字 ID、内置 ID（builtin:group）或 UUID 解析模板，供新建文档与派生使用。 */
  async resolveByIdentifier(identifier: string | number): Promise<StandardTemplate> {
    const asStr = String(identifier).trim();
    const builtin = getBuiltinTemplate(asStr);
    if (builtin) return structuredClone(builtin);

    if (/^[1-9]\d*$/.test(asStr)) {
      const entity = await this.writes.run(() =>
        this.repo.findOne({ where: { id: Number(asStr) } }),
      );
      if (!entity) throw new NotFoundException(`Template #${asStr} not found`);
      return toStandardTemplate(entity);
    }

    const entity = await this.writes.run(() =>
      this.repo
        .createQueryBuilder('template')
        .where('LOWER(template.uid) = :uid', { uid: asStr.toLowerCase() })
        .getOne(),
    );
    if (!entity) throw new NotFoundException(`Template "${asStr}" not found`);
    return toStandardTemplate(entity);
  }

  async create(
    rawDto: unknown,
    source: Exclude<TemplateSource, 'builtin'> = 'human',
  ): Promise<StandardTemplate> {
    if (!isPlainObject(rawDto)) {
      throw new BadRequestException('请求体必须是 JSON 对象');
    }
    const dto = rawDto as unknown as CreateTemplateDto;

    if (typeof dto.name !== 'string' || dto.name.trim().length === 0) {
      throw new BadRequestException('name 必须是非空字符串');
    }
    const name = dto.name.trim();
    const description =
      dto.description === undefined
        ? ''
        : typeof dto.description === 'string'
          ? dto.description
          : (() => {
              throw new BadRequestException('description 必须是字符串');
            })();

    let baseTemplate: StandardTemplate | undefined;
    let sourceDocMeta: DocumentMeta | undefined;
    let sourceDocStage: DocumentStage | undefined;
    let sourceDocContent: Record<string, unknown> | undefined;

    if (dto.fromDocumentId !== undefined) {
      if (
        typeof dto.fromDocumentId !== 'number' ||
        !Number.isSafeInteger(dto.fromDocumentId) ||
        dto.fromDocumentId < 1
      ) {
        throw new BadRequestException('fromDocumentId 必须是正整数');
      }
      const doc = await this.documents.findOne(dto.fromDocumentId);
      sourceDocMeta = doc.meta as unknown as DocumentMeta;
      sourceDocStage = doc.stage as DocumentStage;
      if (!doc.content) {
        throw unprocessable('源文档内容为空，无法另存为模板');
      }
      sourceDocContent = doc.content;
    } else if (dto.fromTemplateId !== undefined) {
      baseTemplate = await this.resolveByIdentifier(dto.fromTemplateId);
    }

    const rawBaseType =
      dto.baseType ?? sourceDocMeta?.standardType ?? baseTemplate?.baseType;
    if (typeof rawBaseType !== 'string' || !STANDARD_TYPE_SET.has(rawBaseType)) {
      throw new BadRequestException(
        `baseType 必须是 ${[...STANDARD_TYPE_SET].join(' / ')} 之一`,
      );
    }
    const baseType = rawBaseType as StandardType;

    const rawStage =
      dto.defaultStage ??
      sourceDocStage ??
      baseTemplate?.defaultStage ??
      DocumentStage.WORKING_DRAFT;
    if (typeof rawStage !== 'string' || !DOCUMENT_STAGE_SET.has(rawStage)) {
      throw new BadRequestException(
        `defaultStage 必须是 ${[...DOCUMENT_STAGE_SET].join(' / ')} 之一`,
      );
    }
    const defaultStage = rawStage as DocumentStage;

    const inheritedMeta: TemplateDefaultMeta = sourceDocMeta
      ? extractTemplateMetaFromDocMeta(sourceDocMeta)
      : baseTemplate
        ? { ...baseTemplate.defaultMeta }
        : {};
    const defaultMeta =
      dto.defaultMeta !== undefined
        ? {
            ...inheritedMeta,
            ...validateTemplateDefaultMeta(dto.defaultMeta, 'defaultMeta'),
          }
        : inheritedMeta;

    const rawCoverLayout =
      dto.coverLayout !== undefined
        ? dto.coverLayout
        : sourceDocMeta?.coverLayout !== undefined
          ? cloneCoverLayout(sourceDocMeta.coverLayout)
          : cloneCoverLayout(baseTemplate?.coverLayout);

    let coverLayout: CoverLayoutConfig | null = null;
    if (rawCoverLayout !== undefined && rawCoverLayout !== null) {
      const check = validateCoverLayout(rawCoverLayout, baseType, 'coverLayout');
      if (!check.valid) {
        throw new BadRequestException(check.errors[0]!.message);
      }
      coverLayout = check.value ?? null;
    }

    const rawContent =
      dto.content !== undefined
        ? dto.content
        : sourceDocContent !== undefined
          ? structuredClone(sourceDocContent)
          : baseTemplate
            ? structuredClone(baseTemplate.content)
            : createDefaultDocumentContent({
                standardType: baseType,
                titleCn: '',
                ...defaultMeta,
              });

    validateTemplateContent(rawContent, 'content');
    const normalizedContent = normalizeContent(
      rawContent,
    ) as unknown as Record<string, unknown>;

    const saved = await this.writes.run(async () => {
      const entity = this.repo.create({
        uid: randomUUID(),
        name,
        description,
        baseType,
        defaultStage,
        defaultMeta,
        coverLayout,
        content: normalizedContent,
        previousContent: null,
        source,
        revision: 0,
      });
      return this.repo.save(entity);
    });

    this.events.publish({
      templateId: saved.id,
      uid: saved.uid,
      revision: saved.revision,
      action: 'created',
      source: source === 'agent' ? 'agent' : source === 'import' ? 'import' : 'human',
      at: new Date().toISOString(),
    });
    return toStandardTemplate(saved);
  }

  async createFromDocument(
    documentId: number,
    rawDto: unknown,
  ): Promise<StandardTemplate> {
    if (!isPlainObject(rawDto)) {
      throw new BadRequestException('请求体必须是 JSON 对象');
    }
    return this.create({ ...rawDto, fromDocumentId: documentId }, 'human');
  }

  async update(
    idParam: string | number,
    rawBody: unknown,
    source: 'human' | 'agent' = 'human',
  ): Promise<StandardTemplate> {
    if (getBuiltinTemplate(String(idParam)) && String(idParam).startsWith('builtin:')) {
      throw new BadRequestException('内置只读模板不允许修改，请基于它派生新模板');
    }
    if (!isPlainObject(rawBody)) {
      throw new BadRequestException('请求体必须是 JSON 对象');
    }
    const baseRevision = parseBaseRevision(rawBody.baseRevision);
    const id = parseNumericTemplateId(idParam);

    if (rawBody.name !== undefined && (typeof rawBody.name !== 'string' || rawBody.name.trim().length === 0)) {
      throw new BadRequestException('name 必须是非空字符串');
    }
    if (rawBody.description !== undefined && typeof rawBody.description !== 'string') {
      throw new BadRequestException('description 必须是字符串');
    }
    if (
      rawBody.baseType !== undefined &&
      (typeof rawBody.baseType !== 'string' || !STANDARD_TYPE_SET.has(rawBody.baseType))
    ) {
      throw new BadRequestException(
        `baseType 必须是 ${[...STANDARD_TYPE_SET].join(' / ')} 之一`,
      );
    }
    if (
      rawBody.defaultStage !== undefined &&
      (typeof rawBody.defaultStage !== 'string' || !DOCUMENT_STAGE_SET.has(rawBody.defaultStage))
    ) {
      throw new BadRequestException(
        `defaultStage 必须是 ${[...DOCUMENT_STAGE_SET].join(' / ')} 之一`,
      );
    }

    const validatedDefaultMeta =
      rawBody.defaultMeta !== undefined
        ? validateTemplateDefaultMeta(rawBody.defaultMeta, 'defaultMeta')
        : undefined;

    let normalizedNewContent: Record<string, unknown> | undefined;
    if (rawBody.content !== undefined) {
      validateTemplateContent(rawBody.content, 'content');
      normalizedNewContent = normalizeContent(
        rawBody.content,
      ) as unknown as Record<string, unknown>;
    }

    const updated = await this.writes.run(async () => {
      const current = await this.repo.findOne({ where: { id } });
      if (!current) throw new NotFoundException(`Template #${id} not found`);
      if (current.revision !== baseRevision) {
        throw revisionConflict(current.revision, baseRevision);
      }

      const effectiveBaseType =
        (rawBody.baseType as StandardType | undefined) ?? current.baseType;
      const hasCoverLayoutKey = Object.prototype.hasOwnProperty.call(
        rawBody,
        'coverLayout',
      );
      const effectiveCoverLayout = hasCoverLayoutKey
        ? rawBody.coverLayout
        : current.coverLayout;

      let validatedCoverLayout: CoverLayoutConfig | null = current.coverLayout;
      if (effectiveCoverLayout === null || effectiveCoverLayout === undefined) {
        validatedCoverLayout = null;
      } else {
        const check = validateCoverLayout(
          effectiveCoverLayout,
          effectiveBaseType,
          'coverLayout',
        );
        if (!check.valid) {
          throw new BadRequestException(check.errors[0]!.message);
        }
        validatedCoverLayout = check.value ?? null;
      }

      if (typeof rawBody.name === 'string') current.name = rawBody.name.trim();
      if (typeof rawBody.description === 'string') current.description = rawBody.description;
      current.baseType = effectiveBaseType;
      if (rawBody.defaultStage !== undefined) {
        current.defaultStage = rawBody.defaultStage as DocumentStage;
      }
      if (validatedDefaultMeta !== undefined) {
        current.defaultMeta = validatedDefaultMeta;
      }
      current.coverLayout = validatedCoverLayout;
      if (normalizedNewContent !== undefined) {
        current.previousContent = current.content;
        current.content = normalizedNewContent;
      }
      current.revision += 1;
      return this.repo.save(current);
    });

    this.events.publish({
      templateId: updated.id,
      uid: updated.uid,
      revision: updated.revision,
      action: 'updated',
      source,
      at: new Date().toISOString(),
    });
    return toStandardTemplate(updated);
  }

  async applyOperations(
    idParam: string | number,
    request: DocumentOperationsRequest,
  ): Promise<TemplateOperationsResult> {
    if (getBuiltinTemplate(String(idParam)) && String(idParam).startsWith('builtin:')) {
      throw new BadRequestException('内置只读模板不允许修改，请基于它派生新模板');
    }
    const id = parseNumericTemplateId(idParam);

    const outcome = await this.writes.run(async () => {
      const current = await this.repo.findOne({ where: { id } });
      if (!current) throw new NotFoundException(`Template #${id} not found`);
      if (current.revision !== request.baseRevision) {
        throw revisionConflict(current.revision, request.baseRevision);
      }

      const normalizedBefore = normalizeContent(current.content);
      const exec = applyDocumentOperations(normalizedBefore, request.operations, {
        validateContent: editorContentValidator,
      });
      if (!exec.ok) {
        const first = exec.issues[0];
        throw unprocessable(
          first ? `模板骨架操作不合法：${first.reason}` : '模板骨架操作不合法',
          { issues: exec.issues },
        );
      }

      current.previousContent = current.content;
      current.content = exec.doc as unknown as Record<string, unknown>;
      current.revision += 1;
      const saved = await this.repo.save(current);
      return { saved, exec };
    });

    this.events.publish({
      templateId: outcome.saved.id,
      uid: outcome.saved.uid,
      revision: outcome.saved.revision,
      action: 'updated',
      source: request.source === 'ai' ? 'agent' : 'human',
      at: new Date().toISOString(),
    });
    return {
      template: toStandardTemplate(outcome.saved),
      revision: outcome.saved.revision,
      operations: outcome.exec.operations,
      problems: outcome.exec.problems,
      warnings: outcome.exec.warnings,
    };
  }

  async revert(
    idParam: string | number,
    rawBaseRevision: unknown,
  ): Promise<StandardTemplate> {
    if (getBuiltinTemplate(String(idParam)) && String(idParam).startsWith('builtin:')) {
      throw new BadRequestException('内置只读模板不支持回退');
    }
    const baseRevision = parseBaseRevision(rawBaseRevision);
    const id = parseNumericTemplateId(idParam);

    const saved = await this.writes.run(async () => {
      const current = await this.repo.findOne({ where: { id } });
      if (!current) throw new NotFoundException(`Template #${id} not found`);
      if (current.revision !== baseRevision) {
        throw revisionConflict(current.revision, baseRevision);
      }
      if (!current.previousContent) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: 'no-previous-content',
          message: '没有可回退的最近一次修改快照',
          revision: current.revision,
        });
      }
      current.content = current.previousContent;
      current.previousContent = null;
      current.revision += 1;
      return this.repo.save(current);
    });

    this.events.publish({
      templateId: saved.id,
      uid: saved.uid,
      revision: saved.revision,
      action: 'updated',
      source: 'human',
      at: new Date().toISOString(),
    });
    return toStandardTemplate(saved);
  }

  async remove(idParam: string | number): Promise<void> {
    if (getBuiltinTemplate(String(idParam)) && String(idParam).startsWith('builtin:')) {
      throw new BadRequestException('内置只读模板不允许删除');
    }
    const id = parseNumericTemplateId(idParam);
    const deleted = await this.writes.run(async () => {
      const current = await this.repo.findOne({ where: { id } });
      if (!current) throw new NotFoundException(`Template #${id} not found`);
      await this.repo.delete(id);
      return current;
    });
    this.events.publish({
      templateId: deleted.id,
      uid: deleted.uid,
      revision: deleted.revision,
      action: 'deleted',
      source: 'human',
      at: new Date().toISOString(),
    });
  }

  async exportPackage(idParam: string | number): Promise<{
    bytes: Buffer;
    filename: string;
  }> {
    const template = await this.findOne(idParam);
    const pkg = buildTemplatePackage(template);
    const bytes = Buffer.from(JSON.stringify(pkg, null, 2), 'utf8');
    const safeName = (template.name || '模板')
      .replace(/[\\/:*?"<>|\r\n]+/g, '_')
      .trim();
    return { bytes, filename: `${safeName || '模板'}.sestpl` };
  }

  async previewImport(pkg: SesTemplatePackage): Promise<TemplateImportPreview> {
    const uid = pkg.template.uid.toLowerCase();
    const match = await this.writes.run(() =>
      this.repo
        .createQueryBuilder('template')
        .where('LOWER(template.uid) = :uid', { uid })
        .getOne(),
    );
    return {
      status: match ? 'match' : 'new',
      incoming: pkg.template,
      existing: match ? toStandardTemplate(match) : null,
    };
  }

  async importPackage(
    pkg: SesTemplatePackage,
    mode: 'new' | 'update',
    options: { targetId?: number; baseRevision?: number } = {},
  ): Promise<StandardTemplate> {
    const normalizedContent = normalizeContent(
      pkg.template.content,
    ) as unknown as Record<string, unknown>;

    if (mode === 'new') {
      const saved = await this.writes.run(async () => {
        const uid = pkg.template.uid.toLowerCase();
        const uidOccupied =
          (await this.repo
            .createQueryBuilder('template')
            .where('LOWER(template.uid) = :uid', { uid })
            .getCount()) > 0;
        const name = `${pkg.template.name}${uidOccupied ? '（导入副本）' : ''}`;
        const entity = this.repo.create({
          uid: uidOccupied ? randomUUID() : pkg.template.uid,
          name,
          description: pkg.template.description,
          baseType: pkg.template.baseType,
          defaultStage: pkg.template.defaultStage,
          defaultMeta: pkg.template.defaultMeta,
          coverLayout: pkg.template.coverLayout ?? null,
          content: normalizedContent,
          previousContent: null,
          source: 'import',
          revision: 0,
        });
        return this.repo.save(entity);
      });

      this.events.publish({
        templateId: saved.id,
        uid: saved.uid,
        revision: saved.revision,
        action: 'imported',
        source: 'import',
        at: new Date().toISOString(),
      });
      return toStandardTemplate(saved);
    }

    if (options.targetId === undefined) {
      throw new BadRequestException('update 模式必须提供 targetId');
    }
    const baseRevision = parseBaseRevision(options.baseRevision);
    const saved = await this.writes.run(async () => {
      const current = await this.repo.findOne({ where: { id: options.targetId } });
      if (!current) {
        throw new NotFoundException(`Template #${options.targetId} not found`);
      }
      if (current.revision !== baseRevision) {
        throw revisionConflict(current.revision, baseRevision);
      }
      if (current.uid.toLowerCase() !== pkg.template.uid.toLowerCase()) {
        throw new BadRequestException('目标模板 uid 与 .sestpl 模板包不匹配');
      }

      current.name = pkg.template.name;
      current.description = pkg.template.description;
      current.baseType = pkg.template.baseType;
      current.defaultStage = pkg.template.defaultStage;
      current.defaultMeta = pkg.template.defaultMeta;
      current.coverLayout = pkg.template.coverLayout ?? null;
      current.previousContent = current.content;
      current.content = normalizedContent;
      current.revision += 1;
      return this.repo.save(current);
    });

    this.events.publish({
      templateId: saved.id,
      uid: saved.uid,
      revision: saved.revision,
      action: 'imported',
      source: 'import',
      at: new Date().toISOString(),
    });
    return toStandardTemplate(saved);
  }

  async previewDocx(idParam: string | number): Promise<{
    bytes: Uint8Array;
    filename: string;
    warnings: unknown[];
  }> {
    const tpl = await this.findOne(idParam);
    const draft = instantiateTemplateDocument(tpl, {
      titleCn: tpl.name || '模板样稿',
    });
    const pmDoc = normalizeContent(draft.content);
    const guard = checkExportGuard(pmDoc, 'docx');
    if (guard) {
      throw unprocessable(guard.message, {
        source: guard.source,
        detail: guard.message,
        problems: guard.problems,
      });
    }
    try {
      const { bytes, warnings } = await buildDocx({
        pmDoc,
        documentMeta: draft.meta,
        stage: draft.stage,
        imageResources: { fetcher: () => Promise.reject(new Error('禁止访问外部资源')) },
      });
      const safeName = (tpl.name || '模板样稿').replace(/[\\/:*?"<>|\r\n]+/g, '_');
      return { bytes, warnings, filename: `${safeName}-样稿.docx` };
    } catch (error) {
      throw new InternalServerErrorException(
        `模板 DOCX 样稿生成失败：${(error as Error).message || error}`,
      );
    }
  }

  async previewPdf(idParam: string | number): Promise<{
    bytes: Uint8Array;
    filename: string;
    warnings: unknown[];
  }> {
    if (!PDF_EXPORT_ENABLED) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        code: 'pdf-export-disabled',
        message: PDF_EXPORT_DISABLED_MESSAGE,
      });
    }
    const tpl = await this.findOne(idParam);
    if (!this.convertService.getCapabilities().htmlToPdf) {
      const missing = this.convertService.getHtmlPdfMissingDependencies();
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        message:
          'PDF 样稿生成不可用：服务端缺少依赖' +
          (missing.length ? `：${missing.join('、')}` : ''),
        missingDependencies: missing,
      });
    }
    const draft = instantiateTemplateDocument(tpl, {
      titleCn: tpl.name || '模板样稿',
    });
    const pmDoc = normalizeContent(draft.content) as PMJsonNode;
    const guard = checkExportGuard(pmDoc, 'pdf');
    if (guard) {
      throw unprocessable(guard.message, {
        source: guard.source,
        detail: guard.message,
        problems: guard.problems,
      });
    }
    const warnings = blockExternalImages(pmDoc);
    const req = buildPdfExportRequest(pmDoc, irMetaFromDocumentMeta(draft.meta), {
      stage: draft.stage,
      coverLayout: draft.meta.coverLayout,
    });
    const bytes = await this.convertService.convertHtmlToPdf({
      html: req.html,
      toc: req.toc,
      docTitle: req.docTitle,
    });
    const safeName = (tpl.name || '模板样稿').replace(/[\\/:*?"<>|\r\n]+/g, '_');
    return { bytes, warnings, filename: `${safeName}-样稿.pdf` };
  }
}
