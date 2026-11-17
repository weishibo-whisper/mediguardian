#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const [interactions, redflags, sources] = await Promise.all([
  fs.readFile(path.join(root, 'data/interactions.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(root, 'data/redflags.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(root, 'data/kb/sources.json'), 'utf8').then(JSON.parse),
]);
const out = path.join(root, 'data/eval/clinical-review.csv');
const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const header = ['priority', 'type', 'id', 'severity', 'statement', 'action', 'evidence', 'candidate_doi', 'review_status', 'reviewer', 'review_date', 'review_comment'];
const rows = [];

for (const item of interactions) {
  const dois = item.evidence.flatMap((docId) => sources.find((source) => source.docId === docId)?.references?.map((ref) => ref.doi) ?? []);
  rows.push([item.severity === 'high' ? 2 : 3, 'interaction', item.id, item.severity, item.mechanism, item.action, item.evidence.join(';'), dois.join(';'), 'pending', '', '', '']);
}
for (const item of redflags) {
  rows.push([item.level === 'emergency' ? 1 : 2, 'redflag', item.id, item.level, `${item.title}｜关键词：${item.keywords.join('、')}`, item.action, item.escalateTo, '', 'pending', '', '', '']);
}
for (const item of sources) {
  rows.push([4, 'knowledge_source', item.docId, item.contentReviewStatus, item.contentReviewNote, '', item.docId, item.references.map((ref) => ref.doi).join(';'), 'pending', '', '', '']);
}

rows.sort((a, b) => Number(a[0]) - Number(b[0]) || String(a[1]).localeCompare(String(b[1])) || String(a[2]).localeCompare(String(b[2])));

await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, `\uFEFF${[header, ...rows].map((row) => row.map(quote).join(',')).join('\n')}\n`, 'utf8');
console.log(`已导出 ${rows.length} 条待复核项（priority 1 最优先）：${path.relative(root, out)}`);

