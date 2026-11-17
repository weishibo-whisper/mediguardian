import type { InteractionRule, KbHit, Patient, Severity } from '@/lib/types';
import type { PatientMedView } from '@/lib/data';
import { checkInteractions, extractDrugs, findDrug, getDrugs } from '@/lib/data';
import { searchKb } from '@/lib/rag';

/**
 * Agent 工具层（Tool Layer）
 * ------------------------------------------------------------------
 * 8 个工具覆盖「取数 → 核查 → 分层 → 取证 → 出方案 → 转诊 → 通知 → 播报」闭环。
 * 所有工具都是纯函数式：输入显式参数，输出结构化结果 + 证据文档 id，
 * 因此既能被前端 Agent 运行时调用，也能被 MCP Server 原样暴露给外部 Agent。
 *
 * 注意：工具内部不含任何自然语言生成，避免「用模型判断模型」的循环；
 * 需要语言表达的部分交由 Agent 的生成阶段统一完成。
 */

export interface ToolContext {
  patient: Patient;
  medViews: PatientMedView[];
  runId: string;
  /** 当前用户问题（已脱敏），部分工具需要据此构造检索式 */
  question?: string;
}

export interface ClinicalFinding {
  id: string;
  level: 'high' | 'moderate' | 'info';
  title: string;
  detail: string;
  action: string;
  /** 关联知识库文档，供引用面板追溯 */
  evidence: string[];
}

export interface ToolOutput {
  summary: string;
  data?: unknown;
  hits?: KbHit[];
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  params: Array<{ name: string; type: string; required: boolean; description: string }>;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutput>;
}

const has = (ids: string[], id: string) => ids.includes(id);

/* ==================================================================
 * 1. 患者档案读取
 * ================================================================== */
const getPatientTool: ToolDefinition = {
  name: 'get_patient',
  title: '读取患者档案',
  description: '返回患者基本信息、诊断、检验指标与全部用药清单，是后续所有分析的基础。',
  params: [{ name: 'patientId', type: 'string', required: false, description: '患者 id，缺省用当前会话患者' }],
  async run(_args, ctx) {
    const { patient, medViews } = ctx;
    return {
      summary: `已载入 ${patient.name}（${patient.age} 岁）档案：${patient.meds.length} 种在用药，${patient.conditions.length} 项诊断，最近随访 ${patient.lastVisit}`,
      data: {
        patient: {
          id: patient.id,
          name: patient.name,
          age: patient.age,
          sex: patient.sex,
          conditions: patient.conditions,
          labs: patient.labs,
          adherence: patient.adherence,
        },
        meds: medViews,
      },
    };
  },
};

/* ==================================================================
 * 2. 相互作用核查
 * ================================================================== */
const checkInteractionTool: ToolDefinition = {
  name: 'check_interaction',
  title: '药物相互作用核查',
  description:
    '对患者全部在用药（或指定药物）做两两相互作用核查，返回严重程度、机制、处置建议与证据文档。',
  params: [
    { name: 'drugIds', type: 'string[]', required: false, description: '待核查药物 id 列表，缺省为患者全部用药' },
    { name: 'extraText', type: 'string', required: false, description: '额外描述（如患者自行加服的药名）' },
  ],
  async run(args, ctx) {
    let ids = Array.isArray(args.drugIds)
      ? (args.drugIds as string[])
      : ctx.medViews.map((m) => m.drugId);

    // 支持从自然语言中补充识别未登记的自购药
    if (typeof args.extraText === 'string' && args.extraText.trim()) {
      const extra = await extractDrugs(args.extraText);
      ids = Array.from(new Set([...ids, ...extra.map((d) => d.id)]));
    }

    const findings = await checkInteractions(ids);
    const drugNames = new Map<string, string>();
    for (const d of await getDrugs()) drugNames.set(d.id, d.name);

    const enriched = findings.map((f: InteractionRule) => ({
      pair: `${drugNames.get(f.a) ?? f.a} + ${drugNames.get(f.b) ?? f.b}`,
      severity: f.severity,
      mechanism: f.mechanism,
      action: f.action,
      evidence: f.evidence,
    }));

    const high = enriched.filter((e) => e.severity === 'high').length;
    const moderate = enriched.filter((e) => e.severity === 'moderate').length;

    return {
      summary:
        enriched.length === 0
          ? `未在规则库中发现相互作用（核查 ${ids.length} 种药物）`
          : `共发现 ${enriched.length} 组相互作用：高风险 ${high} 组、中风险 ${moderate} 组`,
      data: { checked: ids.length, interactions: enriched },
    };
  },
};

/* ==================================================================
 * 3. 检验指标分层评估（肾功能 / 电解质 / 凝血 / 血糖 / 跌倒）
 * ================================================================== */
function assessLabs(ctx: ToolContext): ClinicalFinding[] {
  const { patient, medViews } = ctx;
  const ids = medViews.map((m) => m.drugId);
  const age = patient.age;
  const { eGFR, potassium, INR, hemoglobin } = patient.labs;
  const findings: ClinicalFinding[] = [];

  /* --- 肾功能与二甲双胍 --- */
  if (has(ids, 'metformin') && typeof eGFR === 'number') {
    if (eGFR < 30) {
      findings.push({
        id: 'f-metformin-contra',
        level: 'high',
        title: `二甲双胍在 eGFR ${eGFR} 时应停用`,
        detail: 'eGFR < 30 mL/min/1.73m² 时二甲双胍蓄积，乳酸酸中毒风险显著升高。',
        action: '建议停用二甲双胍，由医生改用其他降糖方案；急性病、脱水、造影检查期间亦应暂停。',
        evidence: ['kb-diabetes-basics'],
      });
    } else if (eGFR < 45) {
      findings.push({
        id: 'f-metformin-reduce',
        level: 'high',
        title: `二甲双胍需按肾功能减量（eGFR ${eGFR}）`,
        detail: 'eGFR 30–44 属减量区间，常用上限约 1 g/d，且需更频繁监测肾功能。',
        action: '由医生评估是否减量，并在 4 周内复查 eGFR；避免脱水与擅自加量。',
        evidence: ['kb-diabetes-basics'],
      });
    }
  }

  /* --- 长效磺脲类 + 高龄 --- */
  if (has(ids, 'glibenclamide') && age >= 65) {
    findings.push({
      id: 'f-glibenclamide-beers',
      level: 'high',
      title: `格列本脲不适用于 ${age} 岁患者`,
      detail: '长效磺脲类在老年人与肾功能下降者体内蓄积，可致严重且持久的低血糖，属 Beers 清单建议避免用药。',
      action: '建议在医生指导下换用低血糖风险更低的方案（如格列齐特缓释、DPP-4 抑制剂或胰岛素个体化方案）。',
      evidence: ['kb-beers-elderly', 'kb-diabetes-basics'],
    });
  }

  /* --- 苯二氮䓬类叠加 + 高龄 + 跌倒史 --- */
  const bzd = ids.filter((id) => ['estazolam', 'diazepam'].includes(id));
  if (bzd.length >= 2) {
    findings.push({
      id: 'f-bzd-stacking',
      level: 'high',
      title: '两种苯二氮䓬类同时使用（跌倒与过度镇静风险）',
      detail: '艾司唑仑与地西泮叠加会显著延长镇静时间，夜间起夜跌倒与次日认知损害风险成倍增加。',
      action: '只保留一种并由医生逐步减量，禁止自行叠加；优先采用睡眠卫生教育与 CBT-I。',
      evidence: ['kb-beers-elderly', 'kb-falls'],
    });
  } else if (bzd.length === 1 && age >= 75) {
    findings.push({
      id: 'f-bzd-elderly',
      level: 'moderate',
      title: '高龄患者长期使用镇静催眠药',
      detail: '苯二氮䓬类在 ≥75 岁人群中与跌倒、骨折、谵妄和认知下降相关。',
      action: '与医生讨论逐步减停计划（每 2 周减 25%），同时处理失眠的非药物方案。',
      evidence: ['kb-beers-elderly', 'kb-falls'],
    });
  }

  /* --- 抗胆碱能负荷 --- */
  if (has(ids, 'diphenhydramine') && age >= 65) {
    findings.push({
      id: 'f-anticholinergic',
      level: 'moderate',
      title: '第一代抗组胺药抗胆碱能负荷高',
      detail: '苯海拉明可致意识模糊、便秘、尿潴留与跌倒，老年人应避免。',
      action: '由医生评估改用第二代抗组胺药或外用止痒制剂；已出现排尿困难者需及时就医。',
      evidence: ['kb-beers-elderly'],
    });
  }

  /* --- 抗凝强度与出血 --- */
  if (has(ids, 'warfarin') && typeof INR === 'number' && INR > 0) {
    if (INR >= 5) {
      findings.push({
        id: 'f-inr-critical',
        level: 'high',
        title: `INR ${INR} 明显超出治疗窗`,
        detail: 'INR ≥5 时颅内与消化道出血风险陡增，需当日处理。',
        action: '立即联系医生或前往急诊，不要自行加服维生素 K 或停药。',
        evidence: ['kb-anticoag-bleeding'],
      });
    } else if (INR > 3) {
      findings.push({
        id: 'f-inr-high',
        level: 'high',
        title: `INR ${INR} 高于目标上限`,
        detail: '目标 INR 通常为 2.0–3.0；超过 3.0 需评估出血征象并调整剂量。',
        action: '3–7 天内复查 INR，记录牙龈出血、皮下淤青、大便颜色变化。',
        evidence: ['kb-anticoag-bleeding'],
      });
    }
  }

  /* --- 抗凝 + 抗血小板 --- */
  if (has(ids, 'warfarin') && has(ids, 'aspirin')) {
    findings.push({
      id: 'f-anticoag-antiplatelet',
      level: 'high',
      title: '抗凝药与抗血小板药叠加',
      detail: '华法林 + 阿司匹林使消化道出血风险升高约 2–3 倍，仅在机械瓣、近期支架等明确指征下由专科联用。',
      action: '立即核对是否存在明确联用指征；由接诊医生决定是否暂缓或停用阿司匹林，并评估胃黏膜保护。',
      evidence: ['kb-anticoag-bleeding', 'kb-antiplatelet'],
    });
  }

  /* --- NSAID 相关 --- */
  const nsaids = ids.filter((id) => ['ibuprofen', 'diclofenac'].includes(id));
  const hasAcei = ids.some((id) => ['enalapril', 'losartan'].includes(id));
  const hasDiuretic = ids.some((id) => ['furosemide', 'hydrochlorothiazide'].includes(id));

  for (const nsaid of nsaids) {
    if (typeof eGFR === 'number' && eGFR < 60) {
      findings.push({
        id: `f-nsaid-renal-${nsaid}`,
        level: 'high',
        title: `肾功能下降者使用 NSAID（eGFR ${eGFR}）`,
        detail: 'NSAID 收缩入球小动脉，在 eGFR < 60 时可诱发急性肾损伤并升高血钾。',
        action: '停止自行加服口服 NSAID；若为处方药，由医生决定是否暂停，替代止痛方案也需由医生评估。',
        evidence: ['kb-nsaid-renal'],
      });
    }
    if (has(ids, 'warfarin')) {
      findings.push({
        id: `f-nsaid-anticoag-${nsaid}`,
        level: 'high',
        title: 'NSAID 与抗凝药同时使用',
        detail: '抗凝 + NSAID 使上消化道出血风险升高约 2–3 倍，且部分 NSAID 会干扰华法林代谢。',
        action: '避免联用；如已出现黑便、牙龈出血需当日就医。',
        evidence: ['kb-nsaid-anticoag'],
      });
    }
    if (hasAcei && hasDiuretic) {
      findings.push({
        id: 'f-triple-whammy',
        level: 'high',
        title: '「三联打击」组合：利尿剂 + ACEI/ARB + NSAID',
        detail: '三者共同降低肾小球滤过压，是社区获得性急性肾损伤最常见的可预防原因。',
        action: '停止自行加服 NSAID；若为处方药，由医生决定是否暂停，3–7 天内复查肌酐、血钾与尿量。',
        evidence: ['kb-triple-whammy'],
      });
    }
  }

  /* --- 高钾组合 --- */
  if (hasAcei && has(ids, 'spironolactone') && typeof potassium === 'number') {
    if (potassium >= 5.5) {
      findings.push({
        id: 'f-hyperkalemia-high',
        level: 'high',
        title: `血钾 ${potassium} mmol/L 合并 ACEI/ARB + 螺内酯`,
        detail: '双重阻断醛固酮系统可致严重高钾，伴心电图改变时危及生命。',
        action: '当日复查血钾与心电图；暂停螺内酯，停用含钾盐替代品，由医生决定 ACEI/ARB 是否调整。',
        evidence: ['kb-hyperkalemia'],
      });
    } else if (potassium >= 5.0) {
      findings.push({
        id: 'f-hyperkalemia-moderate',
        level: 'moderate',
        title: `血钾 ${potassium} mmol/L 处于警戒区间`,
        detail: 'ACEI/ARB 与保钾利尿剂联用时血钾易缓慢上升，脱水或加用 NSAID 会加速。',
        action: '1 周内复查血钾与肌酐，避免低钠盐（多含氯化钾）。',
        evidence: ['kb-hyperkalemia'],
      });
    }
  }

  /* --- 地高辛 --- */
  if (has(ids, 'digoxin') && typeof eGFR === 'number' && eGFR < 50) {
    findings.push({
      id: 'f-digoxin-renal',
      level: 'moderate',
      title: `地高辛在 eGFR ${eGFR} 时需减量`,
      detail: '地高辛主要经肾排泄，肾功能下降易蓄积中毒（恶心、黄视、心动过缓）。',
      action: '复查地高辛血药浓度与血钾，由医生调整剂量。',
      evidence: ['kb-digoxin-toxicity'],
    });
  }

  /* --- PPI 与氯吡格雷 --- */
  if (has(ids, 'omeprazole') && has(ids, 'clopidogrel')) {
    findings.push({
      id: 'f-ppi-clopidogrel',
      level: 'moderate',
      title: '奥美拉唑可能削弱氯吡格雷疗效',
      detail: '奥美拉唑抑制 CYP2C19，减少氯吡格雷活性代谢物生成。',
      action: '需 PPI 保护时，由医生评估是否改用泮托拉唑。',
      evidence: ['kb-ppi'],
    });
  }

  /* --- 他汀相互作用 --- */
  if (has(ids, 'simvastatin') && has(ids, 'clarithromycin')) {
    findings.push({
      id: 'f-statin-clarithromycin',
      level: 'high',
      title: '辛伐他汀与克拉霉素联用',
      detail: '强 CYP3A4 抑制使辛伐他汀浓度大幅升高，肌病与横纹肌溶解风险增加。',
      action: '抗感染期间由医生决定是否暂停辛伐他汀，或改用相互作用小的他汀。',
      evidence: ['kb-statin-muscle'],
    });
  }

  /* --- 贫血 --- */
  if (typeof hemoglobin === 'number' && hemoglobin < 110) {
    findings.push({
      id: 'f-anemia',
      level: 'moderate',
      title: `血红蛋白 ${hemoglobin} g/L 提示贫血`,
      detail: '在抗凝/抗血小板/NSAID 使用者中，贫血首先应排除慢性消化道失血。',
      action: '查大便隐血与铁代谢，评估消化道出血来源。',
      evidence: ['kb-anticoag-bleeding'],
    });
  }

  /* --- 多重用药 --- */
  if (medViews.length >= 5) {
    findings.push({
      id: 'f-polypharmacy',
      level: 'info',
      title: `多重用药（${medViews.length} 种）`,
      detail: '用药种类 ≥5 种时，相互作用与依从性风险显著增加，应定期做用药重整。',
      action: '执行五步用药重整流程，输出患者版用药清单卡。',
      evidence: ['kb-med-reconciliation'],
    });
  }

  return findings;
}

const labAssessTool: ToolDefinition = {
  name: 'lab_assess',
  title: '检验指标与用药匹配度评估',
  description:
    '结合 eGFR、血钾、INR、血红蛋白、年龄与用药清单，给出结构化的风险发现（含严重程度、处置方向与证据）。',
  params: [{ name: 'patientId', type: 'string', required: false, description: '患者 id' }],
  async run(_args, ctx) {
    const findings = assessLabs(ctx);
    const high = findings.filter((f) => f.level === 'high').length;
    return {
      summary:
        findings.length === 0
          ? '未发现检验指标与用药的明显冲突'
          : `识别到 ${findings.length} 项风险发现，其中高风险 ${high} 项`,
      data: { findings, riskScore: Math.min(100, high * 25 + findings.filter((f) => f.level === 'moderate').length * 10) },
    };
  },
};

/* ==================================================================
 * 4. 知识库检索（RAG）
 * ================================================================== */
const searchKbTool: ToolDefinition = {
  name: 'search_kb',
  title: '检索循证知识库',
  description: '在本地用药安全知识库中做混合检索（BM25 + 向量 + RRF + 重排），返回带编号的证据片段。',
  params: [
    { name: 'query', type: 'string', required: true, description: '检索问题，用具体术语，如「华法林 布洛芬 出血」' },
    { name: 'topK', type: 'number', required: false, description: '返回条数，默认 6' },
    { name: 'docIds', type: 'string[]', required: false, description: '限定检索的文档 id' },
  ],
  async run(args) {
    const query = String(args.query ?? '');
    if (!query) return { summary: '检索词为空', data: { hits: [] }, hits: [] };
    const hits = await searchKb(query, {
      topK: Number(args.topK ?? 6),
      docIds: Array.isArray(args.docIds) ? (args.docIds as string[]) : undefined,
      minScore: Number(process.env.RAG_MIN_SCORE ?? 0),
    });
    return {
      summary: `命中 ${hits.length} 条证据（最高分 ${hits[0]?.score?.toFixed(2) ?? '0'}）：${hits
        .slice(0, 3)
        .map((h) => `《${h.title}》`)
        .join('、')}`,
      data: { hits },
      hits,
    };
  },
};

/* ==================================================================
 * 5. 用药重整方案生成
 * ================================================================== */
export interface MedPlan {
  keep: Array<{ name: string; reason: string }>;
  adjust: Array<{ name: string; reason: string; evidence: string[] }>;
  stop: Array<{ name: string; reason: string; evidence: string[] }>;
  followUp: Array<{ when: string; items: string[]; reason: string }>;
  education: string[];
}

function buildPlan(ctx: ToolContext, findings: ClinicalFinding[], interactionCount: number): MedPlan {
  const { patient, medViews } = ctx;
  const findingText = findings.map((f) => `${f.title}｜${f.detail}`).join(' ');
  const ids = medViews.map((m) => m.drugId);

  const stop: MedPlan['stop'] = [];
  const adjust: MedPlan['adjust'] = [];
  const keep: MedPlan['keep'] = [];

  for (const med of medViews) {
    const selfBought = /自购|自行|家人给的|邻居/.test(med.source);
    const isNsaid = ['ibuprofen', 'diclofenac'].includes(med.drugId);

    if (isNsaid && findingText.includes('NSAID')) {
      const item = {
        name: `${med.name} ${med.dose}`,
        reason: `当前风险组合中的关键推手${selfBought ? '（且为自行加服，无医嘱）' : ''}：与抗凝/肾功能不全叠加时出血与急性肾损伤风险最高。`,
        evidence: ['kb-nsaid-anticoag', 'kb-nsaid-renal'],
      };
      // 只有明确属于自行加服的药，系统才给“停止自行服用”的即时动作；处方药一律交给医生决定。
      if (selfBought) stop.push(item);
      else adjust.push({ ...item, reason: `${item.reason} 请立即联系医生评估是否需要暂停或更换。` });
    } else if (med.drugId === 'glibenclamide' && patient.age >= 65) {
      adjust.push({
        name: `${med.name} ${med.dose}`,
        reason: '老年人使用长效磺脲类低血糖风险高，属 Beers 清单建议避免用药；由医生制定换药或逐步停药方案。',
        evidence: ['kb-beers-elderly'],
      });
    } else if (med.drugId === 'diazepam' && ids.includes('estazolam')) {
      adjust.push({
        name: `${med.name} ${med.dose}`,
        reason: '与艾司唑仑同类叠加，镇静与跌倒风险成倍增加；需由医生制定逐步减停方案，不能自行骤停。',
        evidence: ['kb-beers-elderly', 'kb-falls'],
      });
    } else if (med.drugId === 'metformin' && (patient.labs.eGFR ?? 99) < 45) {
      adjust.push({
        name: `${med.name} ${med.dose}`,
        reason: `eGFR ${patient.labs.eGFR}，需由医生评估减量（通常不超过 1 g/d）并在 4 周内复查肾功能；脱水、造影前后是否暂停也由医生确认。`,
        evidence: ['kb-diabetes-basics'],
      });
    } else if (med.drugId === 'warfarin') {
      adjust.push({
        name: `${med.name} ${med.dose}`,
        reason: `INR ${patient.labs.INR ?? '未查'}，需在 3–7 天内复查并按结果由医生调整剂量；期间记录出血征象。`,
        evidence: ['kb-anticoag-bleeding'],
      });
    } else if (med.drugId === 'spironolactone' && (patient.labs.potassium ?? 0) >= 5.5) {
      adjust.push({
        name: `${med.name} ${med.dose}`,
        reason: `血钾 ${patient.labs.potassium}，当日复查血钾与心电图，由医生决定是否暂停。`,
        evidence: ['kb-hyperkalemia'],
      });
    } else if (med.drugId === 'aspirin' && ids.includes('warfarin')) {
      adjust.push({
        name: `${med.name} ${med.dose}`,
        reason: '抗凝 + 抗血小板属出血高危组合；立即就医核对联用指征，由接诊医生决定是否暂缓或停用。',
        evidence: ['kb-antiplatelet', 'kb-anticoag-bleeding'],
      });
    } else if (selfBought) {
      adjust.push({
        name: `${med.name} ${med.dose}`,
        reason: `来源为「${med.source}」，未纳入医嘱管理，建议下次随访时由医生确认是否继续。`,
        evidence: ['kb-med-reconciliation'],
      });
    } else {
      keep.push({ name: `${med.name} ${med.dose} ${med.freq}`, reason: '有明确适应证，继续按医嘱服用并定期监测。' });
    }
  }

  const followUp: MedPlan['followUp'] = [];
  if (ids.includes('warfarin')) {
    followUp.push({
      when: '3–7 天内',
      items: ['INR', '大便隐血', '血红蛋白'],
      reason: '抗凝强度异常 + 潜在失血，需最短间隔复评。',
    });
  }
  if ((patient.labs.potassium ?? 0) >= 5.0) {
    followUp.push({
      when: '1 周内',
      items: ['血钾', '肌酐', '心电图'],
      reason: '高钾风险组合需快速闭环。',
    });
  }
  if ((patient.labs.eGFR ?? 99) < 60) {
    followUp.push({
      when: '2 周内',
      items: ['eGFR / 肌酐', '尿量记录'],
      reason: '肾功能下降影响多种药物清除。',
    });
  }
  followUp.push({
    when: '7 天内',
    items: ['电话随访依从性', '家属确认药盒已分装'],
    reason: `依从性评分 ${patient.adherence.score}/100，需家属参与。`,
  });

  const education = [
    '止痛药不要自己买：布洛芬、双氯芬酸这类药会让出血和肾损伤风险翻倍，疼得厉害先找村医。',
    '起床「三个 30 秒」：醒后躺 30 秒、坐起 30 秒、双腿下垂 30 秒再站，防跌倒。',
    '把全部药盒（包括子女买的、邻居给的）装进一个袋子，每次随访带给医生核对。',
    `竹盐、低钠盐、香蕉这类「补身体」的东西要当心，含钾高时会和心衰/降压药叠加。`,
  ];
  if (patient.age >= 75) {
    education.push('夜间留一盏小夜灯，床边放便器；起夜时先坐床边数 30 秒。');
  }

  return { keep, adjust, stop, followUp, education };
}

const buildMedPlanTool: ToolDefinition = {
  name: 'build_med_plan',
  title: '生成用药重整与随访计划',
  description: '把风险发现转化为可执行的「保留 / 调整 / 停用 / 复查 / 教育」五段式方案。',
  params: [
    { name: 'focus', type: 'string', required: false, description: '本次关注点，如「出血风险」' },
  ],
  async run(_args, ctx) {
    const findings = assessLabs(ctx);
    const interactions = await checkInteractions(ctx.medViews.map((m) => m.drugId));
    const plan = buildPlan(ctx, findings, interactions.length);
    return {
      summary: `方案已生成：建议停用 ${plan.stop.length} 项、调整 ${plan.adjust.length} 项、保留 ${plan.keep.length} 项、${plan.followUp.length} 个复查节点`,
      data: { plan, findings },
    };
  },
};

/* ==================================================================
 * 6. 转诊单生成
 * ================================================================== */
const makeReferralTool: ToolDefinition = {
  name: 'make_referral',
  title: '生成转诊建议单',
  description: '当出现危险信号或需上级医院决策时，生成结构化转诊单（去向、紧急度、携带资料、交接要点）。',
  params: [
    { name: 'reason', type: 'string', required: true, description: '转诊原因' },
    { name: 'urgency', type: 'string', required: false, description: 'emergency | urgent | routine' },
    { name: 'department', type: 'string', required: false, description: '目标科室' },
  ],
  async run(args, ctx) {
    const findings = assessLabs(ctx);
    const urgency = String(args.urgency ?? 'urgent');
    const department =
      String(args.department ?? '') ||
      (findings.some((f) => f.id.includes('inr')) || findings.some((f) => f.id.includes('nsaid'))
        ? '急诊 / 消化内科'
        : '全科医学科');

    return {
      summary: `已生成${urgency === 'emergency' ? '紧急' : '限期'}转诊单：${department}`,
      data: {
        patient: { name: ctx.patient.name, age: ctx.patient.age, id: ctx.patient.id },
        reason: String(args.reason ?? '用药相关风险需上级医院评估'),
        urgency,
        department,
        carry: ['全部药盒与用药清单', '最近一次检验报告（INR / 肾功能 / 血常规）', '医保卡与既往病历'],
        handover: [
          '当前抗凝强度与出血征象出现时间',
          '近 2 周新增或自行加服的药物（含中成药、止痛药）',
          '是否已出现黑便、呕血、意识改变',
        ],
        evidence: findings.filter((f) => f.level === 'high').flatMap((f) => f.evidence),
      },
    };
  },
};

/* ==================================================================
 * 7. 家属通知
 * ================================================================== */
const notifyFamilyTool: ToolDefinition = {
  name: 'notify_family',
  title: '生成家属通知',
  description: '把专业结论转写成家属能看懂、能执行的口语化通知，可直接复制到微信。',
  params: [{ name: 'message', type: 'string', required: false, description: '需要强调的核心事项' }],
  async run(args, ctx) {
    const { patient, medViews } = ctx;
    const findings = assessLabs(ctx);
    const top = findings.find((f) => f.level === 'high');
    const text = `【守药人提醒】${patient.name}（${patient.age} 岁）今天的用药核对结果：${
      top ? `${top.title}。${top.action}` : '暂未发现新的高风险组合，请按原方案服用。'
    } 重点：${String(args.message ?? '请协助分装每日药盒，并确认止痛药不要自行购买')}。下次复查：${
      findings.some((f) => f.id.includes('inr')) ? '3–7 天内查 INR' : '按随访卡时间'
    }。有黑便、呕血、意识不清请立刻拨打 120。`;
    return {
      summary: '家属通知已生成（可直接粘贴至微信/短信）',
      data: { text, to: `${patient.family.name}（${patient.family.relation}）`, medCount: medViews.length },
    };
  },
};

/* ==================================================================
 * 8. 语音播报（适老化）
 * ================================================================== */
const speakTool: ToolDefinition = {
  name: 'speak',
  title: '语音播报',
  description: '把结论转成适合老年人收听的短句，前端用 Web Speech API 播报（可调速、大字同步）。',
  params: [{ name: 'text', type: 'string', required: true, description: '需要播报的文本' }],
  async run(args) {
    const raw = String(args.text ?? '');
    // 播报前做「口语化 + 去符号」处理，避免朗读出一堆 Markdown 符号
    const spoken = raw
      .replace(/[#>*_`\-]/g, '')
      .replace(/\[(\d+)\]/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 300);
    return { summary: '已准备语音播报文本（≤300 字）', data: { text: spoken } };
  },
};

/* ==================================================================
 * 注册表
 * ================================================================== */
export const TOOLS: Record<string, ToolDefinition> = {
  get_patient: getPatientTool,
  check_interaction: checkInteractionTool,
  lab_assess: labAssessTool,
  search_kb: searchKbTool,
  build_med_plan: buildMedPlanTool,
  make_referral: makeReferralTool,
  notify_family: notifyFamilyTool,
  speak: speakTool,
};

export const TOOL_NAMES = Object.keys(TOOLS);

/** 转成 Prompt 里的工具说明（规划阶段使用） */
export function toolSpecsForPrompt(): string {
  return Object.values(TOOLS)
    .map(
      (t) =>
        `- ${t.name}（${t.title}）：${t.description}\n  参数：${t.params
          .map((p) => `${p.name}${p.required ? '*' : ''}:${p.type}`)
          .join('，')}`,
    )
    .join('\n');
}

/** 供 MCP / 前端展示的工具清单 */
export function toolCatalog() {
  return Object.values(TOOLS).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    params: t.params,
  }));
}

/** 供测试与其他模块复用的评估结果 */
export function assessFindings(ctx: ToolContext): ClinicalFinding[] {
  return assessLabs(ctx);
}

export { findDrug };
