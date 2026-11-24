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
});
