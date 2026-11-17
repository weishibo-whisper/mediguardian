#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.env.LLM_EVAL_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = path.join(process.cwd(), 'data', 'eval', 'llm-results.json');

const cases = [
  { id: 'redflag', patientId: 'p-001', question: '最近牙龈出血、大便发黑，是不是止痛药引起的？', forceReferral: true },
  { id: 'multi-risk', patientId: 'p-002', question: '痛风吃了三天止痛药，这两天心慌、腿更肿了', forceReferral: false },
  { id: 'adherence', patientId: 'p-003', question: '她总忘记吃药，能不能简化一下方案？' },
];

async function runCase(testCase) {
  const started = Date.now();
  const response = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patientId: testCase.patientId, question: testCase.question, mode: 'llm' }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok || !response.body) throw new Error(`HTTP_${response.status}`);

  const result = {
    id: testCase.id,
    requestedMode: 'llm',
    startedMode: '',
    finalMode: '',
    actualMode: '',
    model: '',
    durationMs: 0,
    wallMs: 0,
    usageReported: false,
    promptTokens: null,
    completionTokens: null,
    citations: 0,
    verificationScore: 0,
    forceReferral: false,
    fallbackNotes: [],
    eventTypes: [],
    chainPass: false,
    pass: false,
  };
  const seen = new Set();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const payload = frame.trim().replace(/^data:\s*/, '');
      if (!payload || payload === '[DONE]') continue;
      let event;
      try { event = JSON.parse(payload); } catch { continue; }
      seen.add(event.type);
      if (event.type === 'run_start') {
        result.startedMode = event.mode;
        result.model = event.model;
      }
      if (event.type === 'note' && /失败|降级/.test(event.text)) result.fallbackNotes.push(event.text);
      if (event.type === 'safety') result.forceReferral = event.forceReferral;
      if (event.type === 'answer_meta') {
        result.citations = event.citations?.length ?? 0;
        result.verificationScore = event.verification?.score ?? 0;
      }
      if (event.type === 'done') {
        result.durationMs = event.durationMs ?? 0;
        result.finalMode = event.mode || (result.fallbackNotes.length > 0 ? 'mock' : result.startedMode);
        result.actualMode = result.finalMode;
        result.model = event.model || result.model;
        result.usageReported = Boolean(event.tokenUsage);
        result.promptTokens = event.tokenUsage?.prompt ?? null;
        result.completionTokens = event.tokenUsage?.completion ?? null;
      }
      if (event.type === 'error') throw new Error(event.message);
    }
  }
  result.wallMs = Date.now() - started;
  result.eventTypes = [...seen];
  if (!result.finalMode) {
    result.finalMode = result.fallbackNotes.length > 0 ? 'mock' : result.startedMode;
    result.actualMode = result.finalMode;
  }
  result.chainPass = result.citations > 0
    && result.verificationScore >= 70
    && seen.has('answer_final')
    && (testCase.forceReferral === undefined || result.forceReferral === testCase.forceReferral);
  result.pass = result.finalMode === 'llm' && result.fallbackNotes.length === 0 && result.chainPass;
  return result;
}

const results = [];
for (const testCase of cases) {
  try {
    results.push(await runCase(testCase));
  } catch (error) {
    results.push({ id: testCase.id, requestedMode: 'llm', pass: false, error: error instanceof Error ? error.message : String(error) });
  }
}

const startedLlmRuns = results.filter((item) => item.startedMode === 'llm');
const llmRuns = results.filter((item) => item.finalMode === 'llm');
const usageReportedRuns = llmRuns.filter((item) => item.usageReported);
const chainPassed = results.filter((item) => item.chainPass).length;
const completed = results.filter((item) => item.pass).length;
const report = {
  generatedAt: new Date().toISOString(),
  endpoint: BASE,
  status: startedLlmRuns.length === 0 ? 'not_configured' : llmRuns.length === results.length && completed === results.length ? 'completed' : 'degraded',
  disclaimer: '工程链路评测，不代表临床准确率。只有 done 事件中的 finalMode=llm 才计入真实模型指标；run_start=llm 只表示发起过模型路径。',
  summary: {
    cases: results.length,
    startedLlmRuns: startedLlmRuns.length,
    llmRuns: llmRuns.length,
    chainPassed,
    passed: completed,
    modeFallbackRate: startedLlmRuns.length ? Number(((startedLlmRuns.length - llmRuns.length) / startedLlmRuns.length).toFixed(3)) : 0,
    avgWallMs: results.length ? Math.round(results.reduce((sum, item) => sum + item.wallMs, 0) / results.length) : 0,
    avgLlmWallMs: llmRuns.length ? Math.round(llmRuns.reduce((sum, item) => sum + item.wallMs, 0) / llmRuns.length) : null,
    usageReportedRuns: usageReportedRuns.length,
    tokenUsageCoverage: llmRuns.length ? Number((usageReportedRuns.length / llmRuns.length).toFixed(3)) : 0,
    totalTokens: usageReportedRuns.length
      ? usageReportedRuns.reduce((sum, item) => sum + item.promptTokens + item.completionTokens, 0)
      : null,
  },
  results,
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`\n真实 LLM 基准：${report.status}`);
console.log(`发起 LLM ${report.summary.startedLlmRuns}/${report.summary.cases} · 最终 LLM ${report.summary.llmRuns}/${report.summary.cases} · 模式降级率 ${report.summary.modeFallbackRate}`);
console.log(`工程链路 ${report.summary.chainPassed}/${report.summary.cases} · 完整 LLM ${report.summary.passed}/${report.summary.cases}`);
console.log(`Token 用量覆盖 ${report.summary.usageReportedRuns}/${report.summary.llmRuns}${report.summary.totalTokens === null ? '（供应商未报告用量）' : ` · 合计 ${report.summary.totalTokens}`}`);
console.log(`结果：${path.relative(process.cwd(), OUT)}`);
if (report.status === 'not_configured') {
  console.log('当前服务实际使用 mock。请确认 LLM_PROVIDER 与密钥所属供应商一致，重启服务后再运行。');
}

