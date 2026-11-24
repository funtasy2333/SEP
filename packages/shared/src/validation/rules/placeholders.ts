import type {
  IRAppendix,
  IRBlock,
  IRClause,
  IRDefItem,
  IRDoc,
  IRFigure,
  IRInline,
  IRTermEntry,
  NodeId,
} from '../../ir/types';
import { evidence, makeIssue } from '../issues';
import type { ValidationIssue } from '../types';

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const META_STRING_FIELDS = [
  'title',
  'titleEn',
  'stdCode',
  'icsCode',
  'ccsCode',
  'issuer',
  'applicant',
  'replaces',
  'consistency',
  'filingNo',
  'industryName',
  'regionName',
  'coverDesignation',
  'proposer',
  'technicalCommittee',
] as const;

function inlinesRawText(inlines: readonly IRInline[] | undefined): string {
  if (!inlines) return '';
  let out = '';
  for (const inline of inlines) {
    if (inline.text) out += inline.text;
  }
  return out;
}

export function validateTemplatePlaceholders(doc: IRDoc): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const scanText = (text: string, nodeId: NodeId | null, path: string): void => {
    if (!text || !text.includes('{{')) return;
    PLACEHOLDER_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER_RE.exec(text)) !== null) {
      const fullMatch = match[0];
      const varName = match[1]!;
      const from = match.index;
      const to = from + fullMatch.length;
      issues.push(
        makeIssue({
          ruleId: 'template-placeholder-unresolved',
          severity: 'warning',
          category: 'structure',
          nodeId,
          path,
          identity: `${varName}:${from}`,
          message: `存在未替换的模板占位变量「${fullMatch}」，请补填实际内容`,
          suggestion: `在文件设置中补全对应信息，或直接将「${fullMatch}」修改为正式文本`,
          basis: { kind: 'project-convention', text: '模板占位变量检查' },
          evidence: [evidence(nodeId, fullMatch, { from, to, path })],
        }),
      );
    }
  };

  const scanDefItems = (items: readonly IRDefItem[] | undefined, basePath: string): void => {
    if (!items) return;
    items.forEach((item, index) => {
      scanText(inlinesRawText(item.term), item.id, `${basePath}.items[${index}].term`);
      scanText(inlinesRawText(item.definition), item.id, `${basePath}.items[${index}].definition`);
    });
  };

  const scanFigure = (fig: IRFigure, path: string): void => {
    scanText(inlinesRawText(fig.caption), fig.id, `${path}.caption`);
    scanText(inlinesRawText(fig.captionEn), fig.id, `${path}.captionEn`);
    fig.descriptions?.forEach((desc, i) => scanText(inlinesRawText(desc.content), desc.id, `${path}.descriptions[${i}]`));
    fig.legend?.items && scanDefItems(fig.legend.items, `${path}.legend`);
    fig.notes.forEach((note, i) => scanBlock(note, `${path}.notes[${i}]`));
    fig.examples?.forEach((ex, i) => scanBlock(ex, `${path}.examples[${i}]`));
  };

  const scanBlock = (block: IRBlock, path: string): void => {
    switch (block.kind) {
      case 'paragraph':
        scanText(inlinesRawText(block.content), block.id, path);
        break;
      case 'list':
        block.items.forEach((item, i) => {
          item.content.forEach((child, j) => scanBlock(child, `${path}.items[${i}].content[${j}]`));
        });
        break;
      case 'table':
        scanText(inlinesRawText(block.caption), block.id, `${path}.caption`);
        scanText(inlinesRawText(block.captionEn), block.id, `${path}.captionEn`);
        block.rows.forEach((row, r) => {
          row.cells.forEach((cell, c) => {
            cell.content.forEach((cellBlock, b) =>
              scanBlock(cellBlock, `${path}.rows[${r}].cells[${c}].content[${b}]`),
            );
          });
        });
        block.notes.forEach((note, i) => scanBlock(note, `${path}.notes[${i}]`));
        break;
      case 'array':
        block.rows.forEach((row, r) => {
          row.cells.forEach((cell, c) => {
            cell.content.forEach((cellBlock, b) =>
              scanBlock(cellBlock, `${path}.rows[${r}].cells[${c}].content[${b}]`),
            );
          });
        });
        break;
      case 'figure':
        scanFigure(block, path);
        break;
      case 'figureSet':
        block.legend && scanDefItems(block.legend.items, `${path}.legend`);
        block.figures.forEach((fig, i) => scanFigure(fig, `${path}.figures[${i}]`));
        break;
      case 'formula':
        scanDefItems(block.whereList, `${path}.whereList`);
        block.notes?.forEach((note, i) => scanText(inlinesRawText(note.content), note.id, `${path}.notes[${i}]`));
        break;
      case 'formulaGroup':
        block.formulas.forEach((f, i) => scanBlock(f, `${path}.formulas[${i}]`));
        break;
      case 'note':
      case 'example':
      case 'warning':
      case 'quote':
        block.content.forEach((child, i) => scanBlock(child, `${path}.content[${i}]`));
        break;
      case 'code':
        scanText(block.text, block.id, path);
        break;
      case 'defList':
        scanDefItems(block.items, path);
        break;
      case 'normRefList':
        block.entries.forEach((entry, i) => {
          if (entry.entryType === 'std') {
            scanText(`${inlinesRawText(entry.ref)} ${inlinesRawText(entry.title)}`, entry.id, `${path}.entries[${i}]`);
          } else {
            scanText(inlinesRawText(entry.content), entry.id, `${path}.entries[${i}]`);
          }
        });
        break;
    }
  };

  const scanTermEntry = (entry: IRTermEntry, path: string): void => {
    scanText(inlinesRawText(entry.term), entry.id, `${path}.term`);
    scanText(inlinesRawText(entry.termEn), entry.id, `${path}.termEn`);
    scanText(inlinesRawText(entry.subjectField), entry.id, `${path}.subjectField`);
    entry.definition.forEach((b, i) => scanBlock(b, `${path}.definition[${i}]`));
    scanText(inlinesRawText(entry.source), entry.id, `${path}.source`);
    entry.notes.forEach((n, i) => scanBlock(n, `${path}.notes[${i}]`));
    entry.examples.forEach((e, i) => scanBlock(e, `${path}.examples[${i}]`));
    entry.nestedEntries?.forEach((nested, i) => scanTermEntry(nested, `${path}.nestedEntries[${i}]`));
    entry.languageSets?.forEach((ls, lsi) => {
      ls.groups.forEach((grp, gi) => {
        grp.terms.forEach((v, vi) => {
          scanText(inlinesRawText(v.content), v.id, `${path}.languageSets[${lsi}].groups[${gi}].terms[${vi}]`);
        });
      });
    });
  };

  const scanClause = (clause: IRClause, path: string): void => {
    scanText(inlinesRawText(clause.title), clause.id, `${path}.title`);
    clause.children.forEach((child, i) => {
      const childPath = `${path}.children[${i}]`;
      if (child.kind === 'clause') scanClause(child, childPath);
      else if (child.kind === 'termEntry') scanTermEntry(child, childPath);
      else scanBlock(child, childPath);
    });
  };

  const scanAppendix = (appendix: IRAppendix, path: string): void => {
    scanText(inlinesRawText(appendix.title), appendix.id, `${path}.title`);
    appendix.children.forEach((child, i) => {
      const childPath = `${path}.children[${i}]`;
      if (child.kind === 'clause') scanClause(child, childPath);
      else if (child.kind === 'termEntry') scanTermEntry(child, childPath);
      else scanBlock(child, childPath);
    });
  };

  for (const field of META_STRING_FIELDS) {
    const val = doc.meta[field];
    if (typeof val === 'string') {
      scanText(val, null, `meta.${field}`);
    }
  }

  doc.front.foreword.forEach((block, i) => scanBlock(block, `front.foreword[${i}]`));
  doc.front.introduction.forEach((block, i) => scanBlock(block, `front.introduction[${i}]`));
  doc.front.introductionClauses?.forEach((clause, i) => scanClause(clause, `front.introductionClauses[${i}]`));

  doc.body.forEach((chapter, ci) => {
    const chPath = `body[${ci}]`;
    scanText(inlinesRawText(chapter.title), chapter.id, `${chPath}.title`);
    chapter.children.forEach((child, i) => {
      const childPath = `${chPath}.children[${i}]`;
      if (child.kind === 'clause') scanClause(child, childPath);
      else if (child.kind === 'termEntry') scanTermEntry(child, childPath);
      else scanBlock(child, childPath);
    });
  });

  doc.appendices.forEach((appendix, i) => scanAppendix(appendix, `appendices[${i}]`));

  doc.bibliography.forEach((entry, i) => {
    scanText(inlinesRawText(entry.content), entry.id, `bibliography[${i}]`);
  });

  return issues;
}
