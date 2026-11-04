import type { PMJsonNode } from '@ses/shared';
import {
  blockExternalImages,
  EXTERNAL_IMAGE_REJECTED_MESSAGE,
  isInlineImage,
} from './external-images';

const DATA_URL = 'data:image/png;base64,AAAA';
const node = (
  type: string,
  attrs?: Record<string, unknown>,
  content?: PMJsonNode[],
): PMJsonNode => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content ? { content } : {}),
});

describe('isInlineImage', () => {
  it('只有 data URL 算内嵌（大小写不敏感），其余都是外部资源', () => {
    expect(isInlineImage('data:image/png;base64,AA')).toBe(true);
    expect(isInlineImage('DATA:image/png;base64,AA')).toBe(true);
    for (const src of [
      'http://a/b.png',
      'https://a/b.png',
      '//a/b.png',
      '/b.png',
      'b.png',
      'file:///etc/passwd',
      'blob:http://a/uuid',
      ' data:image/png;base64,AA',
    ]) {
      expect(isInlineImage(src)).toBe(false);
    }
  });
});

describe('blockExternalImages', () => {
  it('清空 figureImage / inlineImage / image 的外部 src，data URL 与空 src 不动，也不产生告警', () => {
    const doc = node('doc', undefined, [
      node('figure', { nodeId: 'f1' }, [
        node('figureImage', { src: 'http://x/a.png' }),
      ]),
      node('stdParagraph', { nodeId: 'p1' }, [
        node('inlineImage', { src: 'https://x/b.png' }),
        node('inlineImage', { src: DATA_URL }),
        node('inlineImage', { src: '' }),
      ]),
      node('image', { src: '/rel/c.png', nodeId: 'img-1' }),
    ]);
    const warnings = blockExternalImages(doc);
    expect(JSON.stringify(doc)).not.toMatch(/http|\/rel/);
    expect(JSON.stringify(doc)).toContain(DATA_URL);
    // figureImage 记在所属 figure 上；行内图自己没有 nodeId，告警不带 nodeId；image 用自己的 nodeId。
    const message = EXTERNAL_IMAGE_REJECTED_MESSAGE;
    expect(warnings).toEqual([
      { code: 'image-resource-failed', nodeId: 'f1', message },
      { code: 'image-resource-failed', message },
      { code: 'image-resource-failed', nodeId: 'img-1', message },
    ]);
  });

  it('清空 additionalGraphics[].src 与 alternativeGraphic.src，保留其余字段', () => {
    const doc = node('doc', undefined, [
      node('figure', {
        nodeId: 'f1',
        additionalGraphics: [
          { nodeId: 'g1', src: 'http://x/1.png', contentType: 'image/png' },
          { nodeId: 'g2', src: DATA_URL },
        ],
      }),
      node('stdTable', {
        nodeId: 't1',
        alternativeGraphic: { nodeId: 'a1', src: '//x/2.png' },
      }),
    ]);
    const warnings = blockExternalImages(doc);
    const figureAttrs = doc.content![0].attrs!;
    expect(figureAttrs.additionalGraphics).toEqual([
      { nodeId: 'g1', src: '', contentType: 'image/png' },
      { nodeId: 'g2', src: DATA_URL },
    ]);
    expect(doc.content![1].attrs!.alternativeGraphic).toEqual({
      nodeId: 'a1',
      src: '',
    });
    expect(warnings.map((w) => w.nodeId)).toEqual(['f1', 't1']);
  });

  it('其他节点的 src 属性与文本内容不受影响', () => {
    const doc = node('doc', undefined, [
      node('stdParagraph', { nodeId: 'p', src: 'http://x' }, [
        { type: 'text', text: 'http://x/a.png' },
      ]),
    ]);
    expect(blockExternalImages(doc)).toEqual([]);
    expect(doc.content![0].attrs!.src).toBe('http://x');
  });
});
