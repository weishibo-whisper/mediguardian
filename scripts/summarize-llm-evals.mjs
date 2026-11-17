#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const evalDir = path.join(process.cwd(), 'data', 'eval');
const names = (await fs.readdir(evalDir))
  .filter((name) => /^llm-results-round-\d+\.json$/.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (names.length === 0) {
  throw new Error('未找到 data/eval/llm-results-round-*.json');
}

const rounds = [];
for (const name of names) {
  const report = JSON.parse(await fs.readFile(path.join(evalDir, name), 'utf8'));
  const results = (report.results ?? []).map((item) => {
    const fallbackNotes = item.fallbackNotes ?? [];
    const startedMode = item.startedMode || item.actualMode || '';
    const finalMode = item.finalMode || (fallbackNotes.length > 0 ? 'mock' : item.actualMode || '');
    return {
      ...item,
      startedMode,
      finalMode,
      actualMode: finalMode,
      chainPass: item.chainPass ?? item.pass === true,
      pass: item.pass === true && finalMode === 'llm' && fallbackNotes.length === 0,
      usageReported: item.usageReported === true,
      promptTokens: item.usageReported === true ? item.promptTokens : null,
      completionTokens: item.usageReported === true ? item.completionTokens : null,
    };
  });
  rounds.push({ name, ...report, results });
}

const results = rounds.flatMap((round, roundIndex) =>
  round.results.map((item) => ({ round: roundIndex + 1, ...item })),
);
const startedLlmRuns = results.filter((item) => item.startedMode === 'llm');
const llmRuns = results.filter((item) => item.finalMode === 'llm');
const chainPassed = results.filter((item) => item.chainPass).length;
const passed = results.filter((item) => item.pass).length;
const usageReportedRuns = llmRuns.filter((item) => item.usageReported);
const report = {
  generatedAt: new Date().toISOString(),
  sourceFiles: names,
  status: startedLlmRuns.length === 0 ? 'not_configured' : llmRuns.length === results.length && passed === results.length ? 'completed' : 'degraded',
  disclaimer: '工程链路评测，不代表临床准确率。只有最终模式为 llm 且没有降级 note 才算完整 LLM 通过；Token 用量仅在供应商明确返回 usage 时统计。',
  summary: {
    rounds: rounds.length,
    cases: results.length,
    startedLlmRuns: startedLlmRuns.length,
    llmRuns: llmRuns.length,
    chainPassed,
    passed,
    modeFallbackRate: startedLlmRuns.length
      ? Number(((startedLlmRuns.length - llmRuns.length) / startedLlmRuns.length).toFixed(3))
      : 0,
    avgWallMs: results.length
      ? Math.round(results.reduce((sum, item) => sum + item.wallMs, 0) / results.length)
      : 0,
    usageReportedRuns: usageReportedRuns.length,
    tokenUsageCoverage: llmRuns.length
      ? Number((usageReportedRuns.length / llmRuns.length).toFixed(3))
      : 0,
    totalTokens: usageReportedRuns.length
      ? usageReportedRuns.reduce((sum, item) => sum + item.promptTokens + item.completionTokens, 0)
      : null,
  },
  results,
};

const outPath = path.join(evalDir, 'llm-results-summary.json');
await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`LLM 路径汇总：${report.summary.rounds} 轮 · 链路 ${report.summary.chainPassed}/${report.summary.cases} 通过 · 最终 LLM ${report.summary.passed}/${report.summary.cases} · 平均 ${report.summary.avgWallMs} ms`);
console.log(`Token 用量覆盖：${report.summary.usageReportedRuns}/${report.summary.llmRuns}${report.summary.llmRuns === 0 ? '（没有最终 LLM 运行）' : report.summary.totalTokens === null ? '（供应商未报告用量）' : ` · 合计 ${report.summary.totalTokens}`}`);
console.log(`结果：${path.relative(process.cwd(), outPath)}`);
