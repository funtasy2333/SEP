import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import * as io from '@ses/io';
import { pmToIr, type PMJsonNode } from '@ses/shared';
import { createEditorSchema, normalizeNodeIds } from '@client/editor-schema';
import { editorContentValidator, getEditorSchema } from '../editor-schema/editor-schema';
import { GOLDEN_NAMES, PNG_URL, alignHostIds, evidence, expectedGoldenXml, expectedTargetKind, importedMathShapes, makeCase, nextIds, packageCase, sourceMathShapes, targetEntityKind } from '../../../io/src/__testHelpers__/wp83ImportCases';

const clientSchema = createEditorSchema();
const clientValidator: io.ContentValidator = (content) => {
  try {
    const node = clientSchema.nodeFromJSON(content);
    node.check();
    return { ok: true, content: normalizeNodeIds(node).toJSON() as PMJsonNode };
  } catch (error) { return { ok: false, message: String(error) }; }
};
const readGolden = (name: string) => readFileSync(pathResolve(process.cwd(), '../../packages/shared/src/renderers/__tests__/__snapshots__', `xml46687.${name}.xml`), 'utf8');
const packageImport = (io as typeof io & { importXml46687Package: (bytes: Uint8Array, options: io.Xml46687ImportOptions) => Promise<io.Xml46687ImportResult> }).importXml46687Package;

async function importCase(xml: string) {
  const input = makeCase(xml);
  const options = { resources: input.resources, generateId: nextIds() };
  const server = await io.importXml46687(xml, { ...options, validateContent: editorContentValidator });
  const client = await io.importXml46687(xml, { resources: input.resources, generateId: nextIds(), validateContent: clientValidator });
  expect(server.problems.filter(problem => problem.severity === 'error')).toEqual([]);
  expect(client.problems).toEqual(server.problems);
  expect(server.pmDoc).not.toBeNull();
  expect(alignHostIds(client.pmDoc, server.pmDoc)).toEqual(server.pmDoc);
  const node = getEditorSchema().nodeFromJSON(JSON.parse(JSON.stringify(server.pmDoc)));
  node.check();
  const doc = pmToIr(node.toJSON() as PMJsonNode);
  const clientDoc = pmToIr(client.pmDoc!);
  expect(clientDoc).toEqual(doc);
  expect(doc.warnings).toEqual([]);
  expect(doc.doc.unsupportedContent ?? []).toEqual([]);
  return { input, result: server, doc: doc.doc, pm: node.toJSON() as PMJsonNode };
}

describe('WP8.3 Node/client 生产 Schema 跨端导入', () => {
  it.each(GOLDEN_NAMES)('%s 完整原版 XML 在两端保留相同文档、资源及引用', async name => {
    const { input, doc } = await importCase(readGolden(name));
    const data = evidence(doc);
    for (const reference of input.references) {
      const target = input.xmlIds.get(reference.rid);
      expect(target).toBeDefined();
      expect(data.ids).toContain(target);
      expect(data.targets.filter(value => value === target).length).toBeGreaterThanOrEqual(input.references.filter(value => value.rid === reference.rid).length);
      const kind = expectedTargetKind(reference.type, reference.customType);
      if (kind) expect(targetEntityKind(doc, target!)).toBe(kind);
    }
    for (const resource of doc.resources ?? []) expect(resource).toMatchObject({ mediaType: 'image/png', encoding: 'dataUrl', data: PNG_URL });
    expect(doc.resources?.length ?? 0).toBe(input.resources.size);
    for (const item of data.all) if (typeof item.resourceId === 'string') expect(doc.resources?.some(resource => resource.id === item.resourceId)).toBe(true);
    expect(data.figures.length).toBeGreaterThan(0);
    expect(data.tables.length).toBeGreaterThan(0);
    expect(data.terms.length).toBeGreaterThan(0);
    expect(importedMathShapes(doc)).toEqual(sourceMathShapes(input.xml));
  });

  it.each(GOLDEN_NAMES)('%s 两端导入后导出原 XML 且第二次导入导出保持不变', async name => {
    const xml = readGolden(name);
    const first = await importCase(xml);
    const exported = await io.buildXml46687Package({ pmDoc: first.pm });
    expect(exported.problems.filter(problem => problem.severity === 'error')).toEqual([]);
    expect(exported.xml).toBe(expectedGoldenXml(name, xml))
    if (name === 'wp8m') expect(first.result.problems).toContainEqual(expect.objectContaining({ code: 'xml-normalized', severity: 'warning', message: expect.stringContaining('多段') }));
    const second = await importCase(exported.xml!);
    const again = await io.buildXml46687Package({ pmDoc: second.pm });
    expect(again.problems.filter(problem => problem.severity === 'error')).toEqual([]);
    expect(again.xml).toBe(exported.xml);
  });

  it.each(GOLDEN_NAMES)('%s 共享资源包在两端导入结果一致且保留资源字节', async name => {
    const input = makeCase(readGolden(name));
    const bytes = await packageCase(input);
    const before = [...bytes];
    expect(typeof packageImport).toBe('function');
    const server = await packageImport(bytes, { validateContent: editorContentValidator, generateId: nextIds() });
    const client = await packageImport(bytes, { validateContent: clientValidator, generateId: nextIds() });
    expect([...bytes]).toEqual(before);
    expect(server.problems.filter(problem => problem.severity === 'error')).toEqual([]);
    expect(client.problems).toEqual(server.problems);
    expect(alignHostIds(client.pmDoc, server.pmDoc)).toEqual(server.pmDoc);
    expect(server.pmDoc).not.toBeNull();
    const node = getEditorSchema().nodeFromJSON(JSON.parse(JSON.stringify(server.pmDoc)));
    node.check();
    const doc = pmToIr(node.toJSON() as PMJsonNode).doc;
    for (const resource of doc.resources ?? []) expect(resource).toMatchObject({ mediaType: 'image/png', encoding: 'dataUrl', data: PNG_URL });
    if (input.resources.size) expect(doc.resources?.length).toBeGreaterThan(0);
  });

  it('错误 XML 在两端阻断且输入不变', async () => {
    const malformed = '<standard><front></standard>';
    const options = { validateContent: editorContentValidator, generateId: nextIds() };
    const broken = await io.importXml46687(malformed, options);
    const clientBroken = await io.importXml46687(malformed, { validateContent: clientValidator, generateId: nextIds() });
    expect(clientBroken).toEqual(broken);
    expect(broken.pmDoc).toBeNull();
    expect(broken.problems).toContainEqual(expect.objectContaining({ severity: 'error', code: expect.stringMatching(/^xml-/), message: expect.stringMatching(/[\u3400-\u9fff]/), xml: expect.objectContaining({ line: expect.any(Number), column: expect.any(Number) }) }));
    expect(malformed).toBe('<standard><front></standard>');
  });

  it('缺资源在两端阻断且资源表不变', async () => {
    const input = makeCase(readGolden('wp82'));
    const resources = new Map<string, { src: string; mediaType: string }>();
    const missing = await io.importXml46687(input.xml, { validateContent: editorContentValidator, resources, generateId: nextIds() });
    const clientMissing = await io.importXml46687(input.xml, { validateContent: clientValidator, resources, generateId: nextIds() });
    expect(clientMissing).toEqual(missing);
    expect(missing.pmDoc).toBeNull();
    expect(missing.problems).toContainEqual(expect.objectContaining({ severity: 'error', code: 'xml-resource-missing', message: expect.stringMatching(/[\u3400-\u9fff]/), xml: expect.objectContaining({ line: expect.any(Number) }) }));
    expect(resources.size).toBe(0);
  });

  it('无效包在两端阻断且输入不变', async () => {
    const bytes = Uint8Array.of(1, 2, 3);
    expect(typeof packageImport).toBe('function');
    const invalid = await packageImport(bytes, { validateContent: editorContentValidator, generateId: nextIds() });
    const clientInvalid = await packageImport(bytes, { validateContent: clientValidator, generateId: nextIds() });
    expect(clientInvalid).toEqual(invalid);
    expect(invalid.pmDoc).toBeNull();
    expect(invalid.problems).toContainEqual(expect.objectContaining({ severity: 'error', code: expect.stringMatching(/^xml-/), message: expect.stringMatching(/[\u3400-\u9fff]/) }));
    expect([...bytes]).toEqual([1, 2, 3]);
  });
});
