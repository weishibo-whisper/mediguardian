import fs from 'node:fs';
import path from 'node:path';

/**
 * 领域同义词扩展
 * ==================================================================
 * 为什么需要它：本项目的稠密向量是「signed hashing trick」，本质是词形投影，
 * 不具备预训练模型的同义泛化能力——「心慌」和「心悸」在向量空间里几乎没有关系。
 *
 * 医疗检索里这恰恰是最要命的一环：老人说的是口语（腿肿、睡不着、心里发慌），
 * 文档写的是术语（水肿、失眠、心悸）。所以这里做一层显式的领域归一化：
 * 命中同组任一词，就把整组词并入检索式。它可枚举、可审查、可测试，
 * 比"指望通用语义模型恰好认识基层口语"更可靠。
 */

interface SynonymFile {
  groups: string[][];
}

let cache: string[][] | null = null;

export function getSynonymGroups(): string[][] {
  if (cache) return cache;
  try {
    const file = path.join(process.cwd(), 'data', 'synonyms.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as SynonymFile;
    cache = (parsed.groups ?? []).filter((g) => Array.isArray(g) && g.length > 1);
  } catch {
    cache = [];
  }
  return cache;
}

/** 命中同义词组时，把同组的其他表述追加到检索式中 */
export function expandQuery(query: string, enabled = process.env.RAG_SYNONYMS !== 'off'): string {
  if (!query) return query;
  // 便于做 A/B 评测：RAG_SYNONYMS=off 时关闭扩展，用同一份探针测出扩展带来的真实增量
  if (!enabled) return query;
  const extra: string[] = [];
  const seen = new Set<string>();
  for (const group of getSynonymGroups()) {
    if (!group.some((term) => query.includes(term))) continue;
    for (const term of group) {
      if (query.includes(term) || seen.has(term)) continue;
      seen.add(term);
      extra.push(term);
    }
  }
  return extra.length > 0 ? `${query} ${extra.join(' ')}` : query;
}

/** 统计一次扩展命中了多少组（供架构页展示可解释性） */
export function describeExpansion(query: string): string[] {
  return getSynonymGroups()
    .filter((group) => group.some((term) => query.includes(term)))
    .map((group) => group.filter((term) => query.includes(term)).join('/'));
}
