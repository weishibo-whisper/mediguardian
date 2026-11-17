import type { KbHit, VerificationCheck, VerificationReport, VerificationStatus } from '@/lib/types';
import { verifyCitations } from '@/lib/rag';

function ratio(numerator: number, denominator: number, emptyValue = 1): number {
  return denominator === 0 ? emptyValue : numerator / denominator;
}

function checkStatus(value: number, passAt = 1, cautionAt = 0.5): VerificationStatus {
  if (value >= passAt) return 'pass';
  if (value >= cautionAt) return 'caution';
  return 'fail';
}

/**
 * 对最终回答做确定性证据自检。
 *
 * 这不是另一个会产生幻觉的 LLM 评审器，而是基于本轮真实检索结果验证：
 * 1. 引用编号是否存在；2. 高风险发现要求的文档是否被回答引用；
 * 3. 被引用知识是否登记外部来源；4. 是否完成专业人员内容复核。
 */
export function verifyAnswerGrounding(
  answer: string,
  hits: KbHit[],
  requiredFindingDocs: string[],
): VerificationReport {
  const citationCheck = verifyCitations(answer, hits);
  const citedHits = citationCheck.validIds
    .map((chunkId) => hits.find((hit) => hit.chunkId === chunkId))
    .filter((hit): hit is KbHit => Boolean(hit));
  const citedDocIds = new Set(citedHits.map((hit) => hit.docId));
  const requiredDocs = Array.from(new Set(requiredFindingDocs));
  const supportedFindingCount = requiredDocs.filter((docId) => citedDocIds.has(docId)).length;
  const traceableCitationCount = citedHits.filter((hit) => hit.source.references.length > 0).length;
  const reviewedCitationCount = citedHits.filter((hit) => hit.source.contentReviewStatus !== 'unreviewed').length;

  const citationValidity = ratio(
    citationCheck.validIds.length,
    citationCheck.validIds.length + citationCheck.invalidIds.length,
    0,
  );
  const findingCoverage = ratio(supportedFindingCount, requiredDocs.length, citationCheck.hasCitation ? 1 : 0);
  const traceability = ratio(traceableCitationCount, citedHits.length, 0);

  // 专业复核状态单独展示，不混进工程分，避免把尚未完成的临床验证包装成算法能力。
  const score = Math.round((citationValidity * 0.35 + findingCoverage * 0.4 + traceability * 0.25) * 100);
  const checks: VerificationCheck[] = [
    {
      id: 'citations',
      label: '引用编号有效',
      status: citationCheck.invalidIds.length === 0 && citationCheck.hasCitation ? 'pass' : 'fail',
      detail: citationCheck.invalidIds.length === 0
        ? `${citationCheck.validIds.length} 个引用均可回到本轮检索片段`
        : `发现无效引用：${citationCheck.invalidIds.map((id) => `[${id}]`).join('、')}`,
    },
    {
      id: 'risk_coverage',
      label: '高风险结论有据可查',
      status: checkStatus(findingCoverage),
      detail: requiredDocs.length === 0
        ? '本轮没有需要强制锚定的高风险发现'
        : `${supportedFindingCount}/${requiredDocs.length} 个高风险依据文档已被回答引用`,
    },
    {
      id: 'traceability',
      label: '来源可追溯',
      status: checkStatus(traceability),
      detail: `${traceableCitationCount}/${citedHits.length} 个被引片段登记了候选外部来源`,
    },
    {
      id: 'professional_review',
      label: '专业内容复核',
      status: reviewedCitationCount === citedHits.length && citedHits.length > 0 ? 'pass' : 'caution',
      detail: reviewedCitationCount === citedHits.length && citedHits.length > 0
        ? `${reviewedCitationCount} 个被引片段已完成专业复核`
        : `${reviewedCitationCount}/${citedHits.length} 个被引片段完成专业复核；当前结果仅用于工程演示`,
    },
  ];

  const blockingChecks = checks.filter((check) => check.id !== 'professional_review');
  const status: VerificationStatus = blockingChecks.some((check) => check.status === 'fail')
    ? 'fail'
    : checks.some((check) => check.status === 'caution')
      ? 'caution'
      : 'pass';

  return {
    status,
    score,
    validCitationCount: citationCheck.validIds.length,
    invalidCitationIds: citationCheck.invalidIds,
    supportedFindingCount,
    totalFindingCount: requiredDocs.length,
    traceableCitationCount,
    reviewedCitationCount,
    checks,
  };
}
