#!/usr/bin/env node
/**
 * Project-curated retrieval benchmark. Relevance labels are author annotations,
 * not clinical validation. Results are macro averages over the probe set.
 */

import fs from 'node:fs/promises';

const BASE = (process.env.EVAL_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const DOCUMENT_TOP_K = 5;
const CANDIDATE_CHUNKS = 12;
const probes = JSON.parse(
  await fs.readFile(new URL('../data/eval/rag-probes.json', import.meta.url), 'utf8'),
);

if (!Array.isArray(probes) || probes.length === 0) {
  throw new Error('RAG_EVAL_PROBES_EMPTY');
}

function uniqueDocIds(hits) {
  const seen = new Set();
  return hits.flatMap((hit) => {
    if (!hit?.docId || seen.has(hit.docId)) return [];
    seen.add(hit.docId);
    return [hit.docId];
  });
}

function discountedGain(relevant, ranked) {
  const dcg = ranked.slice(0, DOCUMENT_TOP_K).reduce(
    (sum, docId, index) => sum + (relevant.has(docId) ? 1 / Math.log2(index + 2) : 0),
    0,
  );
  const idealCount = Math.min(relevant.size, DOCUMENT_TOP_K);
  const idcg = Array.from({ length: idealCount }, (_, index) => 1 / Math.log2(index + 2))
    .reduce((sum, gain) => sum + gain, 0);
  return idcg === 0 ? 0 : dcg / idcg;
}

function measure(rows) {
  const n = rows.length;
  const metrics = { n, hit1: 0, hit3: 0, hit5: 0, mrr5: 0, recall5: 0, ndcg5: 0 };
  for (const row of rows) {
    const relevant = new Set(row.probe.relevant);
    const firstRelevantRank = row.ranked.findIndex((docId) => relevant.has(docId)) + 1;
    const retrievedRelevant = row.ranked.slice(0, DOCUMENT_TOP_K).filter((docId) => relevant.has(docId)).length;
    if (row.ranked.slice(0, 1).some((docId) => relevant.has(docId))) metrics.hit1 += 1;
    if (row.ranked.slice(0, 3).some((docId) => relevant.has(docId))) metrics.hit3 += 1;
    if (retrievedRelevant > 0) metrics.hit5 += 1;
    if (firstRelevantRank > 0 && firstRelevantRank <= DOCUMENT_TOP_K) metrics.mrr5 += 1 / firstRelevantRank;
    metrics.recall5 += retrievedRelevant / relevant.size;
    metrics.ndcg5 += discountedGain(relevant, row.ranked);
  }
  for (const key of ['hit1', 'hit3', 'hit5', 'mrr5', 'recall5', 'ndcg5']) metrics[key] /= n;
  return metrics;
}

function printMetrics(label, stats) {
  const fmt = (value) => value.toFixed(3);
  console.log(`\n${label} (${stats.n} 条)`);
  console.log(`  Hit@1    ${fmt(stats.hit1)}`);
  console.log(`  Hit@3    ${fmt(stats.hit3)}`);
  console.log(`  Hit@5    ${fmt(stats.hit5)}`);
  console.log(`  MRR@5    ${fmt(stats.mrr5)}`);
  console.log(`  Recall@5 ${fmt(stats.recall5)}`);
  console.log(`  nDCG@5   ${fmt(stats.ndcg5)}`);
}

const CONFIGS = [
  { id: 'bm25', label: '仅 BM25', mode: 'bm25', useSynonyms: false },
  { id: 'vector', label: '仅哈希向量', mode: 'vector', useSynonyms: false },
  { id: 'hybrid_no_synonyms', label: '混合检索（无同义词）', mode: 'hybrid', useSynonyms: false },
  { id: 'hybrid', label: '完整混合检索', mode: 'hybrid', useSynonyms: true },
];

async function fetchRows(config) {
  const rows = [];
  for (const probe of probes) {
    if (!probe.category || !probe.query || !Array.isArray(probe.relevant) || probe.relevant.length === 0) {
      throw new Error(`RAG_EVAL_PROBE_INVALID:${JSON.stringify(probe)}`);
    }
    let response;
    try {
      response = await fetch(`${BASE}/api/kb/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: probe.query,
          topK: CANDIDATE_CHUNKS,
          mode: config.mode,
          useSynonyms: config.useSynonyms,
        }),
      });
    } catch (error) {
      console.error(`请求失败：${error.message}`);
      console.error('请确认 Web 服务已启动（默认 3000 端口），或设置 EVAL_BASE。');
      process.exit(1);
    }
    if (!response.ok) throw new Error(`RAG_EVAL_HTTP_${response.status}:${probe.query}`);
    const result = await response.json();
    rows.push({ probe, ranked: uniqueDocIds(result.hits || []) });
  }
  return rows;
}

console.log(`\n守药人检索消融基准 · endpoint=${BASE} · documentTopK=${DOCUMENT_TOP_K} · candidateChunks=${CANDIDATE_CHUNKS}`);
console.log('自标注文档相关性评测，不代表临床有效性验证。\n');

const categories = [...new Set(probes.map((probe) => probe.category))];
const report = {
  generatedAt: new Date().toISOString(),
  probeCount: probes.length,
  documentTopK: DOCUMENT_TOP_K,
  candidateChunks: CANDIDATE_CHUNKS,
  labelStatus: 'project-authored-unreviewed',
  disclaimer: '项目自标注文档相关性评测，不代表临床准确率或临床有效性。',
  configurations: [],
};

let fullRows = [];
for (const config of CONFIGS) {
  console.log(`\n===== ${config.label} =====`);
  const rows = await fetchRows(config);
  if (config.id === 'hybrid') fullRows = rows;
  const categoryMetrics = {};
  for (const category of categories) {
    const stats = measure(rows.filter((row) => row.probe.category === category));
    categoryMetrics[category] = stats;
    printMetrics(category, stats);
  }
  const total = measure(rows);
  printMetrics('合计（macro average）', total);
  report.configurations.push({ ...config, total, categories: categoryMetrics });
}

const incomplete = fullRows.filter((row) => {
  const relevant = new Set(row.probe.relevant);
  const found = new Set(row.ranked.slice(0, DOCUMENT_TOP_K).filter((docId) => relevant.has(docId)));
  return found.size < relevant.size;
});
if (incomplete.length > 0) {
  console.log(`\n未完整召回全部标注文档的探针（top ${DOCUMENT_TOP_K}，${incomplete.length} 条）：`);
  for (const row of incomplete) {
    const found = row.ranked.slice(0, DOCUMENT_TOP_K).filter((docId) => row.probe.relevant.includes(docId));
    const missing = row.probe.relevant.filter((docId) => !found.includes(docId));
    console.log(`  [${row.probe.category}] ${row.probe.query}`);
    console.log(`    已召回：${found.join(', ') || '(无)'}；未召回：${missing.join(', ')}；top：${row.ranked.slice(0, DOCUMENT_TOP_K).join(', ') || '(无)'}`);
  }
}

report.incomplete = incomplete.map((row) => {
  const found = row.ranked.slice(0, DOCUMENT_TOP_K).filter((docId) => row.probe.relevant.includes(docId));
  return {
    category: row.probe.category,
    query: row.probe.query,
    found,
    missing: row.probe.relevant.filter((docId) => !found.includes(docId)),
    ranked: row.ranked.slice(0, DOCUMENT_TOP_K),
  };
});

await fs.writeFile(
  new URL('../data/eval/rag-results.json', import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
);

console.log('\n已写入 data/eval/rag-results.json，依据页将展示本次消融结果。');
console.log('标签为项目自标注，需独立复核；请勿将这些指标解释为临床准确率。');
