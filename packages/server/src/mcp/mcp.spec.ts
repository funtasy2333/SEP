/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call --
   工具结果是运行时解析出来的 JSON（形状因工具而异），用例按需逐字段断言，不为每种形状单独声明类型。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import { DocumentStage, StandardType } from '@ses/shared';
import { createNewDocument, type NewDocForm } from '@client/new-document';
import type { DocumentChangeEvent } from '../document/document-events.service';
import { DocumentEntity } from '../document/document.entity';
import { MAX_CLIENT_LENGTH } from '../version/version.service';
import {
  normalizeContent,
  normalizeContentDetailed,
} from '../editor-schema/editor-schema';
import { canonical, sampleDocument } from '../test-support/sample-documents';
import {
  connectMcp,
  TEST_CLIENT_INFO,
  type McpTestClient,
} from '../test-support/mcp-test-client';
import { createTestApp, type TestApp } from '../test-support/test-app';
import { MCP_INSTRUCTIONS } from './mcp.constants';

const AUTHORING_REFERENCE_PATH = join(
  __dirname,
  '../../../../docs/wp9-authoring-reference.md',
);

const SECRET = '机密正文-8f3a91';

/** 深拷贝并去掉所有节点的 nodeId 属性（nodeId 是随机生成的，比较内容时要忽略）。 */
function stripNodeIds<T>(value: T): T {
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => stripNodeIds(item)) as T;
  }
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'nodeId')
      .map(([key, item]) => [key, stripNodeIds(item)]),
  ) as T;
}
const meta = { titleCn: 'MCP 测试标准', standardType: 'national' };

describe('MCP 工具', () => {
  let t: TestApp;
  let mcp: McpTestClient;

  beforeEach(async () => {
    // 会话建立等日志在每个用例里都会出现，保持测试输出干净；需要检查日志的用例自行读取 mock 记录。
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    t = await createTestApp();
    mcp = await connectMcp(t);
  });
  afterEach(async () => {
    await mcp.close();
    await t.app.close();
    jest.restoreAllMocks();
    delete process.env.SES_EDITOR_BASE_URL;
  });

  /** 直接写库建一份带完整 nodeId 的示例文档（nodeId 见 sampleDocument 的说明）。 */
  async function createSampleDoc(
    content: Record<string, unknown> = canonical(sampleDocument()),
  ): Promise<number> {
    const created = await t.documents.create({
      title: 'MCP 测试标准',
      meta,
      stage: 'working_draft',
      content,
    });
    return created.id;
  }

  function collectEvents(id: number): DocumentChangeEvent[] {
    const collected: DocumentChangeEvent[] = [];
    t.events.events(id).subscribe((event) => collected.push(event));
    return collected;
  }

  // ---------------------------------------------------------------------------
  describe('initialize 与工具清单', () => {
    it('initialize：服务端信息、能力与工作流说明（instructions）', () => {
      expect(mcp.client.getServerVersion()).toMatchObject({ name: 'ses' });
      expect(mcp.client.getServerCapabilities()?.tools).toBeDefined();
      const instructions = mcp.client.getInstructions();
      expect(instructions).toBe(MCP_INSTRUCTIONS);
      // 工作流要点：先读写作说明；结构树 → 节点；baseRevision 取最近一次返回的 revision；冲突重读；
      // 写完用 validate_document 检查、用 export_document 出件；AI 修改可回滚。
      for (const keyword of [
        'get_authoring_reference',
        'get_outline',
        'get_node',
        'apply_operations',
        'baseRevision',
        'revision',
        '409',
        '重新读取',
        'validate_document',
        'export_document',
        'outputPath',
        'AI 修改',
        '回滚',
      ]) {
        expect(instructions).toContain(keyword);
      }
    });

    it('listTools：恰好 8 个工具，名称不带前缀', async () => {
      const { tools } = await mcp.client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'list_documents',
        'create_document',
        'get_outline',
        'get_node',
        'apply_operations',
        'validate_document',
        'export_document',
        'get_authoring_reference',
      ]);
    });

    it('listTools：描述是中文且写明用途；annotations 符合约定', async () => {
      const { tools } = await mcp.client.listTools();
      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

      for (const tool of tools) {
        expect(tool.description).toMatch(/[一-鿿]/);
        expect(tool.description!.length).toBeGreaterThan(30);
        expect(tool.annotations?.openWorldHint).toBe(false);
        expect(tool.outputSchema).toBeUndefined();
      }
      for (const name of [
        'list_documents',
        'get_outline',
        'get_node',
        'validate_document',
        'get_authoring_reference',
      ]) {
        expect(byName[name].annotations).toEqual({
          readOnlyHint: true,
          openWorldHint: false,
        });
      }
      expect(byName.create_document.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      });
      expect(byName.apply_operations.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      });
      // export_document 的 overwrite 可以替换用户机器上的文件。
      expect(byName.export_document.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      });
    });

    it('listTools：inputSchema 是对象 Schema，必填项与取值范围正确', async () => {
      const { tools } = await mcp.client.listTools();
      const schema = (name: string) =>
        tools.find((tool) => tool.name === name)!.inputSchema as {
          type: string;
          properties: Record<string, any>;
          required?: string[];
          additionalProperties?: boolean;
        };

      for (const tool of tools) {
        expect(tool.inputSchema.type).toBe('object');
        expect((tool.inputSchema as any).additionalProperties).toBe(false);
      }
      expect(schema('list_documents').properties).toEqual({});
      expect(schema('get_authoring_reference').properties).toEqual({});

      const create = schema('create_document');
      expect(create.required).toEqual(['titleCn', 'standardType']);
      expect(create.properties.standardType.enum).toEqual(
        Object.values(StandardType),
      );
      expect(create.properties.stage.enum).toEqual(
        Object.values(DocumentStage),
      );
      expect(Object.keys(create.properties)).toEqual(
        expect.arrayContaining([
          'titleCn',
          'standardType',
          'stage',
          'titleEn',
          'stdPrefix',
          'stdNo',
          'icsCode',
          'ccsCode',
          'issuer',
          'applicant',
          'proposer',
          'technicalCommittee',
          'replaces',
          'consistency',
          'industryName',
          'regionName',
          'coverDesignation',
        ]),
      );

      expect(schema('get_outline').required).toEqual(['documentId']);
      expect(schema('get_outline').properties.documentId.type).toBe('integer');

      const getNode = schema('get_node');
      expect(getNode.required).toEqual(['documentId']);
      expect(Object.keys(getNode.properties)).toEqual([
        'documentId',
        'nodeId',
        'container',
      ]);
      expect(getNode.properties.container.enum).toEqual([
        'foreword',
        'introduction',
        'bibliography',
      ]);

      const apply = schema('apply_operations');
      expect(apply.required).toEqual([
        'documentId',
        'baseRevision',
        'operations',
      ]);
      expect(Object.keys(apply.properties)).toEqual([
        'documentId',
        'baseRevision',
        'operations',
        'note',
      ]);
      // source、client 由服务端决定，不是 AI 可以填写的参数。
      expect(apply.properties).not.toHaveProperty('source');
      expect(apply.properties).not.toHaveProperty('client');
      expect(apply.properties.operations.items.properties.op.enum).toEqual([
        'insert',
        'replace',
        'delete',
        'move',
      ]);

      const validate = schema('validate_document');
      expect(validate.required).toEqual(['documentId']);
      expect(Object.keys(validate.properties)).toEqual(['documentId']);

      const exportSchema = schema('export_document');
      expect(exportSchema.required).toEqual(['documentId', 'format']);
      expect(Object.keys(exportSchema.properties)).toEqual([
        'documentId',
        'format',
        'outputPath',
        'overwrite',
      ]);
      expect(exportSchema.properties.format.enum).toEqual([
        'docx',
        'pdf',
        'html',
        'json',
      ]);
      expect(exportSchema.properties.outputPath.type).toBe('string');
      expect(exportSchema.properties.overwrite.type).toBe('boolean');
    });

    it('未知工具名：isError 结果（与 SDK McpServer 的处理一致），不是协议错误', async () => {
      for (const name of ['validate_doc', 'export_documents', 'nope']) {
        const result = await mcp.call(name, {});
        expect(result.isError).toBe(true);
        expect(result.body).toMatchObject({
          status: 404,
          code: 'tool-not-found',
        });
        expect(result.body.message).toContain(name);
        expect(result.body.message).toContain('list_documents');
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('create_document', () => {
    /** 工具参数 → 编辑器「新建文档」表单（未给出的字段为空串，阶段缺省为工作草案）。 */
    function formFor(args: Record<string, any>): NewDocForm {
      return {
        type: args.standardType,
        stage: args.stage ?? 'working_draft',
        stdPrefix: '',
        stdNo: '',
        titleCn: args.titleCn,
        titleEn: '',
        icsCode: '',
        ccsCode: '',
        issuer: '',
        applicant: '',
        proposer: '',
        technicalCommittee: '',
        replaces: '',
        consistency: '',
        industryName: '',
        regionName: '',
        coverDesignation: '',
        ...Object.fromEntries(
          Object.entries(args).filter(
            ([key]) => !['standardType', 'stage'].includes(key),
          ),
        ),
      } as NewDocForm;
    }

    const cases: Array<[string, Record<string, unknown>]> = [
      [
        '只给必填项的国家标准',
        { titleCn: '最小标准', standardType: 'national' },
      ],
      [
        '填满封面信息的行业标准（含阶段与首尾空白）',
        {
          titleCn: '  信息技术 标准化文件编辑系统 通用要求 ',
          standardType: 'industry',
          stage: 'review_draft',
          titleEn: 'Information technology — Editor — General requirements',
          stdPrefix: 'SJ/T',
          stdNo: '12345—2026',
          icsCode: '35.240.99',
          ccsCode: 'L 70',
          issuer: '工业和信息化部',
          applicant: '中国电子技术标准化研究院、某某大学',
          proposer: '工业和信息化部',
          technicalCommittee: '全国信息技术标准化技术委员会（SAC/TC 28）',
          replaces: 'SJ/T 1—2020',
          consistency: '（ISO 1234:2020，MOD）',
          industryName: '电子',
        },
      ],
      [
        '地方标准',
        {
          titleCn: '地方标准示例',
          standardType: 'local',
          stdPrefix: 'DB33/T',
          regionName: '浙江省',
          stage: 'comment_draft',
        },
      ],
      [
        '团体标准（覆盖封面称谓）',
        {
          titleCn: '团体标准示例',
          standardType: 'group',
          stdPrefix: 'T/ZSA',
          coverDesignation: '某某协会团体标准',
        },
      ],
      ['企业标准', { titleCn: '企业标准示例', standardType: 'enterprise' }],
      [
        '指导性技术文件',
        {
          titleCn: '指导性文件示例',
          standardType: 'guidance',
          stdNo: '99—2026',
        },
      ],
    ];

    it.each(cases)(
      '%s：与编辑器 createNewDocument 的结果一致（标题、阶段、meta 相同；正文只多了 nodeId 与 schema 缺省属性）',
      async (_name, args) => {
        const result = await mcp.call('create_document', args);
        expect(result.isError).toBe(false);
        const { documentId, revision, title, editorUrl } = result.body;
        expect(revision).toBe(0);
        expect(editorUrl).toBe(`http://localhost:5173/editor/${documentId}`);

        const expected = createNewDocument(formFor(args));
        expect(title).toBe(expected.title);

        // 库里保存的是 JSON，期望值先过一遍 JSON 往返（去掉 undefined 字段）。
        const expectedJson = JSON.parse(JSON.stringify(expected)) as {
          title: string;
          stage: string;
          meta: unknown;
          content: Record<string, unknown>;
        };
        const stored = await t.documents.findOne(documentId);
        expect(stored.revision).toBe(0);
        expect({
          title: stored.title,
          stage: stored.stage,
          meta: stored.meta,
        }).toEqual({
          title: expectedJson.title,
          stage: expectedJson.stage,
          meta: expectedJson.meta,
        });

        // 正文：createNewDocument 的输出没有 nodeId；这里保存的是同一份内容经过服务端规范化的结果
        // （编辑器打开文档后保存的也是这个形态：补上 nodeId 和 schema 的缺省属性）。
        // 1) createNewDocument 的每个节点、属性和文字都原样保留（原始内容是保存内容的子集）；
        expect(stored.content).toMatchObject(expectedJson.content);
        // 2) 多出来的只有 nodeId 与 schema 缺省属性：去掉 nodeId 后等于对原始内容单独做规范化；
        expect(stripNodeIds(stored.content)).toEqual(
          stripNodeIds(normalizeContent(expectedJson.content)),
        );
        // 3) 已经规范，之后的读取不会再补 nodeId、不会写库。
        expect(normalizeContentDetailed(stored.content).nodeIdsRepaired).toBe(
          false,
        );

        // 编辑器首页的做法：把 createNewDocument 的结果原样 POST 给 REST 接口（不带 nodeId，也不规范化）。
        // 标题、阶段、meta 与 MCP 创建的相同；正文规范化之后与 MCP 创建的相同。
        const viaRest = await t.http
          .post('/api/documents')
          .send(createNewDocument(formFor(args)))
          .expect(201);
        const restBody = viaRest.body as DocumentEntity;
        expect({
          title: restBody.title,
          stage: restBody.stage,
          meta: restBody.meta,
        }).toEqual({
          title: stored.title,
          stage: stored.stage,
          meta: stored.meta,
        });
        expect(restBody.content).toEqual(expectedJson.content);
        expect(normalizeContentDetailed(restBody.content).nodeIdsRepaired).toBe(
          true,
        );
        expect(stripNodeIds(stored.content)).toEqual(
          stripNodeIds(normalizeContent(restBody.content)),
        );
      },
    );

    it('返回 structuredContent，与文本正文相同', async () => {
      const result = await mcp.call('create_document', {
        titleCn: '结构化结果',
        standardType: 'national',
      });
      expect(result.structured).toEqual(result.body);
      expect(Object.keys(result.body).sort()).toEqual([
        'documentId',
        'editorUrl',
        'revision',
        'title',
      ]);
    });

    it('editorUrl 使用环境变量 SES_EDITOR_BASE_URL（去掉末尾斜杠；空白视为未设置）', async () => {
      process.env.SES_EDITOR_BASE_URL = 'https://ses.example.com:8443/';
      const custom = await mcp.call('create_document', {
        titleCn: '甲',
        standardType: 'national',
      });
      expect(custom.body.editorUrl).toBe(
        `https://ses.example.com:8443/editor/${custom.body.documentId}`,
      );

      process.env.SES_EDITOR_BASE_URL = '   ';
      const blank = await mcp.call('create_document', {
        titleCn: '乙',
        standardType: 'national',
      });
      expect(blank.body.editorUrl).toBe(
        `http://localhost:5173/editor/${blank.body.documentId}`,
      );
    });

    it('create_document 之后直接读取：revision 不变，没有规范化写入，没有变更事件', async () => {
      const { body: created } = await mcp.call('create_document', {
        titleCn: '可读写',
        standardType: 'national',
      });
      const events = collectEvents(created.documentId);

      const outline = await mcp.call('get_outline', {
        documentId: created.documentId,
      });
      expect(outline.isError).toBe(false);
      expect(outline.body.revision).toBe(created.revision);
      expect(outline.body.revision).toBe(0);
      const chapters = outline.body.outline.body.map(
        (item: { title: string }) => item.title,
      );
      expect(chapters).toEqual(['范围', '规范性引用文件', '术语和定义']);

      // 结构树里的 nodeId 可以直接用于读取，读取之后仍然没有写库。
      const first = outline.body.outline.body[0].nodeId as string;
      const node = await mcp.call('get_node', {
        documentId: created.documentId,
        nodeId: first,
      });
      expect(node.isError).toBe(false);
      expect(node.body.revision).toBe(0);
      const foreword = await mcp.call('get_node', {
        documentId: created.documentId,
        container: 'foreword',
      });
      expect(foreword.body.revision).toBe(0);

      expect((await t.documents.findOne(created.documentId)).revision).toBe(0);
      expect(events).toEqual([]);
    });

    it('create_document 之后直接用返回的 revision 调用 apply_operations：成功，revision 变为 1（不会 409）', async () => {
      const { body: created } = await mcp.call('create_document', {
        titleCn: '新建后立即写入',
        standardType: 'national',
      });
      expect(created.revision).toBe(0);
      const events = collectEvents(created.documentId);

      const applied = await mcp.call('apply_operations', {
        documentId: created.documentId,
        baseRevision: created.revision,
        operations: [
          {
            op: 'insert',
            parent: 'introduction',
            position: 'end',
            content: ['引言第一段。'],
          },
          {
            op: 'insert',
            parent: 'bibliography',
            position: 'end',
            content: ['GB/T 1.1—2020 标准化工作导则'],
          },
        ],
      });
      expect(applied.isError).toBe(false);
      expect(applied.body.revision).toBe(1);

      const stored = await t.documents.findOne(created.documentId);
      expect(stored.revision).toBe(1);
      expect(
        (stored.content as { content: Array<{ type: string }> }).content.map(
          (node) => node.type,
        ),
      ).toEqual([
        'coverPage',
        'foreword',
        'introduction',
        'chapter',
        'chapter',
        'chapter',
        'bibliography',
      ]);
      // 只有这一次 AI 写入：没有先发生的规范化写入（system 事件）。
      expect(events.map((event) => [event.source, event.revision])).toEqual([
        ['ai', 1],
      ]);
      const versions = await t.versions.findByDocument(created.documentId);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ source: 'ai' });
    });

    it.each([
      ['缺少 titleCn', { standardType: 'national' }, 'titleCn'],
      [
        'titleCn 为空白',
        { titleCn: '   ', standardType: 'national' },
        'titleCn',
      ],
      [
        'titleCn 不是字符串',
        { titleCn: 5, standardType: 'national' },
        'titleCn',
      ],
      ['缺少 standardType', { titleCn: '甲' }, 'standardType'],
      [
        '未知的 standardType',
        { titleCn: '甲', standardType: 'iso' },
        'standardType',
      ],
      [
        '未知的 stage',
        { titleCn: '甲', standardType: 'national', stage: 'draft' },
        'stage',
      ],
      [
        '可选字段不是字符串',
        { titleCn: '甲', standardType: 'national', icsCode: 35 },
        'icsCode',
      ],
      [
        '未知参数',
        { titleCn: '甲', standardType: 'national', title_cn: '乙' },
        'title_cn',
      ],
    ])(
      '参数错误（%s）：isError 400，不创建文档',
      async (_name, args, field) => {
        const result = await mcp.call('create_document', args);
        expect(result.isError).toBe(true);
        expect(result.body.status).toBe(400);
        expect(result.body.message).toContain(field);
        expect(await t.documents.findAll()).toEqual([]);
      },
    );
  });

  // ---------------------------------------------------------------------------
  describe('list_documents', () => {
    it('没有文档时返回空列表', async () => {
      const result = await mcp.call('list_documents');
      expect(result.isError).toBe(false);
      expect(result.body).toEqual({ documents: [] });
      expect(result.structured).toEqual({ documents: [] });
    });

    it('每项只有 id、title、stage、revision、updatedAt，不含 meta 与正文', async () => {
      const id = await createSampleDoc(
        canonical(
          // 正文里放一个特征串：整个返回文本都不应出现它
          JSON.parse(
            JSON.stringify(sampleDocument()).replace('前言第一段。', SECRET),
          ),
        ),
      );
      const created = await mcp.call('create_document', {
        titleCn: '另一份',
        standardType: 'group',
      });
      expect(created.isError).toBe(false);

      const result = await mcp.call('list_documents');
      const { documents } = result.body as {
        documents: Array<Record<string, unknown>>;
      };
      expect(documents).toHaveLength(2);
      for (const item of documents) {
        expect(Object.keys(item).sort()).toEqual([
          'id',
          'revision',
          'stage',
          'title',
          'updatedAt',
        ]);
        expect(new Date(item.updatedAt as string).toISOString()).toBe(
          item.updatedAt,
        );
      }
      const byId = Object.fromEntries(documents.map((d) => [d.id, d]));
      expect(byId[id]).toMatchObject({
        title: 'MCP 测试标准',
        stage: 'working_draft',
        revision: 0,
      });
      const text = JSON.stringify(result.body);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain('"content"');
      expect(text).not.toContain('"meta"');
    });

    it('只查询摘要列，不经过读取整篇文档的 findAll', async () => {
      await createSampleDoc();
      const findAll = jest.spyOn(t.documents, 'findAll');
      const find = jest.spyOn(
        t.dataSource.getRepository(DocumentEntity),
        'find',
      );
      await mcp.call('list_documents');
      expect(findAll).not.toHaveBeenCalled();
      expect(find).toHaveBeenCalledTimes(1);
      const options = find.mock.calls[0][0];
      expect(options?.select).toEqual({
        id: true,
        title: true,
        stage: true,
        revision: true,
        updatedAt: true,
      });
    });

    it('最近修改的在前', async () => {
      const first = await createSampleDoc();
      const second = await createSampleDoc();
      const third = await createSampleDoc();
      await t.dataSource.query(
        `UPDATE documents SET updatedAt = '2024-01-01 00:00:00' WHERE id = ${second}`,
      );
      await t.dataSource.query(
        `UPDATE documents SET updatedAt = '2025-01-01 00:00:00' WHERE id = ${first}`,
      );
      await t.dataSource.query(
        `UPDATE documents SET updatedAt = '2026-01-01 00:00:00' WHERE id = ${third}`,
      );
      const { body } = await mcp.call('list_documents');
      expect(body.documents.map((d: { id: number }) => d.id)).toEqual([
        third,
        first,
        second,
      ]);
    });

    it('revision 反映写入后的值', async () => {
      const id = await createSampleDoc();
      await mcp.call('apply_operations', {
        documentId: id,
        baseRevision: 0,
        operations: [{ op: 'delete', nodeId: 'p-extra' }],
      });
      const { body } = await mcp.call('list_documents');
      expect(body.documents[0]).toMatchObject({ id, revision: 1 });
    });

    it('多余参数 400', async () => {
      const result = await mcp.call('list_documents', { limit: 5 });
      expect(result.isError).toBe(true);
      expect(result.body.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  describe('get_outline 与 get_node', () => {
    it('get_outline：返回 { revision, outline }，与 DocumentOpsService.outline 一致', async () => {
      const id = await createSampleDoc();
      const result = await mcp.call('get_outline', { documentId: id });
      expect(result.isError).toBe(false);
      expect(result.body).toEqual(
        JSON.parse(JSON.stringify(await t.ops.outline(id))),
      );
      expect(result.structured).toEqual(result.body);
      expect(result.body.revision).toBe(0);
      expect(
        result.body.outline.body.map((item: { nodeId: string }) => item.nodeId),
      ).toEqual(['ch-scope', 'ch-req', 'ch-extra']);
    });

    it('get_node：用 nodeId 读取，返回 { revision, node }', async () => {
      const id = await createSampleDoc();
      const result = await mcp.call('get_node', {
        documentId: id,
        nodeId: 'cl-2',
      });
      expect(result.isError).toBe(false);
      expect(result.body).toEqual(
        JSON.parse(JSON.stringify(await t.ops.node(id, 'cl-2'))),
      );
      expect(result.body).not.toHaveProperty('container');
      expect(result.body.node).toMatchObject({
        nodeId: 'cl-2',
        kind: 'clause',
        number: '2.2',
        replaceable: true,
      });
    });

    it('get_node：用 container 读取，返回 { revision, container }', async () => {
      const id = await createSampleDoc();
      const result = await mcp.call('get_node', {
        documentId: id,
        container: 'foreword',
      });
      expect(result.isError).toBe(false);
      expect(result.body).toEqual(
        JSON.parse(JSON.stringify(await t.ops.container(id, 'foreword'))),
      );
      expect(result.body).not.toHaveProperty('node');
      expect(result.body.container).toMatchObject({
        container: 'foreword',
        exists: true,
      });

      const absent = await mcp.call('get_node', {
        documentId: id,
        container: 'bibliography',
      });
      expect(absent.body.container).toMatchObject({
        container: 'bibliography',
        exists: false,
        nodes: [],
      });
    });

    it('get_node：nodeId 与 container 必须恰好给一个', async () => {
      const id = await createSampleDoc();
      const both = await mcp.call('get_node', {
        documentId: id,
        nodeId: 'cl-1',
        container: 'foreword',
      });
      expect(both.isError).toBe(true);
      expect(both.body.status).toBe(400);
      expect(both.body.message).toContain('恰好');

      const neither = await mcp.call('get_node', { documentId: id });
      expect(neither.isError).toBe(true);
      expect(neither.body.status).toBe(400);
      expect(neither.body.message).toContain('恰好');
    });

    it('get_node：未知 nodeId 404 并带 code；表内部节点 422；非法容器 400', async () => {
      const id = await createSampleDoc();

      const missing = await mcp.call('get_node', {
        documentId: id,
        nodeId: 'no-such-node',
      });
      expect(missing.isError).toBe(true);
      expect(missing.body).toMatchObject({
        status: 404,
        code: 'node-not-found',
      });
      expect(missing.body.message).toContain('no-such-node');

      const inner = await mcp.call('get_node', {
        documentId: id,
        nodeId: 'tbl-1-r1c1',
      });
      expect(inner.isError).toBe(true);
      expect(inner.body).toMatchObject({
        status: 422,
        code: 'node-not-addressable',
      });
      expect(inner.body.message).toContain('tbl-1');

      const badContainer = await mcp.call('get_node', {
        documentId: id,
        container: 'body',
      });
      expect(badContainer.isError).toBe(true);
      expect(badContainer.body).toMatchObject({
        status: 400,
        code: 'invalid-container',
      });
    });

    it('get_node：nodeId 或 container 为空串、类型不对 → 400', async () => {
      const id = await createSampleDoc();
      for (const extra of [
        { nodeId: '' },
        { nodeId: 5 },
        { container: '' },
        { container: ['foreword'] },
      ]) {
        const result = await mcp.call('get_node', { documentId: id, ...extra });
        expect(result.isError).toBe(true);
        expect(result.body.status).toBe(400);
      }
    });

    it('未知文档 404；documentId 缺失或不是正整数 400', async () => {
      for (const [tool, args] of [
        ['get_outline', {}],
        ['get_node', { nodeId: 'x' }],
        ['get_node', { container: 'foreword' }],
      ] as const) {
        const unknown = await mcp.call(tool, { documentId: 99999, ...args });
        expect(unknown.isError).toBe(true);
        expect(unknown.body.status).toBe(404);
      }
      for (const documentId of [undefined, 0, -3, 1.5, '1', null]) {
        const result = await mcp.call('get_outline', { documentId });
        expect(result.isError).toBe(true);
        expect(result.body.status).toBe(400);
        expect(result.body.message).toContain('documentId');
      }
    });

    it('文档内容为空 → 422', async () => {
      const created = await t.documents.create({
        title: '空',
        meta,
        stage: 'working_draft',
      });
      const result = await mcp.call('get_outline', { documentId: created.id });
      expect(result.isError).toBe(true);
      expect(result.body.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------------------
  describe('apply_operations', () => {
    const insertClause = (id = 'cl-new') => ({
      op: 'insert',
      parent: 'ch-req',
      position: { after: 'cl-2' },
      content: [
        { kind: 'clause', id, title: '新增条', children: ['新增条正文。'] },
      ],
    });

    it('成功：revision 加 1，生成 source=ai 的版本记录，client 为该会话的 clientInfo.name', async () => {
      const id = await createSampleDoc();
      const events = collectEvents(id);

      const result = await mcp.call('apply_operations', {
        documentId: id,
        baseRevision: 0,
        operations: [insertClause()],
        note: '补充一条',
      });
      expect(result.isError).toBe(false);
      expect(result.body.revision).toBe(1);
      expect(result.body.operations).toHaveLength(1);
      expect(result.body.operations[0]).toMatchObject({
        index: 0,
        op: 'insert',
      });
      expect(result.body.operations[0].inserted).toContain('cl-new');
      expect(result.body.problems).toBeInstanceOf(Array);
      expect(result.body.warnings).toEqual([]);
      expect(typeof result.body.versionId).toBe('number');
      expect(result.structured).toEqual(result.body);

      // 文档
      const stored = await t.documents.findOne(id);
      expect(stored.revision).toBe(1);
      const outline = await mcp.call('get_outline', { documentId: id });
      expect(outline.body.revision).toBe(1);

      // 版本记录
      const versions = await t.versions.findByDocument(id);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({
        id: result.body.versionId,
        documentId: id,
        source: 'ai',
        client: TEST_CLIENT_INFO.name,
        note: '补充一条',
      });
      const detail = await t.versions.findOne(result.body.versionId);
      expect(detail.baseContent).toEqual(canonical(sampleDocument()));
      expect(detail.content).toEqual(stored.content);

      // 变更事件
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        documentId: id,
        revision: 1,
        source: 'ai',
        client: TEST_CLIENT_INFO.name,
      });
    });

    it('没有 note 时自动生成摘要；可连续写入，每次以返回的 revision 为 baseRevision', async () => {
      const id = await createSampleDoc();
      const first = await mcp.call('apply_operations', {
        documentId: id,
        baseRevision: 0,
        operations: [insertClause('cl-a')],
      });
      const second = await mcp.call('apply_operations', {
        documentId: id,
        baseRevision: first.body.revision,
        operations: [
          { op: 'replace', nodeId: 'p-scope', content: ['改写后的范围。'] },
          { op: 'delete', nodeId: 'p-extra' },
        ],
      });
      expect(second.isError).toBe(false);
      expect(second.body.revision).toBe(2);
      const versions = await t.versions.findByDocument(id);
      expect(versions.map((v) => v.note)).toEqual([
        'AI 修改：替换 1 处、删除 1 处',
        'AI 修改：插入 1 处',
      ]);
    });

    it('过期的 baseRevision：isError 409，带当前 revision，提示重新读取；文档与版本不变', async () => {
      const id = await createSampleDoc();
      await mcp.call('apply_operations', {
        documentId: id,
        baseRevision: 0,
        operations: [insertClause()],
      });

      const stale = await mcp.call('apply_operations', {
        documentId: id,
        baseRevision: 0,
        operations: [{ op: 'delete', nodeId: 'p-extra' }],
      });
      expect(stale.isError).toBe(true);
      expect(stale.body.status).toBe(409);
      expect(stale.body.revision).toBe(1);
      expect(stale.body.message).toContain('请重新读取后再修改');
      expect((await t.documents.findOne(id)).revision).toBe(1);
      expect(await t.versions.findByDocument(id)).toHaveLength(1);
    });

    it('操作不合法：整批不写入，isError 带逐项 issues', async () => {
      const id = await createSampleDoc();

      // 形状错误（400）
      const shape = await mcp.call('apply_operations', {
        documentId: id,
        baseRevision: 0,
        operations: [{ op: 'delete', nodeId: 'p-extra' }, { op: 'explode' }],
      });
      expect(shape.isError).toBe(true);
      expect(shape.body.status).toBe(400);
      expect(shape.body.issues).toEqual([
        expect.objectContaining({
          operationIndex: 1,
          code: 'unknown-operation',
          path: 'operations[1].op',
        }),
      ]);

      // 引擎拒绝（422）：节点不存在；第一个操作本身合法，也不能写入
      const engine = await mcp.call('apply_operations', {
        documentId: id,
        baseRevision: 0,
        operations: [
          { op: 'delete', nodeId: 'p-extra' },
          { op: 'delete', nodeId: 'no-such-node' },
        ],
      });
      expect(engine.isError).toBe(true);
      expect(engine.body.status).toBe(422);
      expect(engine.body.issues).toEqual([
        expect.objectContaining({
          code: 'node-not-found',
          operationIndex: 1,
        }),
      ]);

      // 片段不合法（422）
      const fragment = await mcp.call('apply_operations', {
        documentId: id,
        baseRevision: 0,
        operations: [
          {
            op: 'insert',
            parent: 'ch-extra',
            position: 'end',
            content: [{ kind: 'quote', content: ['暂不支持'] }],
          },
        ],
      });
      expect(fragment.isError).toBe(true);
      expect(fragment.body.status).toBe(422);
      expect(fragment.body.issues[0].code).toBe('unsupported-kind');

      expect((await t.documents.findOne(id)).revision).toBe(0);
      expect(await t.versions.findByDocument(id)).toEqual([]);
    });

    it.each([
      [
        '缺少 baseRevision',
        { operations: [{ op: 'delete', nodeId: 'x' }] },
        428,
      ],
      [
        'baseRevision 不是非负整数',
        { baseRevision: -1, operations: [{ op: 'delete', nodeId: 'x' }] },
        400,
      ],
      ['缺少 operations', { baseRevision: 0 }, 400],
      ['operations 为空数组', { baseRevision: 0, operations: [] }, 400],
      [
        'operations 不是数组',
        { baseRevision: 0, operations: { op: 'delete', nodeId: 'x' } },
        400,
      ],
      [
        'note 超长',
        {
          baseRevision: 0,
          operations: [{ op: 'delete', nodeId: 'x' }],
          note: 'n'.repeat(501),
        },
        400,
      ],
      [
        'note 不是字符串',
        {
          baseRevision: 0,
          operations: [{ op: 'delete', nodeId: 'x' }],
          note: 5,
        },
        400,
      ],
    ])('参数错误（%s）→ isError %i', async (_name, args, status) => {
      const id = await createSampleDoc();
      const result = await mcp.call('apply_operations', {
        documentId: id,
        ...args,
      });
      expect(result.isError).toBe(true);
      expect(result.body.status).toBe(status);
      expect((await t.documents.findOne(id)).revision).toBe(0);
    });

    it('不接受 source、client 等未声明的参数（AI 不能自称人工修改或冒用他人身份）', async () => {
      const id = await createSampleDoc();
      for (const extra of [{ source: 'human' }, { client: '别的客户端' }]) {
        const result = await mcp.call('apply_operations', {
          documentId: id,
          baseRevision: 0,
          operations: [{ op: 'delete', nodeId: 'p-extra' }],
          ...extra,
        });
        expect(result.isError).toBe(true);
        expect(result.body.status).toBe(400);
        expect(result.body.message).toContain(Object.keys(extra)[0]);
      }
      expect((await t.documents.findOne(id)).revision).toBe(0);
    });

    it('未知文档 404', async () => {
      const result = await mcp.call('apply_operations', {
        documentId: 424242,
        baseRevision: 0,
        operations: [{ op: 'delete', nodeId: 'x' }],
      });
      expect(result.isError).toBe(true);
      expect(result.body.status).toBe(404);
    });

    it('走现有的 DocumentOpsService.apply：请求体来源固定为 ai，client 经过清洗', async () => {
      const id = await createSampleDoc();
      const apply = jest.spyOn(t.ops, 'apply');
      await mcp.call('apply_operations', {
        documentId: id,
        baseRevision: 0,
        operations: [{ op: 'delete', nodeId: 'p-extra' }],
        note: '说明',
      });
      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith(id, {
        baseRevision: 0,
        operations: [{ op: 'delete', nodeId: 'p-extra' }],
        source: 'ai',
        client: TEST_CLIENT_INFO.name,
        note: '说明',
      });
    });

    describe('clientInfo.name 的清洗', () => {
      async function writeAs(name: string): Promise<{
        version: { client: string | null };
        event: DocumentChangeEvent;
      }> {
        const other = await connectMcp(t, { name, version: '1' });
        try {
          const id = await createSampleDoc();
          const events = collectEvents(id);
          const result = await other.call('apply_operations', {
            documentId: id,
            baseRevision: 0,
            operations: [{ op: 'delete', nodeId: 'p-extra' }],
          });
          expect(result.isError).toBe(false);
          const [version] = await t.versions.findByDocument(id);
          return { version, event: events[0] };
        } finally {
          await other.close();
        }
      }

      it('去掉控制字符与首尾空白', async () => {
        const { version, event } = await writeAs(
          ' \tbad\u0007\nclient\u0000‮ ',
        );
        expect(version.client).toBe('badclient');
        expect(event.client).toBe('badclient');
      });

      it(`超长截断到 ${MAX_CLIENT_LENGTH} 个字符`, async () => {
        const { version, event } = await writeAs('长'.repeat(500));
        expect(version.client).toBe('长'.repeat(MAX_CLIENT_LENGTH));
        expect(event.client).toBe('长'.repeat(MAX_CLIENT_LENGTH));
      });

      it('清洗后为空则用 mcp', async () => {
        for (const name of ['', '   ', '\n\t\u0007']) {
          const { version, event } = await writeAs(name);
          expect(version.client).toBe('mcp');
          expect(event.client).toBe('mcp');
        }
      });

      it('每个会话用自己的名称', async () => {
        const id = await createSampleDoc();
        const alpha = await connectMcp(t, { name: 'alpha', version: '1' });
        const beta = await connectMcp(t, { name: 'beta', version: '1' });
        try {
          await alpha.call('apply_operations', {
            documentId: id,
            baseRevision: 0,
            operations: [{ op: 'delete', nodeId: 'p-extra' }],
          });
          await beta.call('apply_operations', {
            documentId: id,
            baseRevision: 1,
            operations: [{ op: 'delete', nodeId: 'p-scope' }],
          });
        } finally {
          await alpha.close();
          await beta.close();
        }
        const versions = await t.versions.findByDocument(id);
        expect(versions.map((v) => v.client)).toEqual(['beta', 'alpha']);
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('get_authoring_reference', () => {
    it('原样返回 docs/wp9-authoring-reference.md 全文（与磁盘文件逐字相同）', async () => {
      const onDisk = readFileSync(AUTHORING_REFERENCE_PATH, 'utf-8');
      expect(onDisk.length).toBeGreaterThan(10_000);

      const result = await mcp.client.callTool({
        name: 'get_authoring_reference',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content).toHaveLength(1);
      expect(content[0].type).toBe('text');
      expect(content[0].text).toBe(onDisk);
      // 不是 JSON 包装，也没有 structuredContent
      expect(result.structuredContent).toBeUndefined();
    });

    it('多余参数 400', async () => {
      const result = await mcp.call('get_authoring_reference', { lang: 'en' });
      expect(result.isError).toBe(true);
      expect(result.body.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  describe('错误处理与日志', () => {
    it('意外异常：通用的「服务端内部错误」，不泄露堆栈与内部信息；日志只记工具名与错误类型', async () => {
      const id = await createSampleDoc();
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      jest
        .spyOn(t.ops, 'outline')
        .mockRejectedValueOnce(
          new Error('SQLITE_CORRUPT at /srv/ses/data/ses.db 机密-细节'),
        );

      const result = await mcp.call('get_outline', { documentId: id });
      expect(result.isError).toBe(true);
      expect(result.body).toEqual({ status: 500, message: '服务端内部错误' });

      expect(error).toHaveBeenCalledTimes(1);
      const logged = error.mock.calls[0].map(String).join(' ');
      expect(logged).toContain('get_outline');
      expect(logged).toContain('Error');
      expect(logged).not.toMatch(/SQLITE|srv|机密/);
    });

    it('服务层的 5xx HttpException 同样只返回通用消息', async () => {
      const id = await createSampleDoc();
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
      jest
        .spyOn(t.ops, 'outline')
        .mockRejectedValueOnce(new InternalServerErrorException('内部细节'));
      const result = await mcp.call('get_outline', { documentId: id });
      expect(result.body).toEqual({ status: 500, message: '服务端内部错误' });
    });

    it('日志不含文档标题、正文、操作内容', async () => {
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
        (level) => jest.spyOn(Logger.prototype, level).mockImplementation(),
      );

      const created = await mcp.call('create_document', {
        titleCn: `${SECRET}标题`,
        standardType: 'national',
        applicant: `${SECRET}单位`,
      });
      const id = created.body.documentId as number;
      const outline = await mcp.call('get_outline', { documentId: id });
      const target = outline.body.outline.body[0].nodeId as string;
      await mcp.call('apply_operations', {
        documentId: id,
        baseRevision: outline.body.revision,
        operations: [
          {
            op: 'insert',
            parent: target,
            position: 'end',
            content: [`${SECRET}段落`],
          },
        ],
        note: `${SECRET}说明`,
      });
      // 失败路径：非法操作、过期 revision、未知工具
      await mcp.call('apply_operations', {
        documentId: id,
        baseRevision: 0,
        operations: [{ op: 'delete', nodeId: `${SECRET}不存在` }],
      });
      await mcp.call('apply_operations', {
        documentId: id,
        baseRevision: outline.body.revision + 1,
        operations: [{ op: 'delete', nodeId: `${SECRET}不存在` }],
      });
      await mcp.call(`${SECRET}_tool`, {});

      const logged = spies
        .flatMap((spy) => spy.mock.calls)
        .map((args) => args.map(String).join(' '))
        .join('\n');
      expect(logged).not.toContain(SECRET);
      expect(logged).toContain(TEST_CLIENT_INFO.name); // clientInfo 允许出现
    });
  });
});
