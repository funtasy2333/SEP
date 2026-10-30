import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { WriteCoordinator } from '../common/write-coordinator';
import { DocumentEntity } from '../document/document.entity';
import { isEmptyContent } from '../document/document-content';
import {
  revisionConflict,
  DocumentService,
} from '../document/document.service';
import {
  EXTERNAL_IMAGE_REJECTED_MESSAGE,
  isInlineImage,
} from '../export/external-images';
import type { ExportWarning } from '../export/export-http';
import { VersionEntity } from '../version/version.entity';
import { nextVersionNo } from '../version/version.service';
import { unprocessable } from '../common/http-errors';
import { buildSesPackage, type SesPackage } from './ses-package-format';

export interface SesPackageExportResult {
  bytes: Buffer;
  filename: string;
  warnings: ExportWarning[];
}

export interface SesImportPreview {
  match: { id: number; title: string; revision: number } | null;
  inTrash: boolean;
  newVersions: number;
  localOnlyVersions: number;
  contentDiffers: boolean;
  /** update 时是否会先把本地正文存为自动快照；与 importUpdate 用同一判定。 */
  createsSnapshot: boolean;
  versionNoCollisions: string[];
}

const DEFAULT_FILE_TITLE = '标准文件';
const IMAGE_NODE_TYPES = new Set(['figureImage', 'inlineImage', 'image']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON 键顺序不影响文档正文比较，数组顺序仍保留。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/**
 * update 是否需要先为本地正文建自动快照：本地正文与包正文不同，且没有任何已有版本（本地或包内）
 * 保存着同样的正文。后一条避免「本地未改动、只是对方改了」的常见往返也多出一条重复快照。
 */
function needsLocalSnapshot(
  localContent: unknown,
  packageContent: unknown,
  versions: ReadonlyArray<{ content: unknown }>,
): boolean {
  const localKey = stableStringify(localContent);
  if (localKey === stableStringify(packageContent)) return false;
  return !versions.some(
    (version) => stableStringify(version.content) === localKey,
  );
}

function isPortableDocumentContent(
  content: unknown,
): content is Record<string, unknown> {
  return isRecord(content) && content.type === 'doc';
}

/** 选下一个未占用版本号；nextVersionNo 在大整数精度耗尽时会停滞，需从 1.0 重新找空号。 */
function nextUnusedVersionNo(
  versions: readonly VersionEntity[],
  usedVersionNos: ReadonlySet<string>,
): string {
  const ordered = [...versions].sort(
    (left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime() ||
      right.id - left.id,
  );
  let candidate = nextVersionNo(ordered[0]?.versionNo);
  const seen = new Set<string>();
  while (usedVersionNos.has(candidate)) {
    if (seen.has(candidate)) break;
    seen.add(candidate);
    const next = nextVersionNo(candidate);
    if (next === candidate || seen.has(next)) break;
    candidate = next;
  }
  if (!usedVersionNos.has(candidate)) return candidate;

  candidate = nextVersionNo(undefined);
  while (usedVersionNos.has(candidate)) {
    const next = nextVersionNo(candidate);
    if (next === candidate) {
      throw new ConflictException('无法分配未占用的导入版本号');
    }
    candidate = next;
  }
  return candidate;
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
    private readonly documents: DocumentService,
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

    // 与其他出件一致：新建后从未写入正文的文档没有可打包的正文（导入也要求合法正文）。
    if (isEmptyContent(document.content)) {
      throw unprocessable(
        '文档内容为空，无法导出 SES 文档包；请先在编辑器中打开该文档并保存正文',
      );
    }
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

  /** 只读预览；查询排在在途写入之后，整个读取仅持有一次共享写锁。 */
  async previewImport(pkg: SesPackage): Promise<SesImportPreview> {
    return this.writes.run(async () => {
      const matches = await this.documentRepo
        .createQueryBuilder('document')
        .where('LOWER(document.uid) = :uid', {
          uid: pkg.document.uid.toLowerCase(),
        })
        .orderBy(
          'CASE WHEN document.deletedAt IS NULL THEN 0 ELSE 1 END',
          'ASC',
        )
        .addOrderBy('document.id', 'ASC')
        .getMany();
      const match = matches[0];
      if (!match) {
        return {
          match: null,
          inTrash: false,
          newVersions: pkg.versions.length,
          localOnlyVersions: 0,
          contentDiffers: false,
          createsSnapshot: false,
          versionNoCollisions: [],
        };
      }

      const localVersions = await this.versionRepo.find({
        where: { documentId: match.id },
      });
      const localUids = new Set(
        localVersions
          .map((version) => version.uid?.toLowerCase())
          .filter((uid): uid is string => uid !== undefined),
      );
      const packageUids = new Set(
        pkg.versions.map((version) => version.uid.toLowerCase()),
      );
      const newVersions = pkg.versions.filter(
        (version) => !localUids.has(version.uid.toLowerCase()),
      );
      const localOnlyVersions = [...localUids].filter(
        (uid) => !packageUids.has(uid),
      ).length;
      const localVersionNos = new Set(
        localVersions.map((version) => version.versionNo),
      );
      const versionNoCollisions = [
        ...new Set(
          newVersions
            .map((version) => version.versionNo)
            .filter((versionNo) => localVersionNos.has(versionNo)),
        ),
      ];

      return {
        match: {
          id: match.id,
          title: match.title,
          revision: match.revision,
        },
        inTrash: match.deletedAt !== null,
        newVersions: newVersions.length,
        localOnlyVersions,
        contentDiffers:
          stableStringify(match.content) !==
          stableStringify(pkg.document.content),
        createsSnapshot: needsLocalSnapshot(
          match.content,
          pkg.document.content,
          [...localVersions, ...pkg.versions],
        ),
        versionNoCollisions,
      };
    });
  }

  /** 在一个事务里新建文档并恢复包内版本；未知包字段不会进入实体。 */
  async importAsNew(pkg: SesPackage): Promise<DocumentEntity> {
    return this.documents.transaction(async (manager) => {
      const documentRepo = manager.getRepository(DocumentEntity);
      const uid = pkg.document.uid.toLowerCase();
      const uidOccupied =
        (await documentRepo
          .createQueryBuilder('document')
          .where('LOWER(document.uid) = :uid', { uid })
          .getCount()) > 0;
      const title = `${pkg.document.title}${uidOccupied ? '（导入副本）' : ''}`;
      const document = documentRepo.create({
        uid: uidOccupied ? randomUUID() : pkg.document.uid,
        title,
        meta: uidOccupied
          ? { ...pkg.document.meta, titleCn: title }
          : pkg.document.meta,
        stage: pkg.document.stage,
        content: pkg.document.content,
        revision: 0,
        deletedAt: null,
      });
      const savedDocument = await documentRepo.save(document);
      const versionRepo = manager.getRepository(VersionEntity);
      for (const version of pkg.versions) {
        await versionRepo.save(
          versionRepo.create({
            uid: version.uid,
            documentId: savedDocument.id,
            versionNo: version.versionNo,
            stage: version.stage,
            content: version.content,
            baseContent: version.baseContent,
            note: version.note,
            source: version.source,
            client: version.client,
            createdAt: new Date(version.createdAt),
          }),
        );
      }
      return savedDocument;
    });
  }

  /** 在单一事务内校验身份/revision、快照本地正文并合并版本，再覆盖文档当前状态。 */
  async importUpdate(
    pkg: SesPackage,
    targetId: number,
    baseRevision: number,
  ): Promise<DocumentEntity> {
    const updated = await this.documents.transaction(async (manager) => {
      const documentRepo = manager.getRepository(DocumentEntity);
      const current = await documentRepo.findOne({ where: { id: targetId } });
      if (!current)
        throw new NotFoundException(`Document #${targetId} not found`);

      // revision 检查先于回收站、身份和快照条件；409 时事务中尚无任何写入。
      if (current.revision !== baseRevision) {
        throw revisionConflict(current.revision, baseRevision);
      }
      if (current.deletedAt !== null) {
        throw new ConflictException('文档在回收站中，请先恢复后再导入更新');
      }
      if (
        current.uid === null ||
        current.uid.toLowerCase() !== pkg.document.uid.toLowerCase()
      ) {
        throw new BadRequestException('目标文档 uid 与 SES 包不匹配');
      }

      const versionRepo = manager.getRepository(VersionEntity);
      const localVersions = await versionRepo.find({
        where: { documentId: targetId },
        order: { createdAt: 'DESC', id: 'DESC' },
      });
      const createsSnapshot = needsLocalSnapshot(
        current.content,
        pkg.document.content,
        [...localVersions, ...pkg.versions],
      );
      // 快照要写入本地正文，先确认它可以成为版本，再做任何写入。
      if (createsSnapshot && !isPortableDocumentContent(current.content)) {
        const message =
          '本地正文无法创建自动快照，请先在编辑器保存合法正文或另存为新文档';
        throw unprocessable(message, {
          source: 'schema',
          detail: message,
          problems: [],
        });
      }

      const usedUids = new Set(
        localVersions
          .map((version) => version.uid?.toLowerCase())
          .filter((uid): uid is string => uid !== undefined),
      );
      const usedVersionNos = new Set(
        localVersions.map((version) => version.versionNo),
      );
      const versions = [...localVersions];

      // 先追加包内版本：它们的版本号只与本地已有版本比较（与 preview 的 versionNoCollisions 一致），
      // 不会被本次导入才产生的快照占用，同一版本在两端保持同一编号。
      for (const imported of pkg.versions) {
        const normalizedUid = imported.uid.toLowerCase();
        if (usedUids.has(normalizedUid)) continue;

        const hasCollision = usedVersionNos.has(imported.versionNo);
        const versionNo = hasCollision
          ? nextUnusedVersionNo(versions, usedVersionNos)
          : imported.versionNo;
        const note = hasCollision
          ? `原版本号 ${imported.versionNo}${imported.note === null ? '' : `；${imported.note}`}`
          : imported.note;
        const version = await versionRepo.save(
          versionRepo.create({
            uid: imported.uid,
            documentId: targetId,
            versionNo,
            stage: imported.stage,
            content: imported.content,
            baseContent: imported.baseContent,
            note,
            source: imported.source,
            client: imported.client,
            createdAt: new Date(imported.createdAt),
          }),
        );
        versions.push(version);
        usedUids.add(normalizedUid);
        usedVersionNos.add(versionNo);
      }

      // 快照只存在于本地，最后分配版本号。
      if (createsSnapshot) {
        await versionRepo.save(
          versionRepo.create({
            uid: randomUUID(),
            documentId: targetId,
            versionNo: nextUnusedVersionNo(versions, usedVersionNos),
            stage: current.stage,
            content: current.content,
            baseContent: null,
            note: '导入 .ses 前的本地正文（自动快照）',
            source: 'import',
            client: null,
          }),
        );
      }

      return this.documents.updateWithin(manager, targetId, baseRevision, {
        title: pkg.document.title,
        meta: pkg.document.meta,
        stage: pkg.document.stage,
        content: pkg.document.content,
      });
    });

    this.documents.publishChange(updated, { source: 'import' });
    return updated;
  }
}
