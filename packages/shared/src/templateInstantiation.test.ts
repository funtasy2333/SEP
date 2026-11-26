import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TEMPLATES,
  createNewDocument,
  getBuiltinTemplate,
  instantiateTemplateDocument,
  replaceTemplatePlaceholders,
} from './templateInstantiation';
import { DocumentStage, StandardType } from './types/document';
import type { StandardTemplate } from './types/template';
import { pmToIr, type PMJsonNode } from './ir/pmToIr';
import { collectFootnotes } from './ir/footnotes';

const SAMPLE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('templateInstantiation', () => {
  it.each(['block', 'root', 'cover'] as const)('reconciles imported structured metadata from %s on instantiation', (source) => {
    const titleParts = [
      { id: 'zh', lang: 'zh', role: 'full', content: [{ text: '旧标题' }] },
      { id: 'en', lang: 'en', role: 'main', content: [{ text: 'Old title' }] },
      { id: 'fr', lang: 'fr', role: 'full', content: [{ text: 'Titre' }] },
    ];
    const identifiers = [
      { id: 'ident', parts: [{ id: 'number', kind: 'doc-number', content: [{ text: '123' }] }] },
      { id: 'dated', scheme: 'dated', value: 'GB/T 123—2020', parts: [] },
      { id: 'undated', scheme: 'undated', value: 'GB/T 123', parts: [] },
    ];
    const publishers = [
      { id: 'a', name: [{ text: '机构甲', marks: [{ type: 'bold' }] }], role: 'publisher', identifier: 'A' },
      { id: 'b', name: [{ text: '机构乙' }], role: 'publisher', identifier: 'B' },
    ];
    const structured = { titleParts, identifiers, publishers };
    const block: PMJsonNode = { type: 'metadataBlock', content: [
      ...titleParts.map(p => ({ type: 'titlePart', attrs: { nodeId: p.id, lang: p.lang, role: p.role }, content: p.content.map(x => ({ type: 'text', ...x })) })),
      ...identifiers.map(i => ({ type: 'standardIdentifier', attrs: { nodeId: i.id, scheme: i.scheme, value: i.value }, content: i.parts.map(p => ({ type: 'identifierPart', attrs: { nodeId: p.id, kind: p.kind }, content: p.content.map(x => ({ type: 'text', ...x })) })) })),
      ...publishers.map(p => ({ type: 'publisher', attrs: { nodeId: p.id, role: p.role, identifier: p.identifier }, content: p.name.map(x => ({ type: 'text', ...x })) })),
      { type: 'language', attrs: { tag: 'zh' } },
    ] };
    const content = { type: 'doc', ...(source === 'root' ? { attrs: structured } : {}), content: [
      { type: 'coverPage', attrs: source === 'cover' ? structured : {}, content: [{ type: 'paragraph' }] },
      ...(source === 'block' ? [block] : []),
    ] };
    const template = { ...BUILTIN_TEMPLATES[0]!, readonly: false, content } as StandardTemplate;
    const original = JSON.stringify(template);
    const instantiated = instantiateTemplateDocument(template, { titleCn: '新标题', titleEn: 'New title', stdPrefix: 'GB/T', stdNo: '456—2026', issuer: '机构乙\n机构丙' });
    const ir = pmToIr(instantiated.content as PMJsonNode).doc;
    expect(ir.meta.title).toBe('新标题');
    expect(ir.meta.titleEn).toBe('New title');
    expect(ir.meta.titleParts?.map(p => p.lang)).toEqual(['fr']);
    expect(ir.meta.stdCode).toBe('GB/T 456—2026');
    expect(ir.meta.identifiers ?? []).toEqual([]);
    expect(ir.meta.publishers?.map(p => [p.name.map(r => r.text).join(''), p.identifier])).toEqual([['机构乙', 'B']]);
    expect(ir.meta.issuer).toBe('机构乙\n机构丙');
    expect(JSON.stringify(template)).toBe(original);
  });

  it('removes structured titles and publishers when explicitly cleared', () => {
    const template = { ...BUILTIN_TEMPLATES[0]!, readonly: false, content: { type: 'doc', content: [
      { type: 'coverPage', attrs: {}, content: [{ type: 'paragraph' }] },
      { type: 'metadataBlock', content: [
        { type: 'titlePart', attrs: { lang: 'en', role: 'full' }, content: [{ type: 'text', text: 'Old title' }] },
        { type: 'publisher', attrs: { identifier: 'OLD' }, content: [{ type: 'text', text: 'Old publisher' }] },
      ] },
    ] } } as StandardTemplate;
    const instantiated = instantiateTemplateDocument(template, { titleCn: '新标题', titleEn: '', issuer: '' });
    const meta = pmToIr(instantiated.content as PMJsonNode).doc.meta;
    expect(meta.titleParts ?? []).toEqual([]);
    expect(meta.publishers ?? []).toEqual([]);
    expect(meta.titleEn).toBeUndefined();
    expect(meta.issuer).toBeUndefined();
  });

  it('uses new cover values instead of legacy root scalars', () => {
    const template = { ...BUILTIN_TEMPLATES[0]!, readonly: false, content: { type: 'doc', attrs: { titleCn: '旧', titleEn: 'Old', standardNo: 'GB/T 1—2020', standardType: 'group' }, content: [
      { type: 'coverPage', attrs: {}, content: [{ type: 'paragraph' }] },
    ] } } as StandardTemplate;
    const doc = instantiateTemplateDocument(template, { titleCn: '新', titleEn: '', stdPrefix: 'GB/T', stdNo: '2—2026' });
    expect(pmToIr(doc.content as PMJsonNode).doc.meta).toMatchObject({ title: '新', stdCode: 'GB/T 2—2026', standardType: 'gb' });
    expect(pmToIr(doc.content as PMJsonNode).doc.meta.titleEn).toBeUndefined();
  });

  it('retains matching rich metadata and limits duplicate publishers', () => {
    const template = { ...BUILTIN_TEMPLATES[0]!, readonly: false, content: { type: 'doc', attrs: {
      standardNo: 'GB/T 1—2020',
      titleParts: [{ id: 'title', lang: 'zh', role: 'full', content: [{ text: '题名', marks: [{ type: 'bold' }] }] }],
      identifiers: [{ id: 'id', parts: [{ id: 'part', kind: 'doc-number', content: [{ text: '1' }] }] }],
      publishers: [{ id: 'first', name: [{ text: '机构' }], identifier: 'A' }, { id: 'second', name: [{ text: '机构' }], identifier: 'B' }],
    }, content: [{ type: 'coverPage', attrs: {}, content: [{ type: 'paragraph' }] }] } } as StandardTemplate;
    const doc = instantiateTemplateDocument(template, { titleCn: '题名', stdPrefix: 'GB/T', stdNo: '1—2020', issuer: '机构' });
    const meta = pmToIr(doc.content as PMJsonNode).doc.meta;
    expect(meta.titleParts?.[0]?.content[0]?.marks).toEqual([{ type: 'bold' }]);
    expect(meta.identifiers?.[0]?.parts[0]?.content[0]?.text).toBe('1');
    expect(meta.publishers?.map(p => p.identifier)).toEqual(['A']);
  });

  it('keeps invalid fallback rows for diagnostics and updates existing root fields', () => {
    const template = { ...BUILTIN_TEMPLATES[0]!, readonly: false, content: { type: 'doc', attrs: {
      standardType: 'national', titleCn: '旧', titleParts: [null, { id: 'fr', lang: 'fr', content: [{ text: 'Titre' }] }], identifiers: [null], publishers: [null],
    }, content: [{ type: 'coverPage', attrs: {}, content: [{ type: 'paragraph' }] }] } } as unknown as StandardTemplate;
    const doc = instantiateTemplateDocument(template, { titleCn: '新', type: StandardType.GROUP });
    const content = doc.content as PMJsonNode;
    expect(content.attrs?.standardType).toBe('group');
    expect(content.attrs?.titleCn).toBe('新');
    expect((content.attrs?.titleParts as unknown[])[0]).toBeNull();
    expect((content.attrs?.identifiers as unknown[])[0]).toBeNull();
    expect((content.attrs?.publishers as unknown[])[0]).toBeNull();
  });

  it('does not treat a template default number as proof that imported identifier parts match', () => {
    const template = { ...BUILTIN_TEMPLATES[0]!, readonly: false, defaultMeta: { standardNo: 'GB/T 2—2026' }, content: { type: 'doc', attrs: {
      identifiers: [{ id: 'id', parts: [{ id: 'part', kind: 'doc-number', content: [{ text: '1' }] }] }],
    }, content: [{ type: 'coverPage', attrs: {}, content: [{ type: 'paragraph' }] }] } } as StandardTemplate;
    const doc = instantiateTemplateDocument(template, { titleCn: '新' });
    expect(pmToIr(doc.content as PMJsonNode).doc.meta.identifiers ?? []).toEqual([]);
  });

  it('provides all 6 readonly built-in templates', () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(6);
    expect(BUILTIN_TEMPLATES.map((t) => t.baseType)).toEqual([
      StandardType.NATIONAL,
      StandardType.INDUSTRY,
      StandardType.LOCAL,
      StandardType.GROUP,
      StandardType.ENTERPRISE,
      StandardType.GUIDANCE,
    ]);
    expect(BUILTIN_TEMPLATES.every((t) => t.readonly && t.source === 'builtin')).toBe(true);
    expect(getBuiltinTemplate('builtin:group')?.baseType).toBe('group');
    expect(getBuiltinTemplate('00000000-0000-4000-8000-000000000001')?.baseType).toBe('national');
  });

  it('matches createNewDocument structure for built-in templates and records sourceTemplate fields', () => {
    const tpl = getBuiltinTemplate('builtin:group')!;
    const form = {
      type: StandardType.GROUP,
      stage: DocumentStage.COMMENT_DRAFT,
      stdPrefix: 'T/CES',
      stdNo: '001—2026',
      titleCn: '测试团体标准',
      titleEn: 'Test group standard',
      icsCode: '35.240',
      ccsCode: 'L 70',
      issuer: '中国电工技术学会',
      applicant: '起草单位A',
      proposer: '提出单位B',
      technicalCommittee: '归口标委会C',
      replaces: '',
      consistency: '',
      coverDesignation: '中国电工技术学会团体标准',
    };
    const baseline = createNewDocument(form);
    const instantiated = instantiateTemplateDocument(tpl, form);

    expect(instantiated.title).toBe(baseline.title);
    expect(instantiated.stage).toBe(baseline.stage);
    expect(instantiated.meta.sourceTemplateUid).toBe(tpl.uid);
    expect(instantiated.meta.sourceTemplateName).toBe(tpl.name);
    expect(instantiated.content).toEqual(baseline.content);
  });

  it('substitutes filled placeholders and retains unfilled placeholders verbatim', () => {
    const customTemplate: StandardTemplate = {
      id: 12,
      uid: '11111111-1111-4111-8111-111111111111',
      name: '某协会团体标准模板',
      description: '含占位变量与自定义徽标',
      baseType: StandardType.GROUP,
      defaultStage: DocumentStage.WORKING_DRAFT,
      defaultMeta: {
        stdPrefix: 'T/ACME',
        issuer: '某标准协会',
        technicalCommittee: '某协会标准化技术委员会',
      },
      coverLayout: {
        logo: { dataUrl: SAMPLE_PNG, position: 'replace_mark', widthMm: 36, heightMm: 18 },
        notice: { text: '版权所有', position: 'above_dates' },
        backCover: { enabled: true, copyrightNotice: '© 2026 ACME' },
      },
      content: {
        type: 'doc',
        content: [
          { type: 'coverPage', attrs: { standardType: 'group' }, content: [{ type: 'paragraph' }] },
          {
            type: 'foreword',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: '本文件《{{titleCn}}》由{{proposer}}提出，由{{technicalCommittee}}归口，由{{issuer}}发布。' }] },
              { type: 'paragraph', content: [{ type: 'text', text: '起草单位：{{applicant}}。' }] },
            ],
          },
          {
            type: 'chapter',
            attrs: { number: '1' },
            content: [
              { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
              { type: 'stdParagraph', content: [{ type: 'text', text: '本文件适用于{{titleCn}}。' }] },
            ],
          },
        ],
      },
      source: 'human',
      readonly: false,
      revision: 3,
    };

    const doc = instantiateTemplateDocument(customTemplate, {
      titleCn: '数字孪生接口规范',
      stdNo: '100—2026',
      proposer: '',
    });

    expect(doc.meta.standardNo).toBe('T/ACME 100—2026');
    expect(doc.meta.issuer).toBe('某标准协会');
    expect(doc.meta.coverLayout?.logo?.position).toBe('replace_mark');

    // coverPage.attrs does NOT store coverLayout
    const coverNode = (doc.content.content as Array<{ type: string; attrs?: Record<string, unknown> }>)[0]!;
    expect(coverNode.attrs?.coverLayout).toBeUndefined();

    // Mutating template afterward does not affect instantiated doc
    customTemplate.coverLayout!.notice!.text = 'CHANGED';
    expect(doc.meta.coverLayout?.notice?.text).toBe('版权所有');

    const foreword = (doc.content.content as Array<{ type: string; content?: Array<{ content?: Array<{ text?: string }> }> }>)[1]!;
    expect(foreword.content?.[0]?.content?.[0]?.text).toBe(
      '本文件《数字孪生接口规范》由{{proposer}}提出，由某协会标准化技术委员会归口，由某标准协会发布。',
    );
    expect(foreword.content?.[1]?.content?.[0]?.text).toBe('起草单位：{{applicant}}。');
  });

  it('auto-downgrades replace_mark when instantiating as national/guidance', () => {
    const customTemplate: StandardTemplate = {
      ...BUILTIN_TEMPLATES[3]!,
      id: 99,
      uid: '22222222-2222-4222-8222-222222222222',
      readonly: false,
      source: 'human',
      coverLayout: {
        logo: { dataUrl: SAMPLE_PNG, position: 'replace_mark', widthMm: 30, heightMm: 15 },
      },
    };
    const doc = instantiateTemplateDocument(customTemplate, {
      titleCn: '测试国标',
      type: StandardType.NATIONAL,
    });
    expect(doc.meta.coverLayout?.logo?.position).toBe('top_left');
  });

  it('leaves coverPage untouched during replaceTemplatePlaceholders', () => {
    const out = replaceTemplatePlaceholders(
      {
        type: 'doc',
        content: [
          { type: 'coverPage', attrs: { titleCn: '{{titleCn}}' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '{{titleCn}}' }] }] },
          { type: 'foreword', content: [{ type: 'paragraph', content: [{ type: 'text', text: '关于{{titleCn}}' }] }] },
        ],
      },
      { titleCn: '新标准', standardType: StandardType.NATIONAL },
    );
    expect(out.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe('{{titleCn}}');
    expect(out.content?.[1]?.content?.[0]?.content?.[0]?.text).toBe('关于新标准');
  });

  it('replaces split placeholders with the opening marks while preserving surrounding formatting', () => {
    const input = { type: 'paragraph', content: [
      { type: 'text', text: 'Before {{ti', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'tleCn', marks: [{ type: 'italic' }] },
      { type: 'text', text: '}} after {{issuer}}!', marks: [{ type: 'underline' }] },
    ] };
    const out = replaceTemplatePlaceholders(input, { titleCn: 'Name', issuer: '{{titleCn}}', standardType: StandardType.GROUP });
    expect(out.content).toEqual([
      { type: 'text', text: 'Before Name', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' after {{titleCn}}!', marks: [{ type: 'underline' }] },
    ]);
    expect(input.content[0]!.text).toBe('Before {{ti');
  });

  it('keeps unknown and unset split tokens and does not join across inline or block boundaries', () => {
    const input = { type: 'doc', content: [
      { type: 'paragraph', content: [
        { type: 'text', text: '{{unk' }, { type: 'text', text: 'nown}} {{pro' }, { type: 'text', text: 'poser}}' },
        { type: 'text', text: ' {{title' }, { type: 'hardBreak' }, { type: 'text', text: 'Cn}}' },
      ] },
      { type: 'paragraph', content: [{ type: 'text', text: '{{title' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Cn}}' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '{{ title' }, { type: 'text', text: 'Cn }}' }] },
    ] };
    const out = replaceTemplatePlaceholders(input, { titleCn: 'Name', standardType: StandardType.GROUP });
    expect(out.content?.slice(0, 3)).toEqual(input.content.slice(0, 3));
    expect(out.content?.[3]?.content).toEqual([{ type: 'text', text: 'Name' }]);
  });

  it('replaces adjacent tokens sharing a node without extending link marks to surrounding text', () => {
    const link = { type: 'externalLink', attrs: { href: 'https://example.org' } };
    const out = replaceTemplatePlaceholders({ type: 'paragraph', content: [
      { type: 'text', text: 'before ' },
      { type: 'text', text: '{{title', marks: [link] },
      { type: 'text', text: 'Cn}}{{issuer}}{{title' },
      { type: 'text', text: 'Cn}} after', marks: [{ type: 'italic' }] },
    ] }, { titleCn: 'Name', issuer: 'Org', standardType: StandardType.GROUP });
    expect(out.content).toEqual([
      { type: 'text', text: 'before ' },
      { type: 'text', text: 'Name', marks: [link] },
      { type: 'text', text: 'OrgName' },
      { type: 'text', text: ' after', marks: [{ type: 'italic' }] },
    ]);
  });

  it('instantiates inline and shared footnote payloads with the same formatted placeholder rules', () => {
    const template: StandardTemplate = {
      ...BUILTIN_TEMPLATES[3]!, id: 81, uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', readonly: false, source: 'human',
      content: { type: 'doc', content: [
        { type: 'chapter', attrs: { nodeId: 'c1' }, content: [
          { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
          { type: 'stdParagraph', attrs: { nodeId: 'p1' }, content: [
            { type: 'text', text: '正文' },
            { type: 'footnoteRef', attrs: { nodeId: 'f1', content: [
              { type: 'text', text: '参见 {{title', marks: [{ type: 'bold' }] },
              { type: 'text', text: 'Cn}}，{{issuer}} / {{unknown}}', marks: [{ type: 'italic' }] },
            ] } },
            { type: 'sharedFootnoteRef', attrs: { targetId: 'f2', refText: '2' } },
            { type: 'sharedFootnoteDefinition', attrs: { nodeId: 'f2', content: [
              { type: 'text', text: '来源 {{pro' }, { type: 'text', text: 'poser}} / {{issuer}}' },
            ] } },
          ] },
        ] },
      ] },
    };
    const before = structuredClone(template);
    const instantiated = instantiateTemplateDocument(template, { titleCn: '新标准', proposer: '协会' });
    const ir = pmToIr(instantiated.content).doc;
    expect(collectFootnotes(ir).map(({ id, content }) => ({ id, content }))).toEqual([
      { id: 'f1', content: [{ text: '参见 新标准', marks: [{ type: 'bold' }] }, { text: '，{{issuer}} / {{unknown}}', marks: [{ type: 'italic' }] }] },
      { id: 'f2', content: [{ text: '来源 协会' }, { text: ' / {{issuer}}' }] },
    ]);
    expect(template).toEqual(before);
  });

  it('preserves malformed and unsupported footnote payloads and does not touch cover attributes', () => {
    const input = { type: 'doc', content: [
      { type: 'coverPage', attrs: { content: [{ type: 'text', text: '{{titleCn}}' }] }, content: [{ type: 'footnoteRef', attrs: { content: [{ type: 'text', text: '{{titleCn}}' }] } }] },
      { type: 'paragraph', content: [
        { type: 'footnoteRef', attrs: { nodeId: 'bad', custom: '{{titleCn}}', content: [
          null, 17, { unexpected: '{{titleCn}}' }, { type: 'unrecognized', attrs: { content: [{ type: 'text', text: '{{titleCn}}' }] }, content: [{ type: 'text', text: '{{titleCn}}' }] },
          { type: 'text', text: '{{title' }, { type: 'hardBreak' }, { type: 'text', text: 'Cn}}' },
          { type: 'footnoteRef', attrs: { content: [{ type: 'text', text: '{{titleCn}}' }] } },
          { type: 'text', text: '' },
        ] } },
        { type: 'sharedFootnoteDefinition', attrs: { nodeId: 'bad-shared', content: 'invalid' } },
        { type: 'sharedFootnoteDefinition', attrs: { nodeId: 'nested-shared', content: [
          { type: 'text', text: '{{titleCn}}' },
          { type: 'footnoteRef', attrs: { content: [{ type: 'text', text: '{{titleCn}}' }] } },
        ] } },
        { type: 'someOtherAtom', attrs: { content: [{ type: 'text', text: '{{titleCn}}' }] } },
      ] },
    ] } as unknown as PMJsonNode;
    const before = structuredClone(input);
    const out = replaceTemplatePlaceholders(input, { titleCn: '新标准', standardType: StandardType.GROUP });
    expect(out).toEqual(before);
    expect(input).toEqual(before);
  });

  it('recurses into canonical nested footnote payloads without joining across an atom', () => {
    const out = replaceTemplatePlaceholders({ type: 'footnoteRef', attrs: { content: [
      { type: 'text', text: '{{title' },
      { type: 'footnoteRef', attrs: { content: [{ type: 'text', text: '{{titleCn}}' }] } },
      { type: 'text', text: 'Cn}}' },
    ] } }, { titleCn: '新标准', standardType: StandardType.GROUP });
    expect(out.attrs?.content).toEqual([
      { type: 'text', text: '{{title' },
      { type: 'footnoteRef', attrs: { content: [{ type: 'text', text: '新标准' }] } },
      { type: 'text', text: 'Cn}}' },
    ]);
  });

  it('clears stale managed coverPage attrs when omitted or cleared during instantiation', () => {
    const derivedTemplate: StandardTemplate = {
      id: 88,
      uid: '33333333-3333-4333-8333-333333333333',
      name: '源自历史文档的模板',
      description: 'coverPage 残留旧文档属性',
      baseType: StandardType.GROUP,
      defaultStage: DocumentStage.WORKING_DRAFT,
      defaultMeta: { stdPrefix: 'T/ZSM' },
      content: {
        type: 'doc',
        content: [
          {
            type: 'coverPage',
            attrs: {
              nodeId: 'cover-node-preserve',
              standardType: 'group',
              standardNo: 'T/OLD 999—2020',
              titleCn: '旧文档题名',
              titleEn: 'Old English Title',
              publishDate: '2020-01-01',
              implementDate: '2020-06-01',
              replaces: 'T/OLD 100—2015',
              icsCode: '99.999',
            },
            content: [{ type: 'paragraph' }],
          },
          { type: 'foreword', content: [{ type: 'paragraph', content: [{ type: 'text', text: '前言' }] }] },
        ],
      },
      source: 'human',
      readonly: false,
      revision: 1,
    };

    const doc = instantiateTemplateDocument(derivedTemplate, {
      titleCn: '全新标准名称',
      stdNo: '002—2026',
      replaces: '',
    });

    const coverNode = (doc.content.content as Array<{ type: string; attrs?: Record<string, unknown> }>)[0]!;
    expect(coverNode.attrs).toMatchObject({
      nodeId: 'cover-node-preserve',
      standardType: 'group',
      standardNo: 'T/ZSM 002—2026',
      titleCn: '全新标准名称',
    });
    expect(coverNode.attrs?.titleEn).toBeUndefined();
    expect(coverNode.attrs?.publishDate).toBeUndefined();
    expect(coverNode.attrs?.implementDate).toBeUndefined();
    expect(coverNode.attrs?.replaces).toBeUndefined();
    expect(coverNode.attrs?.icsCode).toBeUndefined();
  });

  it('substitutes publishDate and implementDate placeholders when provided and leaves blank ones literal', () => {
    const templateWithDates: StandardTemplate = {
      id: 89,
      uid: '44444444-4444-4444-8444-444444444444',
      name: '含日期占位符模板',
      description: '正文使用 publishDate 与 implementDate 占位变量',
      baseType: StandardType.GROUP,
      defaultStage: DocumentStage.WORKING_DRAFT,
      defaultMeta: {
        stdPrefix: 'T/ZSM',
        publishDate: '2026-03-01',
        implementDate: '2026-04-01',
      },
      content: {
        type: 'doc',
        content: [
          {
            type: 'foreword',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: '本文件于{{publishDate}}发布，{{implementDate}}实施。' }],
              },
            ],
          },
        ],
      },
      source: 'human',
      readonly: false,
      revision: 1,
    };

    const instantiated = instantiateTemplateDocument(templateWithDates, {
      titleCn: '日期占位测试标准',
    });
    const foreword = (instantiated.content.content as Array<{ type: string; content?: Array<{ content?: Array<{ text?: string }> }> }>)[1]!;
    expect(foreword.content?.[0]?.content?.[0]?.text).toBe('本文件于2026-03-01发布，2026-04-01实施。');

    const withBlankDates = replaceTemplatePlaceholders(
      templateWithDates.content as Parameters<typeof replaceTemplatePlaceholders>[0],
      {
        titleCn: '日期占位测试标准',
        standardType: StandardType.GROUP,
        publishDate: '   ',
      },
    );
    const literalForeword = (withBlankDates.content as Array<{ type: string; content?: Array<{ content?: Array<{ text?: string }> }> }>)[0]!;
    expect(literalForeword.content?.[0]?.content?.[0]?.text).toBe('本文件于{{publishDate}}发布，{{implementDate}}实施。');
  });
});
