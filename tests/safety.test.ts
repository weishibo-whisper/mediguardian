import { beforeAll, describe, expect, it } from 'vitest';
import { getRedFlags, getPatient } from '@/lib/data';
import { SAFETY_DISCLAIMER, detectRedFlags, guardOutput, maskPii, screenInput } from '@/lib/safety';
import type { KbHit, Patient, RedFlagRule } from '@/lib/types';

/**
 * 安全层单测
 * ==================================================================
 * 这是「AI 安全」这一项能不能拿分的地方，也最容易写成"只有提示语"。
 * 这里的测试断言的都不是文案，而是**行为**：
 * 红旗必须升级为 block、PII 必须真的被替换、诊断断言必须被改写。
 */

let flags: RedFlagRule[];
let patient: Patient;

beforeAll(async () => {
  flags = await getRedFlags();
  patient = (await getPatient('p-001')) as Patient;
});

describe('红旗症状识别', () => {
  it('「大便发黑 + 牙龈出血」命中上消化道出血并为 block', async () => {
    const report = await screenInput('最近牙龈出血、大便发黑，是不是止痛药引起的？', patient);
    expect(report.level).toBe('block');
    expect(report.forceReferral).toBe(true);
    expect(report.flags.some((f) => f.title.includes('消化道出血'))).toBe(true);
  });

  it('胸痛命中急诊类红旗', async () => {
    const report = await screenInput('今天胸口疼，冒冷汗', patient);
    expect(report.forceReferral).toBe(true);
    expect(report.level).toBe('block');
  });

  it('一般咨询不触发红旗（避免过度转诊）', async () => {
    const report = await screenInput('我妈这些药一起吃安全吗', patient);
    expect(report.forceReferral).toBe(false);
    expect(report.level).not.toBe('block');
  });

  it('红旗规则库规模与数据结构稳定（11 条，含分诊去向）', () => {
    expect(flags).toHaveLength(11);
    for (const rule of flags) {
      expect(rule.keywords.length).toBeGreaterThan(0);
      expect(rule.escalateTo.length).toBeGreaterThan(0);
      expect(['emergency', 'urgent']).toContain(rule.level);
    }
  });

  it('detectRedFlags 命中多条时全部返回，并正确标记急诊', () => {
    const result = detectRedFlags('胸痛、冒冷汗，还说不出话、一侧无力', flags);
    expect(result.matched.length).toBeGreaterThanOrEqual(2);
    expect(result.hasEmergency).toBe(true);
  });

  it('detectRedFlags 对普通表述不误报', () => {
    const result = detectRedFlags('最近想复查一下血脂', flags);
    expect(result.matched).toHaveLength(0);
    expect(result.hasEmergency).toBe(false);
  });
});

describe('PII 脱敏', () => {
  it('手机号 / 身份证 / 银行卡 / 邮箱都被掩码', () => {
    const { text, found } = maskPii('电话13800138000，身份证110101195001011234，卡号6222021234567890123，邮箱a.b@c.com');
    expect(text).not.toContain('13800138000');
    expect(text).not.toContain('110101195001011234');
    expect(text).not.toContain('6222021234567890123');
    expect(text).not.toContain('a.b@c.com');
    expect(found.length).toBeGreaterThanOrEqual(3);
  });

  it('不含敏感信息时原样返回', () => {
    const input = '华法林吃了半年，最近复查 INR 3.8';
    const { text } = maskPii(input);
    expect(text).toBe(input);
  });

  it('screenInput 输出的 sanitizedText 已脱敏（推理只能用脱敏文本）', async () => {
    const report = await screenInput('我的电话是 13900001111，最近头晕', patient);
    expect(report.sanitizedText).not.toContain('13900001111');
  });
});

describe('输出守门', () => {
  const hits: KbHit[] = [
    {
      chunkId: 'kb-a#0',
      docId: 'kb-a',
      title: 'A',
      section: '小节',
      tags: [],
      text: '华法林与阿司匹林联用增加出血风险',
      score: 1,
      scoreBreakdown: { bm25: 1, vector: 1, rrf: 1, rerank: 0 },
    },
  ];

  it('诊断断言被改写为推测性表述', () => {
    const r = guardOutput('确诊为胃溃疡，就是抗凝药引起的。', hits, 'strict');
    expect(r.text).not.toMatch(/确诊为/);
    expect(r.text).toMatch(/可能涉及|提示/);
    expect(r.flags.length).toBeGreaterThan(0);
  });

  it('剂量数字缺少引用时被标记', () => {
    const r = guardOutput('华法林改为 3 mg，每天一次。', hits, 'strict');
    const noCiteFlagged = r.flags.some((f) => f.detail.includes('引用') || f.title.includes('引用') || f.title.includes('剂量'));
    expect(noCiteFlagged).toBe(true);
  });

  it('有引用的剂量不被误伤', () => {
    const r = guardOutput('华法林 2.5 mg 每日一次，需由医师核定 [1]。', hits, 'strict');
    expect(r.text).toContain('2.5 mg');
  });

  it('守门不会把免责声明之外的内容删空', () => {
    const r = guardOutput('### 一句话结论\n请按医嘱服药，7 天后复查。', hits, 'strict');
    expect(r.text.length).toBeGreaterThan(10);
    expect(SAFETY_DISCLAIMER.length).toBeGreaterThan(10);
  });
});
