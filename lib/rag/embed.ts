/**
 * 本地向量化（Hashed Embedding）
 * ------------------------------------------------------------------
 * 选型理由（写进技术文档的核心论据）：
 *  1. 比赛演示环境不可依赖外部 embedding API（网络抖动 / 额度耗尽 = 现场翻车）；
 *  2. 医疗知识库规模在千级分块量级，稠密模型带来的边际收益低于「精确术语匹配」；
 *  3. 哈希向量 + BM25 的混合检索，可在 0 网络成本下获得可解释的语义近似召回；
 *  4. 若配置了真实 embedding 服务，只需替换本文件的 embed() 实现，
 *     检索层与 Agent 层无需改动（接口隔离）。
 *
 * 算法：FNV-1a 哈希 → 维度桶，带符号累加（signed hashing trick，降低碰撞偏置），
 *      再对向量做 L2 归一化，使余弦相似度等价于点积。
 */

export const EMBED_DIM = 384;

/** 32 位 FNV-1a 哈希，确定性、无依赖 */
function fnv1a(str: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 把 token 列表编码为归一化稠密向量 */
export function embed(tokens: string[]): Float32Array {
  const vec = new Float32Array(EMBED_DIM);
  if (tokens.length === 0) return vec;

  for (const token of tokens) {
    // 每个 token 取两个哈希：一个定位维度，一个决定符号（signed hashing trick）
    const h1 = fnv1a(token, 0x811c9dc5);
    const h2 = fnv1a(token, 0x1000193);
    const dim = h1 % EMBED_DIM;
    const sign = (h2 & 1) === 0 ? 1 : -1;
    // 长 token（更具体的术语）权重更高，抑制高频虚词
    const weight = 1 + Math.log(1 + token.length) * 0.25;
    vec[dim] += sign * weight;
  }

  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < EMBED_DIM; i++) vec[i] /= norm;
  }
  return vec;
}

/** 余弦相似度（输入已 L2 归一化，故退化为点积） */
export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  // 映射到 0~1，便于与 BM25 归一化后融合
  return (s + 1) / 2;
}
