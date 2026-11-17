#!/usr/bin/env node
const BASE = (process.env.AUDIT_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const response = await fetch(`${BASE}/api/audit?limit=1`, { signal: AbortSignal.timeout(15_000) });
if (!response.ok) throw new Error(`HTTP_${response.status}`);
const body = await response.json();
const chain = body.summary?.chain;
if (!chain) throw new Error('接口未返回审计链状态');
console.log(`审计链：${chain.status} · 链式记录 ${chain.verifiedLines}/${chain.chainedLines} · 旧格式 ${chain.legacyLines}`);
if (chain.status === 'broken') {
  console.error(`首个异常位于第 ${chain.firstBrokenLine} 行`);
  process.exit(1);
}
