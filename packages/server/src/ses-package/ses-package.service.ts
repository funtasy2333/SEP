import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { WriteCoordinator } from '../common/write-coordinator';
import { DocumentEntity } from '../document/document.entity';
import {
  EXTERNAL_IMAGE_REJECTED_MESSAGE,
  isInlineImage,
} from '../export/external-images';
import type { ExportWarning } from '../export/export-http';
import { VersionEntity } from '../version/version.entity';
import { buildSesPackage } from './ses-package-format';

export interface SesPackageExportResult {
  bytes: Buffer;
  filename: string;
  warnings: ExportWarning[];
}

const DEFAULT_FILE_TITLE = '标准文件';
const IMAGE_NODE_TYPES = new Set(['figureImage', 'inlineImage', 'image']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 只读遍历图片节点。版本可能来自早期 schema，逐层判断 unknown、数组、attrs 与 content，
 * 遇到无法识别的结构就跳过该层，不影响整份文档包导出。
 */
function collectImageWarnings(root: unknown): ExportWarning[] {
  const warnings: ExportWarning[] = [];

  const visit = (value: unknown, inheritedNodeId?: string): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child, inheritedNodeId);
      return;
    }
    if (!isRecord(value)) return;

    const attrs = isRecord(value.attrs) ? value.attrs : undefined;
    const ownNodeId =
      typeof attrs?.nodeId === 'string' && attrs.nodeId !== ''
        ? attrs.nodeId
        : undefined;
    const nodeId = ownNodeId ?? inheritedNodeId;
    if (
      typeof value.type === 'string' &&
      IMAGE_NODE_TYPES.has(value.type) &&
      typeof attrs?.src === 'string' &&
      attrs.src !== '' &&
      !isInlineImage(attrs.src)
    ) {
      warnings.push({
        code: 'image-resource-failed',
        ...(nodeId === undefined ? {} : { nodeId }),
        message: EXTERNAL_IMAGE_REJECTED_MESSAGE,
      });
    }

    if (Array.isArray(value.content)) {
      for (const child of value.content) visit(child, nodeId);
    }
  };

  visit(root);
  return warnings;
}

@Injectable()
export class SesPackageService {
  constructor(
    @InjectRepository(DocumentEntity)
    private readonly documentRepo: Repository<DocumentEntity>,
    @InjectRepository(VersionEntity)
    private readonly versionRepo: Repository<VersionEntity>,
    private readonly writes: WriteCoordinator,
  ) {}

  /** 读取一个活动文档及其完整版本历史，构建 UTF-8 SES 包，不修改库中数据。 */
  async exportPackage(id: number): Promise<SesPackageExportResult> {
    const { document, versions } = await this.writes.run(async () => {
      const document = await this.documentRepo.findOne({
        where: { id, deletedAt: IsNull() },
      });
      if (!document) {
        throw new NotFoundException(`Document #${id} not found`);
      }

      const versions = await this.versionRepo
        .createQueryBuilder('version')
        .addSelect('version.baseContent')
        .where('version.documentId = :id', { id })
        .orderBy('version.createdAt', 'ASC')
        .addOrderBy('version.id', 'ASC')
        .getMany();

      return { document, versions };
    });

    const packageData = buildSesPackage(document, versions);
    const warnings = [
      ...collectImageWarnings(document.content),
      ...versions.flatMap((version) => [
        ...collectImageWarnings(version.content),
        ...collectImageWarnings(version.baseContent),
      ]),
    ];
    const bytes = Buffer.from(JSON.stringify(packageData, null, 2), 'utf8');

    return {
      bytes,
      filename: `${document.title?.trim() || DEFAULT_FILE_TITLE}.ses`,
      warnings,
    };
  }
}
