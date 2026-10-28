import fs from 'node:fs/promises';
import path from 'node:path';
import type { KbChunk, KbHit, SearchOptions } from '@/lib/types';
import { cosine, embed } from './embed';
import { expandQuery } from './synonyms';
import { clip, termFreq, tokenize } from './text';

/**
 * 混合检索（Hybrid Retrieval）
 * ------------------------------------------------------------------
 * 管线：分块 → 双路召回（BM25 稀疏 + 哈希向量稠密）→ RRF 融合 → 规则重排
 *
 * 为什么不用现成向量库：
 *  - 知识库规模小（十几篇文档、百级分块），内存检索延迟 < 5ms，引入 Milvus/pgvector
 *    只会增加部署失败面；
 *  - 可解释性是硬需求：每个命中都带着 BM25/向量/RRF/重排四项分明细，
 *    任何人都能当场追问「为什么这条证据被选中」，答案在 UI 里直接可见。
 *  - 若后续接入真实 embedding（bge-m3 等），只需替换 embed()，检索层零改动。
 */

const KB_DIR = path.join(process.cwd(), 'data', 'kb');
const BM25_K1 = 1.5;
const BM25_B = 0.75;
const RRF_K = 60;

interface IndexState {
  chunks: KbChunk[];
  /** 文档级元信息，供引用面板展示来源 */
  docs: Array<{ id: string; title: string; sectionCount: number }>;
  df: Map<string, number>;
  avgLen: number;
  builtAt: string;
}

let statePromise: Promise<IndexState> | null = null;

/** 解析 `---` 包裹的 frontmatter（只做本项目需要的简单 key: value 解析） */
function parseFrontmatter(raw: string): { meta: Record<string, string | string[]>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string | string[]> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value
        .slice(1, -1)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    } else {
      meta[key] = value;
    }
  }
  return { meta, body: match[2] };
}

/** 按 `## ` 标题切分语义块；过短的段落并入上一块，避免碎片化 */
function chunkDocument(docId: string, title: string, tags: string[], body: string): KbChunk[] {
  const rawSections = body.split(/\r?\n(?=##\s)/);
  const chunks: KbChunk[] = [];
  let carry = '';

  for (const section of rawSections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    const headingMatch = trimmed.match(/^##\s+(.*)$/m);
    const sectionTitle = headingMatch ? headingMatch[1].trim() : '概述';
    const text = (carry ? `${carry}\n` : '') + trimmed.replace(/^#.*$/m, '').trim();
    carry = '';

    if (text.length < 60) {
      carry = text;
      continue;
    }
    const tokens = tokenize(`${title} ${sectionTitle} ${tags.join(' ')} ${text}`);
    chunks.push({
      id: `${docId}#${chunks.length}`,
      docId,
      title,
      section: sectionTitle,
      tags,
      text,
      tf: termFreq(tokens),
      len: tokens.length,
      vector: embed(tokens),
    });
  }

  // 尾部残块并入最后一块
  if (carry && chunks.length > 0) {
    const last = chunks[chunks.length - 1];
    last.text = `${last.text}\n${carry}`;
    const tokens = tokenize(`${last.title} ${last.section} ${last.text}`);
    last.tf = termFreq(tokens);
    last.len = tokens.length;
    last.vector = embed(tokens);
  }
  return chunks;
}

/** 构建索引（首次访问时执行一次，随后进程内缓存） */
async function buildIndex(): Promise<IndexState> {
  const files = (await fs.readdir(KB_DIR)).filter((f) => f.endsWith('.md'));
  const chunks: KbChunk[] = [];
  const docs: IndexState['docs'] = [];

  for (const file of files.sort()) {
    const raw = await fs.readFile(path.join(KB_DIR, file), 'utf-8');
    const { meta, body } = parseFrontmatter(raw);
    const docId = (meta.id as string) || file.replace(/\.md$/, '');
    const title = (meta.title as string) || docId;
    const tags = Array.isArray(meta.tags) ? (meta.tags as string[]) : [];
    const docChunks = chunkDocument(docId, title, tags, body);
    chunks.push(...docChunks);
    docs.push({ id: docId, title, sectionCount: docChunks.length });
  }

  const df = new Map<string, number>();
  for (const chunk of chunks) {
    for (const term of Object.keys(chunk.tf)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const avgLen = chunks.reduce((s, c) => s + c.len, 0) / Math.max(1, chunks.length);

  return { chunks, docs, df, avgLen, builtAt: new Date().toISOString() };
}

/** 获取（并缓存）索引 */
export function getIndex(): Promise<IndexState> {
  if (!statePromise) statePromise = buildIndex();
  return statePromise;
}

/** BM25 打分 */
function bm25(queryTokens: string[], chunk: KbChunk, index: IndexState): number {
  const N = index.chunks.length;
  let score = 0;
  for (const term of queryTokens) {
    const tf = chunk.tf[term];
    if (!tf) continue;
    const df = index.df.get(term) ?? 0;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    const denom = tf + BM25_K1 * (1 - BM25_B + (BM25_B * chunk.len) / index.avgLen);
    score += idf * ((tf * (BM25_K1 + 1)) / denom);
  }
  return score;
}

/**
 * 混合检索主入口
 * @param query 自然语言问题
 * @param options.topK 返回条数（默认 6）
 * @param options.docIds 限定文档范围（规则命中后精确定位证据）
 * @param options.minScore 最低分数阈值
 */
export async function searchKb(query: string, options: SearchOptions = {}): Promise<KbHit[]> {
  const { topK = 6, docIds, minScore = 0 } = options;
  const index = await getIndex();
  // 领域同义词扩展：把「心慌/腿肿/睡不着」这类口语补上文档里的术语写法。
  // 只在未限定 docIds（即主检索）时扩展；定向取证要的是精确命中，不做放大。
  const expanded = docIds?.length ? query : expandQuery(query);
  const queryTokens = Array.from(new Set(tokenize(query)));
  const expandedTokens = Array.from(new Set(tokenize(expanded)));
  if (expandedTokens.length === 0) return [];

  const pool = docIds?.length
    ? index.chunks.filter((c) => docIds.includes(c.docId))
    : index.chunks;
  if (pool.length === 0) return [];

  /**
   * 分工原则：稀疏路（BM25）保持精确——只用原话，命中术语才算数；
   * 稠密路（向量）承担泛化——吃扩展后的词，负责把口语映射到术语。
   * 早前版本把扩展词也塞进 BM25，结果「心衰 布洛芬」这类精确提问被
   * 「止痛药/NSAID/双氯芬酸」一大串同义词稀释，Hit@3 反而从 0.929 掉到 0.857。
   */
  const queryVec = embed(expandedTokens);

  // 双路打分
  const scored = pool.map((chunk) => ({
    chunk,
    bm25: bm25(queryTokens, chunk, index),
    vector: cosine(queryVec, chunk.vector),
  }));

  const maxBm25 = Math.max(...scored.map((s) => s.bm25), 1e-6);

  // RRF 融合：按两路排名取倒数排名分，抑制单路异常高分的支配
  const byBm25 = [...scored].sort((a, b) => b.bm25 - a.bm25);
  const byVec = [...scored].sort((a, b) => b.vector - a.vector);
  const rrfMap = new Map<string, number>();
  byBm25.forEach((s, rank) => {
    rrfMap.set(s.chunk.id, (rrfMap.get(s.chunk.id) ?? 0) + 1 / (RRF_K + rank + 1));
  });
  byVec.forEach((s, rank) => {
    rrfMap.set(s.chunk.id, (rrfMap.get(s.chunk.id) ?? 0) + 1 / (RRF_K + rank + 1));
  });
  const maxRrf = Math.max(...Array.from(rrfMap.values()), 1e-6);

  const hits: KbHit[] = scored.map((s) => {
    const bm25n = s.bm25 / maxBm25;
    const rrf = (rrfMap.get(s.chunk.id) ?? 0) / maxRrf;

    // 规则重排：标题/小节/标签命中给额外权重（医疗检索中「术语精确命中」比语义漂移更可信）
    const metaTokens = new Set(tokenize(`${s.chunk.title} ${s.chunk.section} ${s.chunk.tags.join(' ')}`));
    const metaHits = queryTokens.filter((t) => metaTokens.has(t)).length;
    const rerank = Math.min(0.2, metaHits * 0.05);

    const score = Math.min(1, 0.5 * bm25n + 0.35 * s.vector + 0.15 * rrf + rerank);

    return {
      chunkId: s.chunk.id,
      docId: s.chunk.docId,
      title: s.chunk.title,
      section: s.chunk.section,
      tags: s.chunk.tags,
      text: s.chunk.text,
      score: Number(score.toFixed(4)),
      scoreBreakdown: {
        bm25: Number(bm25n.toFixed(4)),
        vector: Number(s.vector.toFixed(4)),
        rrf: Number(rrf.toFixed(4)),
        rerank: Number(rerank.toFixed(4)),
      },
    };
  });

  return hits
    .filter((h) => h.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * 引用守卫：校验模型回答中的 [n] 是否对应真实检索结果
 * 返回合法引用与被剔除的非法引用，用于 UI 上的「幻觉拦截」标记。
 */
export function verifyCitations(answer: string, hits: KbHit[]) {
  const cited = new Set<number>();
  const invalid = new Set<number>();
  const regex = /\[(\d{1,2})\]/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(answer)) !== null) {
    const idx = Number(m[1]);
    if (idx >= 1 && idx <= hits.length) cited.add(idx);
    else invalid.add(idx);
  }
  return {
    validIds: Array.from(cited).map((i) => hits[i - 1].chunkId),
    invalidIds: Array.from(invalid),
    hasCitation: cited.size > 0,
  };
}

/** 知识库统计信息（架构页展示用） */
export async function getKbStats() {
  const index = await getIndex();
  return {
    docCount: index.docs.length,
    chunkCount: index.chunks.length,
    termCount: index.df.size,
    avgChunkLen: Math.round(index.avgLen),
    builtAt: index.builtAt,
    docs: index.docs,
  };
}

/** 供 UI 生成摘要 */
export function hitSnippet(hit: KbHit, max = 160) {
  return clip(hit.text.replace(/^#+\s*/gm, ''), max);
}
