import { describe, expect, it } from 'vitest';
import { resolveFollowUpQuestion } from '@/lib/agent/runtime';

describe('多轮追问语境消解', () => {
  it('为明显追问补回上一轮用户问题', () => {
    const result = resolveFollowUpQuestion('那我现在先做什么？', [
      { role: 'user', content: '最近牙龈出血、大便发黑，是不是止痛药引起的？' },
      { role: 'assistant', content: '请立即就医。' },
    ]);
    expect(result).toContain('牙龈出血');
    expect(result).toContain('追问：那我现在先做什么？');
  });

  it('独立的新问题不继承旧主题', () => {
    const result = resolveFollowUpQuestion('这个月的检验结果需要复查哪些项目？', [
      { role: 'user', content: '昨天睡不着怎么办？' },
    ]);
    expect(result).toBe('这个月的检验结果需要复查哪些项目？');
  });

  it('短但语义完整的新问题不继承旧主题', () => {
    const result = resolveFollowUpQuestion('牙疼怎么办？', [
      { role: 'user', content: '昨天睡不着怎么办？' },
    ]);
    expect(result).toBe('牙疼怎么办？');
  });

  it('历史问题先脱敏再进入上下文', () => {
    const result = resolveFollowUpQuestion('那怎么办？', [
      { role: 'user', content: '手机号 13800138000，最近大便发黑' },
    ]);
    expect(result).not.toContain('13800138000');
    expect(result).toContain('138****8000');
  });
});
