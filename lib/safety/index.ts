import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { KbHit, Patient, RedFlagRule, SafetyFlag, SafetyReport } from '@/lib/types';
import { getRedFlags } from '@/lib/data';

/**
 * AI 安全与可控性层
 * ------------------------------------------------------------------
 * 四道闸门：
 *  1. 输入侧：红旗症状识别（触发强制转诊）+ PII 脱敏（姓名/手机号/身份证/银行卡）
 *  2. 过程侧：工具调用白名单 + 步数上限 + 超时
 *  3. 输出侧：诊断断言拦截、绝对化表述拦截、无引用剂量拦截、引用合法性校验
 *  4. 事后：JSONL 审计日志，支持「决策轨迹回放」，满足可追溯要求
 */

export const SAFETY_DISCLAIMER =
  '本建议由 AI 依据公开资料与本地知识库生成，供基层医护与家属参考，不构成诊断或处方。任何用药调整须经执业医师确认。';

/** 需要脱敏的字段 */
const PII_PATTERNS: Array<{ id: string; label: string; regex: RegExp; mask: (m: string) => string }> = [
  {
    id: 'phone',
    label: '手机号',
    regex: /1[3-9]\d{9}/g,
    mask: (m) => `${m.slice(0, 3)}****${m.slice(-4)}`,
  },
  {
    id: 'idcard',
    label: '身份证号',
    regex: /\b\d{17}[\dXx]\b/g,
    mask: (m) => `${m.slice(0, 6)}********${m.slice(-4)}`,
  },
  {
    id: 'bankcard',
    label: '银行卡号',
    regex: /\b\d{16,19}\b/g,
    mask: (m) => `${m.slice(0, 4)} **** **** ${m.slice(-4)}`,
  },
  {
    id: 'email',
    label: '邮箱',
    regex: /[\w.+-]+@[\w-]+\.[\w.]+/g,
    mask: (m) => `${m[0]}***@${m.split('@')[1]}`,
  },
];

/** PII 脱敏：返回脱敏文本与命中的类型 */
export function maskPii(text: string): { text: string; found: string[] } {
  let out = text;
  const found: string[] = [];
  for (const rule of PII_PATTERNS) {
    if (rule.regex.test(out)) {
      found.push(rule.label);
      out = out.replace(rule.regex, (m) => rule.mask(m));
    }
    rule.regex.lastIndex = 0;
  }
  return { text: out, found };
}

/** 红旗症状匹配（多关键词命中取最高等级） */
export function detectRedFlags(text: string, rules: RedFlagRule[]) {
  const isExplicitlyNegated = (start: number, end: number) => {
    const before = text.slice(Math.max(0, start - 24), start);
    const after = text.slice(end, end + 12);
    const negation = /(?:没有|未见|否认|不伴(?:有)?|无|并无|未出现|从未|未曾)(?:出现|发生|冒|手抖|肢体无力|明显|任何|当前)?\s*$/;
    const beforeMatch = before.match(negation);
    if (beforeMatch) {
      const prefix = before.slice(0, beforeMatch.index);
      if (!/(?:不是|并非|并不是|不能排除)\s*$/.test(prefix)) return true;
    }
    return /^\s*(?:没有|未见|否认|不伴(?:有)?|无|并无|不存在|已经消失|已缓解)/.test(after);
  };

  const matched = rules.filter((rule) => rule.keywords.some((keyword) => {
    let from = 0;
    while (from < text.length) {
      const index = text.indexOf(keyword, from);
      if (index < 0) return false;
      if (!isExplicitlyNegated(index, index + keyword.length)) return true;
      from = index + keyword.length;
    }
    return false;
  }));
  const emergency = matched.filter((r) => r.level === 'emergency');
  return { matched, hasEmergency: emergency.length > 0 };
}

/**
 * 输入侧安全审查
 * @param text 用户原始输入
 * @param patient 当前患者（用于上下文相关提示）
 */
export async function screenInput(text: string, patient?: Patient): Promise<SafetyReport> {
  const flags: SafetyFlag[] = [];
  const { text: sanitized, found } = maskPii(text);

  if (found.length > 0) {
    flags.push({
      id: 'pii-mask',
      category: 'pii',
      level: 'info',
      title: '已自动脱敏个人信息',
      detail: `检测到 ${found.join('、')}；若启用外部模型，本应用会先在服务端掩码该字段。原文已提交至本应用服务端，请勿在图片或其他字段中填写额外敏感信息。`,
      action: '仅以脱敏文本参与推理',
    });
  }

  const rules = await getRedFlags();
  const { matched, hasEmergency } = detectRedFlags(sanitized, rules);

  for (const rule of matched) {
    flags.push({
      id: rule.id,
      category: 'redflag',
      level: rule.level === 'emergency' ? 'critical' : 'warn',
      title: rule.title,
      detail: `${rule.action}（建议转往：${rule.escalateTo}）`,
      action: `已插入转诊卡片并标注「${rule.escalateTo}」`,
    });
  }

  if (patient && patient.age >= 75 && /加量|多吃|再来一片|自己加/.test(sanitized)) {
    flags.push({
      id: 'self-adjust-elderly',
      category: 'scope',
      level: 'warn',
      title: '高龄患者自行调整剂量',
      detail: '≥75 岁患者自行加量是跌倒、出血与低血糖的常见诱因，Agent 将拒绝给出具体加量数值。',
      action: '改为「联系医生确认」路径',
    });
  }

  const level = hasEmergency ? 'block' : flags.some((f) => f.level === 'warn') ? 'notice' : 'ok';
  return {
    level,
    flags,
    forceReferral: hasEmergency,
    requireDisclaimer: true,
    sanitizedText: sanitized,
  };
}

/** 红旗命中时，模型回答缺少紧急处置提示则由确定性规则补到最前。 */
export function enforceReferralPriority(
  answer: string,
  report: Pick<SafetyReport, 'forceReferral' | 'flags'>,
): string {
  const opening = answer.replace(/^#{1,3}\s+[^\n]+\n+/, '').replace(/^\*+/, '').trimStart();
  if (
    !report.forceReferral ||
    /^(?:先别在家观察|立即就医|立即拨打\s*120|请立即就医|请立即拨打\s*120)/.test(opening)
  ) {
    return answer;
  }
  const flag = report.flags.find((item) => item.category === 'redflag');
  const title = flag?.title ?? '危险信号';
  return `### 紧急处置\n\n**检测到${title}。请立即拨打 120 或前往急诊，不要等待线上用药建议。**\n\n${answer}`;
}

/** 输出侧守卫：诊断断言 / 绝对化 / 无引用剂量 / 超范围处置 */
export function guardOutput(answer: string, hits: KbHit[], mode: 'strict' | 'balanced' = 'strict') {
  const flags: SafetyFlag[] = [];
  let text = answer;

  const diagnosisPatterns: Array<[RegExp, string]> = [
    [/(确诊为|诊断为|就是|肯定是|一定是)(?!.*需)/g, '出现诊断性断言'],
    [/(绝对|百分百|保证|一定能|永远不会|完全没风险)/g, '出现绝对化表述'],
    [/(不用去医院|不需要就医|不用管|停药就行)/g, '出现弱化就医的表述'],
  ];

  for (const [regex, title] of diagnosisPatterns) {
    if (regex.test(text)) {
      flags.push({
        id: `guard-${title}`,
        category: 'output_guard',
        level: 'warn',
        title,
        detail: `输出命中「${title}」规则，已改为不确定性表述并补充就医提示。`,
        action: '已重写为参考性建议',
      });
      text = text.replace(regex, '可能涉及');
    }
  }

  const medicationActionLines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /(?:停用|暂停|减量|加量|增量|改用|换用|加用)/.test(line))
    .filter((line) => !/(?:医生|医师|医嘱|急诊|就医|核定|讨论|评估|不要自行|不得自行|不能自行)/.test(line));
  if (medicationActionLines.length > 0) {
    flags.push({
      id: 'guard-medication-action-scope',
      category: 'scope',
      level: mode === 'strict' ? 'critical' : 'warn',
      title: '处方调整缺少医生确认边界',
      detail: `检测到 ${medicationActionLines.length} 处停药、减量或换药动作未说明由执业医师确认。`,
      action: '已追加“不要自行调整处方药”安全边界',
    });
    text += '\n\n> 上述涉及停用、暂停、减量或换药的内容，均须由执业医师结合现场评估确认；请勿自行调整处方药。';
  }

  const invalidCitations = new Set<number>();
  text = text.replace(/\[(\d+)\]/g, (citation, rawIndex: string) => {
    const index = Number(rawIndex);
    if (index >= 1 && index <= hits.length) return citation;
    invalidCitations.add(index);
    return '';
  });
  if (invalidCitations.size > 0) {
    flags.push({
      id: 'guard-invalid-citations',
      category: 'citation',
      level: 'warn',
      title: '引用编号无效',
      detail: `回答中的引用编号 ${Array.from(invalidCitations).join('、')} 不对应本轮检索结果，已移除。`,
      action: '仅展示可对应到本轮检索结果的引用',
    });
  }

  const hasDose = /\d+(\.\d+)?\s*(mg|毫克|g|克|μg|微克|ml|毫升)/.test(text);
  const hasCitation = /\[\d+\]/.test(text);
  if (hasDose && !hasCitation) {
    flags.push({
      id: 'guard-dose-no-citation',
      category: 'citation',
      level: mode === 'strict' ? 'critical' : 'warn',
      title: '剂量表述缺少证据引用',
      detail: '涉及具体剂量的结论必须能追溯到知识库条目，否则视为不可信输出。',
      action: '已追加「须由医师核定剂量」提示',
    });
    text += '\n\n> 涉及剂量的内容须由执业医师依据患者具体情况核定，本文仅给出调整方向。';
  }

  if (hits.length === 0) {
    flags.push({
      id: 'guard-no-evidence',
      category: 'scope',
      level: 'warn',
      title: '未检索到本地证据',
      detail: '知识库中缺少与该问题直接相关的条目，已切换为保守回答并提示就医确认。',
      action: '降级为保守回答',
    });
  }

  const level: SafetyReport['level'] = flags.some((f) => f.level === 'critical')
    ? 'block'
    : flags.length > 0
      ? 'notice'
      : 'ok';

  return { text, flags, level };
}

/* ------------------------------------------------------------------
 * 审计日志：每次运行追加一行 JSONL，字段与 AgentRun 对齐
 * ------------------------------------------------------------------ */

const AUDIT_PATH = process.env.AUDIT_LOG_PATH || 'logs/audit.jsonl';

export interface AuditEntry {
  runId: string;
  at: string;
  patientId: string;
  question: string;
  mode: string;
  model: string;
  safetyLevel: string;
  flags: string[];
  tools: string[];
  citations: string[];
  durationMs: number;
  confidence: number;
  chainVersion?: 1;
  prevHash?: string;
  entryHash?: string;
}

export interface AuditChainReport {
  status: 'empty' | 'legacy' | 'valid' | 'broken';
  totalLines: number;
  legacyLines: number;
  chainedLines: number;
  verifiedLines: number;
  firstBrokenLine?: number;
}

const GENESIS_HASH = 'GENESIS';
const hashText = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const nonEmptyLines = (raw: string) => raw.split(/\r?\n/).filter((line) => line.trim().length > 0);

export function verifyAuditLines(lines: string[]): AuditChainReport {
  if (lines.length === 0) {
    return { status: 'empty', totalLines: 0, legacyLines: 0, chainedLines: 0, verifiedLines: 0 };
  }

  const legacyPrefix: string[] = [];
  let previousRaw = '';
  let chainedLines = 0;
  let verifiedLines = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    let parsed: AuditEntry;
    try {
      parsed = JSON.parse(raw) as AuditEntry;
    } catch {
      return {
        status: 'broken',
        totalLines: lines.length,
        legacyLines: legacyPrefix.length,
        chainedLines,
        verifiedLines,
        firstBrokenLine: index + 1,
      };
    }

    if (!parsed.entryHash || !parsed.prevHash || parsed.chainVersion !== 1) {
      if (chainedLines > 0) {
        return {
          status: 'broken',
          totalLines: lines.length,
          legacyLines: legacyPrefix.length,
          chainedLines,
          verifiedLines,
          firstBrokenLine: index + 1,
        };
      }
      legacyPrefix.push(raw);
      previousRaw = raw;
      continue;
    }

    const expectedPrev = chainedLines === 0
      ? (legacyPrefix.length > 0 ? hashText(legacyPrefix.join('\n')) : GENESIS_HASH)
      : hashText(previousRaw);
    const { entryHash, ...payload } = parsed;
    const valid = parsed.prevHash === expectedPrev && entryHash === hashText(JSON.stringify(payload));
    if (!valid) {
      return {
        status: 'broken',
        totalLines: lines.length,
        legacyLines: legacyPrefix.length,
        chainedLines: chainedLines + 1,
        verifiedLines,
        firstBrokenLine: index + 1,
      };
    }
    chainedLines += 1;
    verifiedLines += 1;
    previousRaw = raw;
  }

  return {
    status: chainedLines > 0 ? 'valid' : 'legacy',
    totalLines: lines.length,
    legacyLines: legacyPrefix.length,
    chainedLines,
    verifiedLines,
  };
}

export function createChainedAuditEntry(entry: AuditEntry, existingRaw = ''): AuditEntry {
  const lines = nonEmptyLines(existingRaw);
  const last = lines.at(-1);
  const lastParsed = last ? (() => {
    try {
      return JSON.parse(last) as AuditEntry;
    } catch {
      return null;
    }
  })() : null;
  const prevHash = lines.length === 0
    ? GENESIS_HASH
    : lastParsed?.entryHash
      ? hashText(last as string)
      : hashText(lines.join('\n'));
  const payload: AuditEntry = { ...entry, chainVersion: 1, prevHash };
  return { ...payload, entryHash: hashText(JSON.stringify(payload)) };
}

let auditWriteQueue: Promise<void> = Promise.resolve();

async function appendAuditUnsafe(entry: AuditEntry): Promise<void> {
  try {
    const full = path.join(process.cwd(), AUDIT_PATH);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const existingRaw = await fs.readFile(full, 'utf-8').catch(() => '');
    const chained = createChainedAuditEntry(entry, existingRaw);
    await fs.appendFile(full, `${JSON.stringify(chained)}\n`, 'utf-8');
  } catch {
    // 审计写入失败不应阻塞主流程（例如只读部署环境），仅静默降级
  }
}

export async function appendAudit(entry: AuditEntry): Promise<void> {
  auditWriteQueue = auditWriteQueue.then(() => appendAuditUnsafe(entry));
  await auditWriteQueue;
}

export async function verifyAuditChain(): Promise<AuditChainReport> {
  try {
    const full = path.join(process.cwd(), AUDIT_PATH);
    return verifyAuditLines(nonEmptyLines(await fs.readFile(full, 'utf-8')));
  } catch {
    return { status: 'empty', totalLines: 0, legacyLines: 0, chainedLines: 0, verifiedLines: 0 };
  }
}

/** 读取最近 N 条审计记录（安全审计页） */
export async function readAudit(limit = 50): Promise<AuditEntry[]> {
  try {
    const full = path.join(process.cwd(), AUDIT_PATH);
    const raw = await fs.readFile(full, 'utf-8');
    return nonEmptyLines(raw)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as AuditEntry];
        } catch {
          return [];
        }
      })
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}
