#!/usr/bin/env node
/**
 * 审计日志汇总报告
 * ==================================================================
 * 读取 logs/audit.jsonl（由 Agent 运行时逐次追加），输出：
 *  - 运行次数、安全等级分布、平均置信度
 *  - 工具使用频次 Top N
 *  - 触发过的安全规则
 * 并生成 docs/audit-summary.md，可直接作为技术文档附录。
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const AUDIT = path.join(ROOT, process.env.AUDIT_LOG_PATH || 'logs/audit.jsonl');
const OUT = path.join(ROOT, 'docs', 'audit-summary.md');

function readEntries() {
  if (!fs.existsSync(AUDIT)) return [];
  return fs
    .readFileSync(AUDIT, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const entries = readEntries();

if (entries.length === 0) {
  console.log('暂无审计记录。先运行 Web 服务并在「智能诊台」提几个问题，再执行本脚本。');
  process.exit(0);
}

const total = entries.length;
const byLevel = entries.reduce((acc, e) => {
  acc[e.safetyLevel] = (acc[e.safetyLevel] || 0) + 1;
  return acc;
}, {});
const avgConfidence = entries.reduce((s, e) => s + e.confidence, 0) / total;
const toolCount = {};
for (const e of entries) for (const t of e.tools || []) toolCount[t] = (toolCount[t] || 0) + 1;
const flagCount = {};
for (const e of entries) for (const f of e.flags || []) flagCount[f] = (flagCount[f] || 0) + 1;

const topTools = Object.entries(toolCount)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8);
const topFlags = Object.entries(flagCount)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8);
const avgDuration = entries.reduce((s, e) => s + (e.durationMs || 0), 0) / total;

const md = `# 运行审计汇总（自动生成）

> 由 \`npm run audit:report\` 从 \`logs/audit.jsonl\` 生成，可随时复现。

## 总览

| 指标 | 数值 |
| --- | --- |
| 运行次数 | ${total} |
| 平均置信度 | ${avgConfidence.toFixed(2)} |
| 平均耗时 | ${Math.round(avgDuration)} ms |
| 安全等级分布 | ${Object.entries(byLevel)
  .map(([k, v]) => `${k}: ${v}`)
  .join(' / ')} |

## 工具使用频次

| 工具 | 次数 |
| --- | --- |
${topTools.map(([k, v]) => `| \`${k}\` | ${v} |`).join('\n')}

## 触发过的安全规则

| 规则 | 次数 |
| --- | --- |
${topFlags.length ? topFlags.map(([k, v]) => `| ${k} | ${v} |`).join('\n') : '| （无） | 0 |'}

## 最近 10 次运行

| 时间 | 患者 | 问题 | 引擎 | 安全 | 置信度 |
| --- | --- | --- | --- | --- | --- |
${entries
  .slice(-10)
  .reverse()
  .map(
    (e) =>
      `| ${e.at?.slice(5, 19).replace('T', ' ')} | ${e.patientId} | ${String(e.question).replace(/\|/g, '\\|').slice(0, 28)}… | ${e.mode} | ${e.safetyLevel} | ${e.confidence} |`,
  )
  .join('\n')}
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md, 'utf-8');

console.log(`\n运行次数 ${total} · 平均置信度 ${avgConfidence.toFixed(2)} · 平均耗时 ${Math.round(avgDuration)}ms`);
console.log('安全等级：', byLevel);
console.log('工具 Top：', topTools.map(([k, v]) => `${k}×${v}`).join(', '));
console.log(`\n已生成 ${path.relative(ROOT, OUT)}\n`);
