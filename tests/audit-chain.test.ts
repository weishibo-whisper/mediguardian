import { describe, expect, it } from 'vitest';
import { createChainedAuditEntry, verifyAuditLines, type AuditEntry } from '@/lib/safety';

const entry = (runId: string): AuditEntry => ({
  runId,
  at: '2026-11-12T08:00:00.000Z',
  patientId: 'p-001',
  question: '测试问题',
  mode: 'mock',
  model: 'rule-engine-v1.2',
  safetyLevel: 'ok',
  flags: [],
  tools: ['get_patient'],
  citations: ['kb-test#1'],
  durationMs: 100,
  confidence: 0.9,
});

describe('审计日志哈希链', () => {
  it('验证连续追加的链式记录', () => {
    const first = JSON.stringify(createChainedAuditEntry(entry('run-1')));
    const second = JSON.stringify(createChainedAuditEntry(entry('run-2'), `${first}\n`));
    expect(verifyAuditLines([first, second])).toMatchObject({
      status: 'valid',
      chainedLines: 2,
      verifiedLines: 2,
    });
  });

  it('把旧格式日志整体纳入第一条链式记录', () => {
    const legacy = JSON.stringify(entry('legacy'));
    const chained = JSON.stringify(createChainedAuditEntry(entry('run-1'), `${legacy}\n`));
    expect(verifyAuditLines([legacy, chained])).toMatchObject({
      status: 'valid',
      legacyLines: 1,
      chainedLines: 1,
    });
  });

  it('检测被修改的历史记录', () => {
    const first = JSON.stringify(createChainedAuditEntry(entry('run-1')));
    const second = JSON.stringify(createChainedAuditEntry(entry('run-2'), `${first}\n`));
    const tampered = first.replace('测试问题', '被篡改的问题');
    expect(verifyAuditLines([tampered, second])).toMatchObject({ status: 'broken', firstBrokenLine: 1 });
  });
});
