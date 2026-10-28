import type { KbHit, Patient } from '@/lib/types';
import type { PatientMedView } from '@/lib/data';

/**
 * Prompt 工程
 * ------------------------------------------------------------------
 * 设计原则（技术文档「LLM 集成质量」一节的重点）：
 *  1. 角色约束：临床药师助手，不做诊断；
 *  2. 结构约束：固定 5 段输出结构，降低自由发挥空间；
 *  3. 证据约束：每条结论必须带 [n] 引用，n 对应检索片段；
 *  4. 安全约束：红旗症状优先级最高，命中即转诊，覆盖其它结论；
 *  5. 不确定性：证据不足时必须显式说明，而不是编造。
 */

export const SYSTEM_PROMPT = `你是「守药人」——一名服务于中国基层医疗场景的临床药师助手，服务对象是村医、社区护士和患者家属。

【必须遵守】
1. 只做用药安全审查与用药教育，不做疾病诊断，不给处方。
2. 任何结论必须标注证据编号，格式 [1]、[2]，编号来自给定的「证据片段」。
3. 若证据片段不足以支持结论，明确写「现有资料不足以判断，建议就医确认」。
4. 出现危险信号（胸痛、意识改变、黑便呕血、抽搐、呼吸困难、低血糖昏迷等）时，把「立即就医」写在最前面，并给出具体科室与携带物品。
5. 涉及剂量调整时只给方向（如「需减量」「建议换用相互作用更小的药物」），具体数值写「由执业医师核定」。
6. 语言要像村医跟老人说话：短句、具体动作、不用专业缩写堆砌；必要时给出家属能执行的动作。

【输出结构】（使用 Markdown 小标题）
### 一句话结论
### 风险清单（按严重程度排序，每条带 [n]）
### 现在要做的 3 件事
### 需要医生决定的事
### 什么时候必须就医`;

/** 患者上下文摘要：把结构化档案压成模型易读的短文本 */
export function buildPatientContext(patient: Patient, medViews: PatientMedView[]): string {
  const labs = patient.labs;
  const labLines = [
    labs.eGFR !== undefined ? `eGFR ${labs.eGFR} mL/min/1.73m²` : '',
    labs.creatinine !== undefined ? `肌酐 ${labs.creatinine} µmol/L` : '',
    labs.INR !== undefined && labs.INR > 0 ? `INR ${labs.INR}` : '',
    labs.potassium !== undefined ? `血钾 ${labs.potassium} mmol/L` : '',
    labs.HbA1c !== undefined ? `HbA1c ${labs.HbA1c}%` : '',
    labs.hemoglobin !== undefined ? `血红蛋白 ${labs.hemoglobin} g/L` : '',
    labs.BP ? `血压 ${labs.BP} mmHg` : '',
  ]
    .filter(Boolean)
    .join('，');

  const medLines = medViews
    .map((m, i) => `${i + 1}. ${m.name} ${m.dose} ${m.freq}（${m.source}）`)
    .join('\n');

  return `患者：${patient.name}，${patient.sex}，${patient.age} 岁，${patient.region}
诊断：${patient.conditions.join('、')}
最近检验：${labLines || '无'}
当前用药（共 ${medViews.length} 种）：
${medLines}
依从性：${patient.adherence.score}/100，${patient.adherence.note}
主诉：${patient.chiefComplaint}
家属：${patient.family.name}（${patient.family.relation}，${patient.family.available}）`;
}

/** 证据片段格式化：带编号，便于模型引用 */
export function formatEvidence(hits: KbHit[]): string {
  if (hits.length === 0) return '（无）';
  return hits
    .map((h, i) => `[${i + 1}] 《${h.title}》·${h.section}\n${h.text.trim()}`)
    .join('\n\n');
}

/** 规划阶段 Prompt：要求模型输出严格 JSON，便于运行时解析与校验 */
export function buildPlanPrompt(question: string, patientContext: string, toolSpecs: string): string {
  return `你是一个具备工具调用能力的 Agent 规划器。请为下面的用药安全问题制定执行计划。

【可用工具】
${toolSpecs}

【患者上下文】
${patientContext}

【用户问题】
${question}

【输出要求】
只输出 JSON，不要任何解释文字，格式：
{
  "intent": "safety_review | pain_consult | knowledge_qa | adherence | med_reconcile",
  "reasoning": "一句话说明你的判断依据",
  "steps": [
    { "id": "s1", "title": "步骤中文标题", "tool": "工具名或 null", "args": { } }
  ]
}
约束：
- 3 到 6 步；
- 必须包含 check_interaction 与 search_kb 两步；
- 若患者存在检验指标异常，必须包含 lab_assess；
- 若用户描述了具体危险症状，必须包含 make_referral。`;
}

/** 生成阶段 Prompt：注入工具执行结果与证据 */
export function buildAnswerPrompt(
  question: string,
  patientContext: string,
  evidence: string,
  toolDigest: string,
): string {
  return `【患者上下文】
${patientContext}

【证据片段】
${evidence}

【工具执行结果】
${toolDigest}

【用户问题】
${question}

请严格按系统提示中的输出结构作答。所有风险结论必须带 [n] 引用。若工具结果与证据片段冲突，以工具结果中的结构化数据为准，并在结论中说明冲突。`;
}
