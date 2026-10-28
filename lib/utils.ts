import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind 类名合并（后写的类覆盖前面的冲突类） */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 生成短 id，用于 runId / messageId */
export function shortId(prefix = 'r') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

/** 严重程度 → 中文标签与配色 */
export const SEVERITY_META: Record<
  'high' | 'moderate' | 'low',
  { label: string; tone: string; dot: string }
> = {
  high: { label: '高风险', tone: 'text-danger bg-danger/10 border-danger/25', dot: 'bg-danger' },
  moderate: {
    label: '中风险',
    tone: 'text-warn bg-warn/10 border-warn/25',
    dot: 'bg-warn',
  },
  low: { label: '低风险', tone: 'text-ok bg-ok/10 border-ok/25', dot: 'bg-ok' },
};

/** 毫秒 → 可读耗时 */
export function fmtMs(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** 置信度 → 文案与色阶 */
export function confidenceMeta(score: number) {
  if (score >= 0.75) return { label: '证据充分', tone: 'text-ok' };
  if (score >= 0.5) return { label: '证据一般', tone: 'text-warn' };
  return { label: '证据不足', tone: 'text-danger' };
}

/** 把 eGFR 映射为慢性肾脏病分期描述 */
export function ckdStage(eGFR?: number) {
  if (!eGFR) return { stage: '未知', tone: 'text-ink-mute' };
  if (eGFR >= 90) return { stage: 'G1（正常）', tone: 'text-ok' };
  if (eGFR >= 60) return { stage: 'G2（轻度下降）', tone: 'text-ok' };
  if (eGFR >= 45) return { stage: 'G3a（轻中度下降）', tone: 'text-warn' };
  if (eGFR >= 30) return { stage: 'G3b（中重度下降）', tone: 'text-warn' };
  if (eGFR >= 15) return { stage: 'G4（重度下降）', tone: 'text-danger' };
  return { stage: 'G5（肾衰竭）', tone: 'text-danger' };
}
