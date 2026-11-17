import { beforeAll, describe, expect, it } from 'vitest';
import { getPatient, getPatientMedViews, checkInteractions, findDrug } from '@/lib/data';
import { assessFindings, TOOLS, type ClinicalFinding, type MedPlan, type ToolContext } from '@/lib/tools';
import type { Patient, PatientMedView } from '@/lib/types';

/**
 * 工具层单测
 * ==================================================================
 * 工具全是确定性函数，因此可以像业务规则一样被断言。
 * 意义很直白：**改一条临床规则不会悄悄破坏另一条**——
 * 这正是"把判断交给代码"的价值，如果连测试都没有，就只是把魔法换了个位置。
 */

let ctx1: ToolContext;
let ctx2: ToolContext;
let ctx3: ToolContext;

async function makeCtx(id: string): Promise<ToolContext> {
  const patient = (await getPatient(id)) as Patient;
  const medViews: PatientMedView[] = await getPatientMedViews(patient);
  return { patient, medViews, runId: `test-${id}` };
}

beforeAll(async () => {
  [ctx1, ctx2, ctx3] = await Promise.all([makeCtx('p-001'), makeCtx('p-002'), makeCtx('p-003')]);
});

const titles = (findings: ClinicalFinding[]) => findings.map((f) => f.title).join(' | ');
const byId = (findings: ClinicalFinding[], id: string) => findings.find((f) => f.id === id);

describe('患者 1：抗凝出血 + 肾功能分层', () => {
  it('识别 INR 3.8 超上限', () => {
    const findings = assessFindings(ctx1);
    expect(findings.some((f) => f.title.includes('INR') && f.level === 'high')).toBe(true);
  });

  it('识别华法林 + 阿司匹林联用', () => {
    const findings = assessFindings(ctx1);
    expect(titles(findings)).toContain('抗凝药与抗血小板药叠加');
  });

  it('二甲双胍按 eGFR 42 判定为减量区间，而不是禁用', () => {
    const f = byId(assessFindings(ctx1), 'f-metformin-renal') ?? assessFindings(ctx1).find((x) => x.title.includes('二甲双胍'));
    expect(f).toBeTruthy();
    expect(f!.level).toBe('high');
    expect(`${f!.detail}${f!.action}`).toContain('减量');
  });

  it('格列本脲命中 Beers 清单', () => {
    const findings = assessFindings(ctx1);
    expect(findings.some((f) => f.title.includes('格列本脲'))).toBe(true);
  });

  it('每条高风险发现都挂着证据文档 id（引用可追溯的前提）', () => {
    const findings = assessFindings(ctx1).filter((f) => f.level !== 'info');
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(Array.isArray(f.evidence)).toBe(true);
      expect(f.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe('患者 2：三联打击 + 高钾', () => {
  it('识别血钾 5.6 的高钾风险', () => {
    const findings = assessFindings(ctx2);
    expect(findings.some((f) => f.title.includes('血钾'))).toBe(true);
  });

  it('识别利尿剂 + ACEI + NSAID 的三联打击', () => {
    const findings = assessFindings(ctx2);
    const hit = findings.some((f) => `${f.title}${f.detail}`.includes('三联')) || titles(findings).includes('NSAID');
    expect(hit).toBe(true);
  });
});

describe('患者 3：苯二氮䓬叠加与跌倒', () => {
  it('识别两种苯二氮䓬叠加', () => {
    const findings = assessFindings(ctx3);
    expect(titles(findings)).toContain('苯二氮');
  });

  it('老年人跌倒相关提示存在（标题或说明中）', () => {
    const findings = assessFindings(ctx3);
    const text = findings.map((f) => `${f.title}${f.detail}${f.action}`).join('');
    expect(/跌倒/.test(text)).toBe(true);
  });
});

describe('相互作用核查（确定性规则表）', () => {
  it('华法林 + 阿司匹林 = 高风险', async () => {
    const list = await checkInteractions(['warfarin', 'aspirin']);
    const hit = list.find((i) => i.severity === 'high');
    expect(hit).toBeTruthy();
    expect(hit!.mechanism.length).toBeGreaterThan(0);
  });

  it('无重叠药物时返回空数组', async () => {
    const list = await checkInteractions(['levothyroxine']);
    expect(list).toEqual([]);
  });
});

describe('药物名称归一化（多模态识别的前置条件）', () => {
  it('商品名「芬必得」映射到布洛芬', async () => {
    const drug = await findDrug('芬必得');
    expect(drug?.id).toBe('ibuprofen');
  });

  it('别名「优降糖」映射到格列本脲', async () => {
    const drug = await findDrug('优降糖');
    expect(drug?.id).toBe('glibenclamide');
  });
});

describe('工具契约', () => {
  it('8 个工具全部注册且都有入参说明', () => {
    const names = Object.keys(TOOLS);
    expect(names).toHaveLength(8);
    for (const name of names) {
      expect(TOOLS[name].run).toBeTypeOf('function');
      expect(TOOLS[name].title.length).toBeGreaterThan(0);
      expect(Array.isArray(TOOLS[name].params)).toBe(true);
    }
  });

  it('build_med_plan 产出五段式方案且字段非空', async () => {
    const out = await TOOLS.build_med_plan.run({}, ctx1);
    const plan = (out.data as { plan: MedPlan }).plan;
    expect(plan).toHaveProperty('keep');
    expect(plan).toHaveProperty('adjust');
    expect(plan).toHaveProperty('stop');
    expect(plan).toHaveProperty('followUp');
    expect(plan).toHaveProperty('education');
    expect(plan.stop.length + plan.adjust.length).toBeGreaterThan(0);
    expect(plan.followUp[0].items.length).toBeGreaterThan(0);
  });

  it('用药重整只允许直接停止自行加服药，处方药调整必须交给医生', async () => {
    const out = await TOOLS.build_med_plan.run({}, ctx1);
    const plan = (out.data as { plan: MedPlan }).plan;
    expect(plan.stop.some((item) => item.name.includes('布洛芬'))).toBe(true);
    expect(plan.stop.some((item) => /华法林|阿司匹林|二甲双胍|格列本脲/.test(item.name))).toBe(false);
    const aspirin = plan.adjust.find((item) => item.name.includes('阿司匹林'));
    expect(aspirin?.reason).toMatch(/医生.*决定/);
  });

  it('lab_assess 返回结构化发现与摘要', async () => {
    const out = await TOOLS.lab_assess.run({}, ctx1);
    expect(out.summary.length).toBeGreaterThan(0);
    expect(Array.isArray((out.data as { findings: ClinicalFinding[] }).findings)).toBe(true);
  });
});
