import { describe, expect, it } from 'vitest';
import type { KbHit } from '@/lib/types';
import { verifyAnswerGrounding } from '@/lib/agent/verification';

function hit(index: number, docId: string, withReference = true): KbHit {
  return {
    chunkId: `${docId}#${index}`,
    docId,
    title: `文档 ${index}`,
    section: '测试',
    tags: [],
    text: '测试证据',
    score: 0.9,
    scoreBreakdown: { bm25: 0.9, vector: 0.8, rrf: 1, rerank: 0.1 },
    source: {
      docId,
      authoredBy: 'test',
      contentReviewStatus: 'unreviewed',
      contentReviewNote: '待复核',
      references: withReference
        ? [{
            title: '来源',
            organization: '机构',
            year: 2026,
            doi: `10.1000/${index}`,
            url: 'https://example.com',
            metadataStatus: 'crossref-verified',
            mappingStatus: 'candidate-unreviewed',
          }]
        : [],
    },
  };
}

describe('输出可信度自检', () => {
  it('完整引用所有高风险依据时给出满工程分，并保留专业复核提示', () => {
    const result = verifyAnswerGrounding('风险一 [1]，风险二 [2]。', [hit(1, 'a'), hit(2, 'b')], ['a', 'b']);
    expect(result.score).toBe(100);
    expect(result.status).toBe('caution');
    expect(result.supportedFindingCount).toBe(2);
    expect(result.checks.find((check) => check.id === 'professional_review')?.status).toBe('caution');
  });

  it('缺失高风险依据引用时降低覆盖分并标记失败', () => {
    const result = verifyAnswerGrounding('只引用第一条 [1]。', [hit(1, 'a'), hit(2, 'b')], ['a', 'b']);
    expect(result.score).toBe(80);
    expect(result.status).toBe('caution');
    expect(result.supportedFindingCount).toBe(1);
    expect(result.checks.find((check) => check.id === 'risk_coverage')?.status).toBe('caution');
  });

  it('无效引用且来源不可追溯时明确失败', () => {
    const result = verifyAnswerGrounding('错误引用 [99]。', [hit(1, 'a', false)], ['a']);
    expect(result.status).toBe('fail');
    expect(result.score).toBe(0);
    expect(result.invalidCitationIds).toEqual([99]);
  });
});
