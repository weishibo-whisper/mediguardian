#!/usr/bin/env node
/**
 * 检索质量离线评测
 * ==================================================================
 * 用法：
 *   npm run dev            # 另开终端启动 Web 服务
 *   npm run eval:rag
 *
 * 输出：每条探针的 Hit@1 / Hit@3 与 MRR，最后给出整体指标。
 * 意义：把「RAG 检索策略是否合理」从主观描述变成可复现的数字，
 *      写进技术文档后可被评委直接复核（评分表 RAG 6% 的硬证据）。
 */

const BASE = (process.env.EVAL_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');

/** 探针集：query → 期望命中的文档 id（首条即「标准答案」） */
const PROBES = [
  { query: '华法林 布洛芬 出血 能一起吃吗', expected: 'kb-nsaid-anticoag' },
  { query: '牙龈出血 大便发黑 INR 偏高', expected: 'kb-anticoag-bleeding' },
  { query: '二甲双胍 eGFR 42 要不要减量', expected: 'kb-diabetes-basics' },
  { query: '格列本脲 老年人 低血糖', expected: 'kb-beers-elderly' },
  { query: '依那普利 螺内酯 血钾 5.6', expected: 'kb-hyperkalemia' },
  { query: '利尿剂 降压药 止痛药 一起用 伤肾', expected: 'kb-triple-whammy' },
  { query: '艾司唑仑 地西泮 一起吃 会摔倒吗', expected: 'kb-falls' },
  { query: '奥美拉唑 氯吡格雷 能不能一起用', expected: 'kb-ppi' },
  { query: '克拉霉素 辛伐他汀 肌肉疼', expected: 'kb-statin-muscle' },
  { query: '胺碘酮 华法林 INR 升高', expected: 'kb-arrhythmia-drugs' },
  { query: '地高辛 中毒 恶心 黄视', expected: 'kb-digoxin-toxicity' },
  { query: '用药重整 怎么核对 多重用药', expected: 'kb-med-reconciliation' },
  { query: '左氧氟沙星 钙片 间隔多久', expected: 'kb-antibiotics-interaction' },
  { query: '心衰 布洛芬 能不能吃', expected: 'kb-heart-failure' },
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

function fmt(n) {
  return n.toFixed(3);
}

(async () => {
  console.log(`\n守药人 RAG 检索评测 · endpoint=${BASE}\n`);
  let hit1 = 0;
  let hit3 = 0;
  let mrr = 0;
  const rows = [];

  for (const probe of PROBES) {
    let result;
    try {
      result = await search(probe.query);
    } catch (error) {
      console.error(`✗ 请求失败：${error.message}`);
      console.error('  请确认已运行 npm run dev（默认 3000 端口），或设置 EVAL_BASE。');
      process.exit(1);
    }
    const docs = (result.hits || []).map((h) => h.docId);
    const rank = docs.indexOf(probe.expected) + 1;
    if (rank === 1) hit1 += 1;
    if (rank > 0 && rank <= 3) hit3 += 1;
    if (rank > 0) mrr += 1 / rank;
    rows.push({
      查询: probe.query,
      期望: probe.expected,
      实际首位: docs[0] ?? '(无)',
      排名: rank === 0 ? '未命中' : `#${rank}`,
    });
  }

  console.table(rows);
  const n = PROBES.length;
  console.log(`\n探针数量        ${n}`);
  console.log(`Hit@1           ${hit1}/${n}  (${fmt(hit1 / n)})`);
  console.log(`Hit@3           ${hit3}/${n}  (${fmt(hit3 / n)})`);
  console.log(`MRR             ${fmt(mrr / n)}`);
  console.log('\n以上指标可在技术文档「检索策略」一节直接引用（命令可复现）。\n');
})();
