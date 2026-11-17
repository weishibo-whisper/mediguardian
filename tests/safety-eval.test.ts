import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { guardOutput, detectRedFlags } from '@/lib/safety';
import type { KbHit } from '@/lib/types';

interface SafetyCases {
  scope: string;
  redFlagPositive: Array<{ id: string; text: string; forceReferral: boolean }>;
  redFlagNegative: Array<{ id: string; text: string }>;
  redFlagMixed: Array<{ id: string; text: string; expectedMatched: string[] }>;
  outputCases: Array<{ id: string; text: string; expectedFlag: string; emptyHits?: boolean }>;
}

const cases = JSON.parse(
  await fs.readFile(path.join(process.cwd(), 'data', 'eval', 'safety-cases.json'), 'utf8'),
) as SafetyCases;

const hits: KbHit[] = [
  {
    chunkId: 'kb-a#0',
    docId: 'kb-a',
    title: 'A',
    section: '小节',
    tags: [],
    source: {
      docId: 'kb-a',
      authoredBy: 'fixture',
      contentReviewStatus: 'unreviewed',
      contentReviewNote: 'test fixture',
      references: [],
    },
    text: '演示证据片段',
    score: 1,
    scoreBreakdown: { bm25: 1, vector: 1, rrf: 1, rerank: 0 },
  },
];

describe('安全回归评测（项目自建用例，非临床验证）', () => {
  it('11 类红旗正例全部检出，急诊分级保持一致', async () => {
    const rules = (await import('@/lib/data')).getRedFlags;
    const allRules = await rules();
    let detected = 0;
    for (const sample of cases.redFlagPositive) {
      const result = detectRedFlags(sample.text, allRules);
      const found = result.matched.some((rule) => rule.id === sample.id);
      if (found) detected += 1;
      expect(found, sample.id).toBe(true);
      expect(result.hasEmergency, sample.id).toBe(sample.forceReferral);
    }
    console.log(`Safety red-flag sensitivity: ${detected}/${cases.redFlagPositive.length} (${(detected / cases.redFlagPositive.length).toFixed(3)})`);
    expect(detected / cases.redFlagPositive.length).toBe(1);
  });

  it('明确否认症状不误触发，活动症状不会被相邻否定句压掉', async () => {
    const allRules = await (await import('@/lib/data')).getRedFlags();
    let trueNegatives = 0;
    for (const sample of cases.redFlagNegative) {
      const result = detectRedFlags(sample.text, allRules);
      if (result.matched.length === 0) trueNegatives += 1;
      expect(result.matched, sample.id).toHaveLength(0);
    }
    for (const sample of cases.redFlagMixed) {
      const result = detectRedFlags(sample.text, allRules);
      expect(result.matched.map((rule) => rule.id), sample.id).toEqual(sample.expectedMatched);
    }
    console.log(`Safety explicit-denial specificity: ${trueNegatives}/${cases.redFlagNegative.length} (${(trueNegatives / cases.redFlagNegative.length).toFixed(3)})`);
    expect(trueNegatives / cases.redFlagNegative.length).toBe(1);
  });

  it.each(cases.outputCases)('输出守门：$id', ({ text, expectedFlag, emptyHits }) => {
    const result = guardOutput(text, emptyHits ? [] : hits, 'strict');
    expect(result.flags.some((flag) => flag.id === expectedFlag)).toBe(true);
    if (expectedFlag === 'guard-invalid-citations') expect(result.text).not.toContain('[999]');
  });

  it('数据集声明自建与用途边界', () => {
    expect(cases.scope).toContain('not a clinical validation set');
  });
});
