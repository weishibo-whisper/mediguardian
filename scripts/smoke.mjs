#!/usr/bin/env node
/**
 * 端到端冒烟测试
 * ==================================================================
 * 用法：npm run dev（另开终端）→ node scripts/smoke.mjs
 *
 * 校验一次完整 Agent 运行的 SSE 事件序列，等价于「演示前自检」：
 *   run_start → safety → plan → step×N → tool_call/tool_result×N
 *   → retrieval×N → token×N → answer_meta → done
 *
 * 同时校验：
 *   - 红旗症状是否触发强制转诊
 *   - 是否产出引用（citations.length > 0）
 *   - 回答是否包含必须出现的结构小节
 *   - 持续时间是否在可演示范围内
 */

const BASE = (process.env.SMOKE_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');

const CASES = [
  {
    name: '红旗症状 + 抗凝出血（p-001 王秀兰）',
    patientId: 'p-001',
    question: '最近牙龈出血、大便发黑，是不是止痛药引起的？',
    expect: { forceReferral: true, minCitations: 2, mustInclude: ['一句话结论', '风险清单', '什么时候必须就医'] },
  },
  {
    name: '三联打击 + 高钾（p-002 李国强）',
    patientId: 'p-002',
    question: '痛风又犯了，吃了三天止痛药，这两天心慌、腿更肿了',
    expect: { forceReferral: false, minCitations: 2, minTools: 5 },
  },
  {
    name: 'Beers 多重镇静药（p-003 张桂英）',
    patientId: 'p-003',
    question: '睡不着，自己加了一片安定，白天头晕',
    expect: { minCitations: 1, mustIncludeRiskWord: ['苯二氮䓬', '跌倒'] },
  },
];

async function runCase(testCase) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patientId: testCase.patientId, question: testCase.question }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const stats = { events: {}, plan: [], tools: [], citations: 0, answer: '', forceReferral: false, confidence: 0, durationMs: 0 };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      stats.events[event.type] = (stats.events[event.type] || 0) + 1;
      if (event.type === 'plan') stats.plan = event.steps.map((s) => s.title);
      if (event.type === 'tool_call') stats.tools.push(event.name);
      if (event.type === 'token') stats.answer += event.text;
      if (event.type === 'safety') stats.forceReferral = event.forceReferral;
      if (event.type === 'answer_meta') {
        stats.citations = event.citations.length;
        stats.confidence = event.confidence;
      }
      if (event.type === 'done') stats.durationMs = event.durationMs;
      if (event.type === 'error') throw new Error(event.message);
    }
  }
  return stats;
}

function check(label, ok, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

let failures = 0;
console.log(`\n守药人端到端冒烟测试 · endpoint=${BASE}\n`);

for (const testCase of CASES) {
  console.log(`▸ ${testCase.name}`);
  try {
    const stats = await runCase(testCase);
    let ok = true;

    ok = check('规划步数 ≥ 5', stats.plan.length >= 5, `${stats.plan.length} 步`) && ok;
    ok = check('工具调用 ≥ 4', stats.tools.length >= 4, stats.tools.join(' → ')) && ok;
    ok = check(
      '事件序列完整',
      Boolean(stats.events.run_start && stats.events.plan && stats.events.tool_result && stats.events.token && stats.events.done),
      Object.entries(stats.events).map(([k, v]) => `${k}×${v}`).join(' '),
    ) && ok;
    ok = check('产出引用', stats.citations >= (testCase.expect.minCitations ?? 1), `${stats.citations} 条`) && ok;

    for (const phrase of testCase.expect.mustInclude ?? []) {
      ok = check(`回答包含「${phrase}」`, stats.answer.includes(phrase)) && ok;
    }
    for (const word of testCase.expect.mustIncludeRiskWord ?? []) {
      ok = check(`风险识别到「${word}」`, stats.answer.includes(word)) && ok;
    }
    if (testCase.expect.forceReferral !== undefined) {
      ok = check('红旗症状强制转诊', stats.forceReferral === testCase.expect.forceReferral, String(stats.forceReferral)) && ok;
    }

    ok = check('耗时在演示范围（< 20s）', stats.durationMs < 20000, `${stats.durationMs}ms`) && ok;
    console.log(`  置信度 ${stats.confidence} · 回答 ${stats.answer.length} 字\n`);
    if (!ok) failures += 1;
  } catch (error) {
    console.log(`  ✗ 用例异常：${error.message}\n`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`✗ ${failures} 个用例未通过\n`);
  process.exit(1);
}
console.log('✓ 全部用例通过\n');
