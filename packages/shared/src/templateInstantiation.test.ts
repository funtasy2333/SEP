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

const SAMPLE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('templateInstantiation', () => {
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
