#!/usr/bin/env node
/**
 * 检索质量离线评测
 * ==================================================================
 * 用法：
 *   npm run dev            # 另开终端启动 Web 服务
 *   npm run eval:rag       # 默认（开启同义词扩展）
 *   RAG_SYNONYMS=off npm run eval:rag   # 关闭扩展，测出扩展带来的真实增量
 *
 * 探针分两类：
 *   term       —— 术语型提问（医生/药师会这么问），考「精确命中」
 *   colloquial —— 基层口语型提问（老人/家属会这么问），考「口语 → 术语」的泛化
 *
 * 分开统计的理由：把两类混在一起平均，会掩盖一个事实——
 * 通用检索在术语上很强，在口语上很弱，而后者才是本项目的真实用户。
 */

const BASE = (process.env.EVAL_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');

const PROBES = [
  // ── 术语型 ────────────────────────────────────────────────
  { kind: 'term', query: '华法林 布洛芬 出血 能一起吃吗', expected: 'kb-nsaid-anticoag' },
  { kind: 'term', query: '牙龈出血 大便发黑 INR 偏高', expected: 'kb-anticoag-bleeding' },
  { kind: 'term', query: '二甲双胍 eGFR 42 要不要减量', expected: 'kb-diabetes-basics' },
  { kind: 'term', query: '格列本脲 老年人 低血糖', expected: 'kb-beers-elderly' },
  { kind: 'term', query: '依那普利 螺内酯 血钾 5.6', expected: 'kb-hyperkalemia' },
  { kind: 'term', query: '利尿剂 降压药 止痛药 一起用 伤肾', expected: 'kb-triple-whammy' },
  { kind: 'term', query: '艾司唑仑 地西泮 一起吃 会摔倒吗', expected: 'kb-falls' },
  { kind: 'term', query: '奥美拉唑 氯吡格雷 能不能一起用', expected: 'kb-ppi' },
  { kind: 'term', query: '克拉霉素 辛伐他汀 肌肉疼', expected: 'kb-statin-muscle' },
  { kind: 'term', query: '胺碘酮 华法林 INR 升高', expected: 'kb-arrhythmia-drugs' },
  { kind: 'term', query: '地高辛 中毒 恶心 黄视', expected: 'kb-digoxin-toxicity' },
  { kind: 'term', query: '用药重整 怎么核对 多重用药', expected: 'kb-med-reconciliation' },
  { kind: 'term', query: '左氧氟沙星 钙片 间隔多久', expected: 'kb-antibiotics-interaction' },
  { kind: 'term', query: '心衰 布洛芬 能不能吃', expected: 'kb-heart-failure' },

  // ── 口语型（老人/家属原话，不含术语）──────────────────────
  { kind: 'colloquial', query: '刷牙老出血，拉的屎还是黑的', expected: 'kb-anticoag-bleeding' },
  { kind: 'colloquial', query: '膝盖疼吃了几天止痛药，腿肿了', expected: 'kb-nsaid-anticoag' },
  { kind: 'colloquial', query: '心里发慌，是不是药吃重了', expected: 'kb-heart-failure' },
  { kind: 'colloquial', query: '睡不着，自己加了一片安眠药', expected: 'kb-falls' },
  { kind: 'colloquial', query: '家里换了低钠盐，人整天没劲', expected: 'kb-hyperkalemia' },
  { kind: 'colloquial', query: '一袋药好几种，怎么核对', expected: 'kb-med-reconciliation' },
  { kind: 'colloquial', query: '胃不舒服，医生开的胃药和防血栓的药能一起吃吗', expected: 'kb-ppi' },
];

async function search(query) {
  const res = await fetch(`${BASE}/api/kb/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topK: 5 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const fmt = (n) => n.toFixed(3);

(async () => {
  const mode = process.env.RAG_SYNONYMS === 'off' ? '关闭（基线）' : '开启（默认）';
  console.log(`\n守药人 RAG 检索评测 · endpoint=${BASE} · 同义词扩展：${mode}\n`);

  const stats = { term: { n: 0, hit1: 0, hit3: 0, mrr: 0 }, colloquial: { n: 0, hit1: 0, hit3: 0, mrr: 0 } };
  const rows = [];

  for (const probe of PROBES) {
    let result;
    try {
      result = await search(probe.query);
    } catch (error) {
      console.error(`✗ 请求失败：${error.message}`);
      console.error('  请确认已启动 Web 服务（默认 3000 端口），或设置 EVAL_BASE。');
      process.exit(1);
    }
    const docs = (result.hits || []).map((h) => h.docId);
    const rank = docs.indexOf(probe.expected) + 1;
    const s = stats[probe.kind];
    s.n += 1;
    if (rank === 1) s.hit1 += 1;
    if (rank > 0 && rank <= 3) s.hit3 += 1;
    if (rank > 0) s.mrr += 1 / rank;

    rows.push({
      类别: probe.kind === 'term' ? '术语' : '口语',
      查询: probe.query,
      期望: probe.expected,
      实际首位: docs[0] ?? '(无)',
      排名: rank === 0 ? '未命中' : `#${rank}`,
    });
  }

  console.table(rows);

  for (const [key, label] of [
    ['term', '术语型探针'],
    ['colloquial', '口语型探针'],
  ]) {
    const s = stats[key];
    console.log(`\n${label}（${s.n} 条）`);
    console.log(`  Hit@1  ${s.hit1}/${s.n}  (${fmt(s.hit1 / s.n)})`);
    console.log(`  Hit@3  ${s.hit3}/${s.n}  (${fmt(s.hit3 / s.n)})`);
    console.log(`  MRR    ${fmt(s.mrr / s.n)}`);
  }

  const total = stats.term.n + stats.colloquial.n;
  const allHit1 = stats.term.hit1 + stats.colloquial.hit1;
  const allHit3 = stats.term.hit3 + stats.colloquial.hit3;
  const allMrr = stats.term.mrr + stats.colloquial.mrr;
  console.log(`\n合计（${total} 条）`);
  console.log(`  Hit@1  ${allHit1}/${total}  (${fmt(allHit1 / total)})`);
  console.log(`  Hit@3  ${allHit3}/${total}  (${fmt(allHit3 / total)})`);
  console.log(`  MRR    ${fmt(allMrr / total)}`);
  console.log('\n以上指标可在技术文档「检索策略」一节直接引用（命令可复现）。\n');
})();
