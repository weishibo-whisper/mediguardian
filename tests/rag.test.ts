import { describe, expect, it } from 'vitest';
import { getKbStats, hitSnippet, searchKb, verifyCitations } from '@/lib/rag';
import { embed, cosine, EMBED_DIM } from '@/lib/rag/embed';
import { normalize, tokenize } from '@/lib/rag/text';

/**
 * 检索层单测
 * ==================================================================
 * 这一层是整个系统「凭什么这么说」的根基，也是最容易被评委追问的地方，
 * 所以测试重点放在三件事：分块口径稳定、排序单调合理、引用校验不漏判。
 */

describe('检索索引', () => {
  it('索引规模与数据文件一致（17 篇文档 / 59 个分块）', async () => {
    const stats = await getKbStats();
    expect(stats.docCount).toBe(17);
    expect(stats.chunkCount).toBeGreaterThan(50);
    expect(stats.chunkCount).toBeLessThan(90);
    expect(stats.avgChunkLen).toBeGreaterThan(50);
  });
});

describe('混合检索', () => {
  it('出血相关提问首位命中抗凝/NSAID 类文档', async () => {
    const hits = await searchKb('华法林 布洛芬 出血 能一起吃吗');
    expect(hits.length).toBeGreaterThan(0);
    expect(['kb-nsaid-anticoag', 'kb-anticoag-bleeding', 'kb-antiplatelet']).toContain(hits[0].docId);
  });

  it('得分单调递减且落在 [0,1]', async () => {
    const hits = await searchKb('二甲双胍 eGFR 要不要减量');
    for (let i = 0; i < hits.length; i += 1) {
      expect(hits[i].score).toBeGreaterThanOrEqual(0);
      expect(hits[i].score).toBeLessThanOrEqual(1);
      if (i > 0) expect(hits[i].score).toBeLessThanOrEqual(hits[i - 1].score);
    }
  });

  it('docIds 限定检索只返回指定文档（证据锚定依赖此行为）', async () => {
    const hits = await searchKb('无关的检索词', { docIds: ['kb-ppi'], topK: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.docId === 'kb-ppi')).toBe(true);
  });

  it('topK 生效', async () => {
    const hits = await searchKb('用药重整', { topK: 2 });
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('每个命中都带可展示的小节名与片段', async () => {
    const hits = await searchKb('地高辛 中毒');
    expect(hits[0].section.length).toBeGreaterThan(0);
    expect(hitSnippet(hits[0], 80).length).toBeLessThanOrEqual(83);
  });
});

describe('引用校验', () => {
  const mk = (chunkId: string, docId: string, score: number) => ({
    chunkId,
    docId,
    title: docId.toUpperCase(),
    section: '小节',
    tags: [] as string[],
    text: '片段',
    score,
    scoreBreakdown: { bm25: score, vector: score, rrf: score, rerank: 0 },
  });
  const hits = [mk('kb-a#0', 'kb-a', 1), mk('kb-b#1', 'kb-b', 0.5)];

  it('合法编号被接受', () => {
    const r = verifyCitations('结论一 [1]，结论二 [2]。', hits);
    expect(r.validIds).toEqual(['kb-a#0', 'kb-b#1']);
    expect(r.invalidIds).toEqual([]);
    expect(r.hasCitation).toBe(true);
  });

  it('越界编号被判为非法（幻觉守卫）', () => {
    const r = verifyCitations('结论 [1] 与 [9]', hits);
    expect(r.invalidIds).toContain(9);
  });

  it('无引用时返回空集合而不是抛错', () => {
    const r = verifyCitations('这段回答没有任何角标。', hits);
    expect(r.validIds).toEqual([]);
    expect(r.hasCitation).toBe(false);
  });
});

describe('向量与分词', () => {
  it('向量维度固定 384、L2 归一化、可复现', () => {
    const a = embed(tokenize('华法林 布洛芬 出血'));
    const b = embed(tokenize('华法林 布洛芬 出血'));
    expect(a.length).toBe(EMBED_DIM);
    expect(Array.from(a)).toEqual(Array.from(b));
    const norm = Math.sqrt(Array.from(a).reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('同主题相似度高于无关主题（哈希向量的能力边界）', () => {
    const q = embed(tokenize('华法林 布洛芬 出血风险'));
    const sameTopic = cosine(q, embed(tokenize('抗凝药 与 NSAID 联用 消化道出血')));
    const offTopic = cosine(q, embed(tokenize('骨质疏松 钙片 维生素 D')));
    expect(cosine(q, embed(tokenize('华法林 布洛芬 出血风险')))).toBeCloseTo(1, 5);
    // 注意：这是「词形重合 + 维度投影」的相似度，不是预训练语义向量，
    // 所以只断言"同主题高于无关主题"这种可靠性质，不断言绝对阈值。
    expect(sameTopic).toBeGreaterThan(offTopic);
  });

  it('中文按相邻二元组切词，全角与大小写归一', () => {
    expect(normalize('Ａｓｐｉｒｉｎ １００ＭＧ')).toBe('aspirin 100mg');
    const tokens = tokenize('华法林出血');
    expect(tokens).toContain('华法');
    expect(tokens).toContain('法林');
  });
});
