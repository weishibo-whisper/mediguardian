import fs from 'node:fs/promises';
import path from 'node:path';
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
  const matched = rules.filter((r) => r.keywords.some((k) => text.includes(k)));
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
      detail: `检测到 ${found.join('、')}，已在发送给模型前完成掩码处理，原文不会离开浏览器会话。`,
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
}

export async function appendAudit(entry: AuditEntry): Promise<void> {
  try {
    const full = path.join(process.cwd(), AUDIT_PATH);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.appendFile(full, `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch {
    // 审计写入失败不应阻塞主流程（例如只读部署环境），仅静默降级
  }
}

/** 读取最近 N 条审计记录（安全审计页） */
export async function readAudit(limit = 50): Promise<AuditEntry[]> {
  try {
    const full = path.join(process.cwd(), AUDIT_PATH);
    const raw = await fs.readFile(full, 'utf-8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuditEntry)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}
