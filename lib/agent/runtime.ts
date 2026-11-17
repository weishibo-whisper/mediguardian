import type {
  AgentRun,
  ConversationTurn,
  KbHit,
  Patient,
  PlanStep,
  SafetyLevel,
  SafetyReport,
  SseEvent,
  ToolCallRecord,
} from '@/lib/types';
import { getDrugs, getPatient, getPatientMedViews, type PatientMedView } from '@/lib/data';
import { searchKb, verifyCitations } from '@/lib/rag';
import {
  TOOLS,
  TOOL_NAMES,
  assessFindings,
  toolSpecsForPrompt,
  type ClinicalFinding,
  type MedPlan,
  type ToolContext,
} from '@/lib/tools';
import { appendAudit, enforceReferralPriority, guardOutput, maskPii, screenInput, SAFETY_DISCLAIMER } from '@/lib/safety';
import {
  SYSTEM_PROMPT,
  buildAnswerPrompt,
  buildPatientContext,
  buildPlanPrompt,
  formatEvidence,
} from '@/lib/llm/prompts';
import { chatComplete, chatStream, getLlmConfig } from '@/lib/llm/provider';
import { shortId } from '@/lib/utils';
import { saveRun } from './store';
import { verifyAnswerGrounding } from './verification';

/**
 * Agent 运行时（核心）
 * ------------------------------------------------------------------
 * 执行环路：安全审查 → 规划 → 逐步执行工具 → 证据锚定 → 生成 → 输出守门 → 落盘
 *
 * 双引擎设计（作品的关键工程决策）：
 *  - LLM 引擎：真实大模型可用时，由模型自主规划 + 生成，体现 Agent 的自主决策；
 *  - 规则引擎：无 Key / 断网 / 模型超时的兜底路径，用确定性逻辑跑完整条流水线，
 *    保证「演示永不翻车」，同时作为 LLM 输出的对照基线（可做 A/B 可信度对比）。
 *
 * 两者共用同一套工具、检索与安全管线，因此切换引擎不会改变产品行为契约。
 */

export type EngineMode = 'mock' | 'llm';

export interface RunParams {
  patientId: string;
  question: string;
  history?: ConversationTurn[];
  /** auto：有 key 用 LLM，无 key 自动降级 */
  mode?: EngineMode | 'auto';
  emit: (event: SseEvent) => void;
}

/**
 * 对“那我先做什么”“这个要紧吗”一类追问补回上一轮用户主题。
 * 只在明显的指代/承接句上启用，避免把两个独立问题强行拼在一起。
 */
export function resolveFollowUpQuestion(question: string, history: ConversationTurn[] = []): string {
  const normalized = question.trim();
  const followUp = /^(?:那(?:我|现在|接下来|该|要|能|先|还|怎么办|怎么做|要不要|多久|呢|，|,)|那么(?:我|现在|接下来|该|要|能|先|还|怎么办|怎么做|要不要|呢|，|,)|然后|还有|所以|刚才|上面|之前|(?:这个|这种|这些|上述|它(?:们)?)(?:要|该|是|会|能|有|怎|多|哪|先|还|为|对|可|应|需|严|危|好|不|呢|，|,|$))/.test(normalized)
    || /^(?:怎么办|怎么做|要不要|多久|先做什么|哪一个|为什么|严重吗|要紧吗|能吃吗|可以吗)[？?]?$/.test(normalized);
  if (!followUp) return question;
  const previous = [...history].reverse().find((turn) => turn.role === 'user' && turn.content.trim());
  if (!previous) return question;
  const previousText = maskPii(previous.content).text.trim().slice(0, 500);
  return previousText ? `${previousText}\n追问：${question}` : question;
}

const MAX_STEPS = Number(process.env.AGENT_MAX_STEPS ?? 6);
const STREAM_DELAY_MS = Number(process.env.MOCK_STREAM_DELAY_MS ?? 6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ==================================================================
 * 规划器
 * ================================================================== */

/** 规则引擎规划器：意图识别 + 固定安全流水线（每一步都可被审计） */
function mockPlan(question: string, ctx: ToolContext, forceReferral: boolean): PlanStep[] {
  const drugCount = ctx.medViews.length;
  const q = question;

  // 轻量意图识别（用于给步骤补充可读细节，也作为 LLM 规划失败时的兜底）
  const intent = /疼|痛/.test(q)
    ? 'pain_consult'
    : /出血|黑便|淤青|牙龈/.test(q)
      ? 'safety_review'
      : /怎么吃|饭前|饭后|忘了|依从/.test(q)
        ? 'adherence'
        : 'safety_review';

  const steps: PlanStep[] = [
    {
      id: 's1',
      title: '载入患者档案与用药清单',
      tool: 'get_patient',
      status: 'pending',
      detail: `${ctx.patient.name} · ${drugCount} 种在用药`,
    },
    {
      id: 's2',
      title: '两两核查药物相互作用',
      tool: 'check_interaction',
      status: 'pending',
      detail: `意图：${intent} · 覆盖 ${drugCount} 种药物的全部两两组合`,
    },
    {
      id: 's3',
      title: '按检验指标做风险分层',
      tool: 'lab_assess',
      status: 'pending',
      detail: 'eGFR / 血钾 / INR / 血红蛋白 / 年龄 五个维度',
    },
    {
      id: 's4',
      title: '检索循证依据并锚定证据',
      tool: 'search_kb',
      status: 'pending',
      detail: 'BM25 + 向量 → RRF 融合 → 规则重排',
    },
    {
      id: 's5',
      title: '生成用药重整与随访方案',
      tool: 'build_med_plan',
      status: 'pending',
      detail: '保留 / 调整 / 停用 / 复查 / 教育 五段式',
    },
  ];

  steps.push(
    forceReferral
      ? { id: 's6', title: '生成转诊建议单', tool: 'make_referral', status: 'pending', detail: '命中危险信号，优先转诊' }
      : { id: 's6', title: '生成家属协同通知', tool: 'notify_family', status: 'pending', detail: '家属参与分药与观察' },
  );

  steps.push({ id: 's7', title: '安全审查与输出守门', status: 'pending', detail: '诊断断言 / 剂量引用 / 绝对化表述' });
  return steps;
}

/** 把 LLM 返回的 JSON 计划规整为内部结构（防御式解析） */
function normalizeLlmPlan(raw: string, fallback: PlanStep[]): { steps: PlanStep[]; reasoning: string } {
  try {
    const jsonText = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const parsed = JSON.parse(jsonText) as {
      reasoning?: string;
      steps?: Array<{ id?: string; title?: string; tool?: string | null; args?: Record<string, unknown> }>;
    };
    const steps: PlanStep[] = (parsed.steps ?? [])
      .filter((s) => s && typeof s.title === 'string')
      .slice(0, MAX_STEPS + 1)
      .map((s, i) => ({
        id: s.id || `s${i + 1}`,
        title: s.title as string,
        tool: s.tool && TOOL_NAMES.includes(s.tool) ? s.tool : undefined,
        status: 'pending' as const,
        detail: s.args && Object.keys(s.args).length > 0 ? `参数：${JSON.stringify(s.args).slice(0, 80)}` : undefined,
      }));
    if (steps.length < 2) return { steps: fallback, reasoning: '计划步数不足，回退到标准流水线' };
    // 强制补上安全审查步，避免模型"忘记"守门环节
    if (!steps.some((s) => s.title.includes('安全'))) {
      steps.push({ id: `s${steps.length + 1}`, title: '安全审查与输出守门', status: 'pending' });
    }
    return { steps, reasoning: parsed.reasoning ?? '' };
  } catch {
    return { steps: fallback, reasoning: '计划解析失败，回退到标准流水线' };
  }
}

/* ==================================================================
 * 执行器
 * ================================================================== */

interface ExecState {
  evidence: KbHit[];
  results: Record<string, ToolCallRecord>;
  toolCalls: ToolCallRecord[];
  retrievals: Array<{ query: string; hits: KbHit[] }>;
}

function pushHits(state: ExecState, hits: KbHit[]) {
  const known = new Set(state.evidence.map((h) => h.chunkId));
  for (const hit of hits) if (!known.has(hit.chunkId)) state.evidence.push(hit);
}

/** 执行单个步骤：调用工具 → 流式广播 → 记录审计 */
async function execStep(
  step: PlanStep,
  ctx: ToolContext,
  state: ExecState,
  emit: (e: SseEvent) => void,
  overrideArgs?: Record<string, unknown>,
): Promise<void> {
  if (!step.tool) {
    emit({ type: 'step', stepId: step.id, status: 'running' });
    await sleep(40);
    emit({ type: 'step', stepId: step.id, status: 'done', detail: step.detail });
    return;
  }

  const tool = TOOLS[step.tool];
  if (!tool) {
    emit({ type: 'step', stepId: step.id, status: 'skipped', detail: `未知工具 ${step.tool}` });
    return;
  }

  const args: Record<string, unknown> =
    overrideArgs ??
    (step.tool === 'search_kb'
      ? { query: `${ctx.patient.chiefComplaint} ${ctx.question ?? ''}` }
      : {});

  emit({ type: 'step', stepId: step.id, status: 'running', detail: tool.title });
  emit({ type: 'tool_call', id: `${step.id}-${tool.name}`, name: tool.name, args });

  const started = Date.now();
  try {
    const output = await tool.run(args, ctx);
    const ms = Date.now() - started;

    if (output.hits && output.hits.length > 0) {
      pushHits(state, output.hits);
      state.retrievals.push({ query: String(args.query ?? tool.title), hits: output.hits });
      emit({ type: 'retrieval', query: String(args.query ?? tool.title), hits: output.hits });
    }

    const record: ToolCallRecord = {
      id: `${step.id}-${tool.name}`,
      name: tool.name,
      args,
      status: 'ok',
      ms,
      summary: output.summary,
      data: output.data,
    };
    state.toolCalls.push(record);
    state.results[tool.name] = record;

    emit({
      type: 'tool_result',
      id: record.id,
      name: tool.name,
      status: 'ok',
      ms,
      summary: output.summary,
      data: output.data,
    });
    emit({ type: 'step', stepId: step.id, status: 'done', detail: output.summary });
  } catch (error) {
    const ms = Date.now() - started;
    const message = error instanceof Error ? error.message : '工具执行失败';
    state.toolCalls.push({
      id: `${step.id}-${tool.name}`,
      name: tool.name,
      args,
      status: 'error',
      ms,
      summary: message,
    });
    emit({ type: 'tool_result', id: `${step.id}-${tool.name}`, name: tool.name, status: 'error', ms, summary: message });
    emit({ type: 'step', stepId: step.id, status: 'error', detail: message });
  }
}

/* ==================================================================
 * 回答合成（规则引擎）
 * ================================================================== */

interface ComposeInput {
  question: string;
  patient: Patient;
  medViews: PatientMedView[];
  findings: ClinicalFinding[];
  interactions: Array<{ pair: string; severity: 'high' | 'moderate' | 'low'; mechanism: string; action: string; evidence: string[] }>;
  plan?: MedPlan;
  evidence: KbHit[];
  safety: SafetyReport;
  referral?: { department: string; urgency: string; reason: string; carry?: string[] };
}

/** 把证据文档 id 映射为引用编号，如 [2][5] */
function cites(evidence: KbHit[]) {
  return (docIds: string[] | undefined): string => {
    if (!docIds || docIds.length === 0) return '';
    const idx = docIds
      .map((docId) => evidence.findIndex((h) => h.docId === docId) + 1)
      .filter((i) => i > 0);
    return Array.from(new Set(idx))
      .sort((a, b) => a - b)
      .map((i) => `[${i}]`)
      .join('');
  };
}

const LEVEL_LABEL: Record<ClinicalFinding['level'], string> = {
  high: '高风险',
  moderate: '中风险',
  info: '提示',
};

/** 规则引擎的答案合成：结构化、可引用、口语化 */
function composeMockAnswer(input: ComposeInput): string {
  const { patient, medViews, findings, interactions, plan, evidence, safety, referral } = input;
  const c = cites(evidence);

  /**
   * 排序策略：先按严重程度，再按「临床紧迫性」。
   * 同样是「高风险」，INR 失衡 / 活动性出血的组合必须排在剂型优化之前——
   * 这是临床阅读习惯，也决定读者第一眼看到什么。
   */
  const sortOrder: Record<ClinicalFinding['level'], number> = { high: 0, moderate: 1, info: 2 };
  const urgency = (f: ClinicalFinding): number => {
    const text = `${f.id} ${f.title}`;
    if (/inr|出血|抗凝|高钾|hyperkalemia|nsaid-anticoag|triple/.test(text)) return 3;
    if (/低血糖|跌倒|beers|bzd|anticholinergic|glibenclamide/.test(text)) return 2;
    if (/renal|nsaid|metformin|anemia/.test(text)) return 1;
    return 0;
  };
  const sorted = [...findings].sort(
    (a, b) => sortOrder[a.level] - sortOrder[b.level] || urgency(b) - urgency(a),
  );
  const high = sorted.filter((f) => f.level === 'high');
  const lines: string[] = [];

  /** 去掉动作描述里重复的「建议」前缀，避免出现「建议：建议…」 */
  const stripSuggest = (text: string) => text.replace(/^建议[：:]?/, '');

  /* --- 一句话结论 --- */
  lines.push('### 一句话结论');
  if (safety.forceReferral) {
    const flag = safety.flags.find((f) => f.category === 'redflag' && f.level === 'critical');
    lines.push(
      `**先别在家观察。** 您描述的情况（${flag?.title ?? '危险信号'}）需要立即就医；用药核对结果同时显示 ${
        high.length
      } 项高风险问题，但当前第一优先级是排除急症。`,
    );
  } else if (high.length > 0) {
    lines.push(
      `${patient.name}（${patient.age} 岁，${medViews.length} 种在用药）本次核对发现 **${high.length} 项高风险问题**，最紧急的是「${high[0].title}」。`,
    );
  } else {
    lines.push(
      `当前 ${medViews.length} 种用药的方案与检验指标基本匹配，未发现需要立即处理的高风险组合；重点是保持规律服用并按期复查。`,
    );
  }

  /* --- 风险清单 --- */
  lines.push('', '### 风险清单（按严重程度排序）');
  if (sorted.length === 0) {
    lines.push('- 未在规则库与知识库中检索到明确风险点。');
  }
  sorted.slice(0, 6).forEach((f, i) => {
    lines.push(
      `${i + 1}. **【${LEVEL_LABEL[f.level]}】${f.title}** — ${f.detail} 处置：${stripSuggest(f.action)}${
        c(f.evidence) ? ` ${c(f.evidence)}` : ''
      }`,
    );
  });

  /**
   * 相互作用去重：如果某条相互作用的证据文档已被上面的风险发现引用，
   * 说明它的机制已经讲过了，不再重复罗列，避免「同一件事说三遍」。
   */
  const coveredDocs = new Set(sorted.filter((f) => f.level !== 'info').flatMap((f) => f.evidence));
  const extraInteractions = interactions.filter(
    (ix) => !(ix.evidence.length > 0 && ix.evidence.every((docId) => coveredDocs.has(docId))),
  );
  if (extraInteractions.length > 0) {
    lines.push('', '**还有这些药物组合需要留意**');
    extraInteractions.slice(0, 4).forEach((ix) => {
      const label = ix.severity === 'high' ? '高风险' : ix.severity === 'moderate' ? '中风险' : '低风险';
      lines.push(
        `- 【${label}】${ix.pair}：${ix.mechanism}；${stripSuggest(ix.action)}${c(ix.evidence) ? ` ${c(ix.evidence)}` : ''}`,
      );
    });
  }

  /* --- 现在就做 --- */
  const todo: string[] = [];
  if (plan?.stop.length) todo.push(`**停自购药**：${plan.stop[0].name} —— ${stripSuggest(plan.stop[0].reason)}`);
  if (plan?.adjust.length) todo.push(`**调**：${plan.adjust[0].name} —— ${stripSuggest(plan.adjust[0].reason)}`);
  if (plan?.education.length) todo.push(`**教**：${plan.education[0]}`);
  if (plan?.followUp.length) {
    const f = plan.followUp[0];
    todo.push(`**查**：${f.when}复查 ${f.items.join('、')}（${f.reason}）`);
  }
  if (todo.length === 0) todo.push('按原方案继续服用，7 天后电话随访一次依从性。');
  lines.push('', `### 现在就做（${todo.length} 步）`);
  todo.slice(0, 4).forEach((item, i) => lines.push(`${i + 1}. ${item}`));

  /* --- 需要医生决定的事 --- */
  lines.push('', '### 需要医生决定的事');
  const doctorItems: string[] = [];
  if (plan?.adjust.length) {
    plan.adjust.slice(0, 3).forEach((a) => doctorItems.push(`${a.name} 的剂量调整幅度（依据复查结果由医生核定）`));
  }
  if (plan?.stop.length) {
    plan.stop.slice(0, 3).forEach((item) => doctorItems.push(`${item.name} 后续是否继续使用（当前仅停止自行加服，长期方案由医生核定）`));
  }
  if (referral) doctorItems.push(`转往${referral.department}评估：${referral.reason}`);
  if (patient.adherence.score < 70) doctorItems.push('是否需要家属代为分装药盒、改用一日一次的长效方案以提升依从性');
  if (doctorItems.length === 0) doctorItems.push('下次随访时确认当前方案是否需要简化');
  doctorItems.slice(0, 4).forEach((d) => lines.push(`- ${d}`));

  /* --- 何时必须就医 --- */
  lines.push('', '### 什么时候必须就医');
  const redflagActions = safety.flags.filter((f) => f.category === 'redflag');
  if (redflagActions.length > 0) {
    redflagActions.forEach((f) => lines.push(`- **${f.title}**：${f.detail}`));
  } else {
    lines.push('- 出现黑便/呕血、牙龈或鼻子出血止不住、突然说话不清或一侧无力、胸痛、意识不清：立即拨打 120。');
    lines.push('- 3 天内乏力加重、心慌、尿量明显减少：当日联系村医或前往卫生院。');
  }

  /* --- 证据 --- */
  if (evidence.length > 0) {
    lines.push('', `### 证据索引（共 ${evidence.length} 条，编号与正文角标对应）`);
    evidence.slice(0, 10).forEach((h, i) => {
      lines.push(`[${i + 1}] 《${h.title}》· ${h.section}（相关度 ${(h.score * 100).toFixed(0)}%）`);
    });
  }

  lines.push('', `> ${SAFETY_DISCLAIMER}`);
  return lines.join('\n');
}

/** 只把已通过守门的回答分片发送，避免原始模型输出短暂出现在界面。 */
function chunkText(text: string, size = 18): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += size) pieces.push(text.slice(i, i + size));
  return pieces;
}

/* ==================================================================
 * 主流程
 * ================================================================== */

/**
 * 规则引擎的检索式构造：以「用户原话 + 主诉」为主体，药名只作弱提示。
 *
 * 早期版本把「问题 + 主诉 + 全部药名 + 全部诊断」拼成一个超长 query，
 * 结果 p-001 问「牙龈出血、大便发黑」时，糖尿病文档因为命中更多高频词而霸榜，
 * 真正需要的抗凝出血文档被挤到后面——**问题被上下文稀释了**。
 * 现在的策略：药名只补问题里没提到的、且最多 3 个；缺失的证据交给「证据锚定」
 * 按风险发现定向补齐，那里是精确的 docId 限定检索，不需要靠模糊匹配撞运气。
 */
function buildRetrievalQuery(
  question: string,
  chiefComplaint: string,
  drugs: Array<{ name: string; keys: string[] }>,
): string {
  const mentioned = drugs.some((d) => d.keys.some((key) => key && question.includes(key)));
  // 问题里已经点了药名（含商品名/俗名），就不要再往里塞别的药——否则检索会跑偏到无关药物的文档上。
  const extraDrugs = mentioned ? '' : drugs.slice(0, 3).map((d) => d.name).join(' ');
  return [question, chiefComplaint, extraDrugs].filter(Boolean).join(' ');
}


export async function runAgent(params: RunParams): Promise<AgentRun> {
  const { patientId, question, emit } = params;
  const config = getLlmConfig();
  const requested = params.mode ?? 'auto';
  let mode: EngineMode = requested === 'mock' ? 'mock' : requested === 'llm' ? 'llm' : config.enabled ? 'llm' : 'mock';
  if (mode === 'llm' && !config.enabled) mode = 'mock';

  const startedAt = new Date().toISOString();
  const runId = shortId('run');
  const t0 = Date.now();

  emit({ type: 'run_start', runId, patientId, mode, model: mode === 'llm' ? config.model : 'rule-engine-v1.2' });

  const patient = await getPatient(patientId);
  if (!patient) {
    emit({ type: 'error', message: `未找到患者 ${patientId}` });
    throw new Error(`PATIENT_NOT_FOUND:${patientId}`);
  }
  const medViews = await getPatientMedViews(patient);

  /* ---------- 1. 输入安全审查 ---------- */
  const currentSafety = await screenInput(question, patient);
  const resolvedQuestion = resolveFollowUpQuestion(currentSafety.sanitizedText, params.history);
  const usedConversationContext = resolvedQuestion !== currentSafety.sanitizedText;
  // 追问继承上轮主题后必须重新过安全闸门，否则“那我先做什么”会丢掉
  // 上轮“黑便、出血”等红旗等级，只保留了语义却没有保留处置优先级。
  const safety = usedConversationContext ? await screenInput(resolvedQuestion, patient) : currentSafety;
  const effectiveQuestion = safety.sanitizedText;
  if (safety.flags.length > 0) {
    emit({ type: 'safety', level: safety.level, flags: safety.flags, forceReferral: safety.forceReferral });
  }

  const ctx: ToolContext = { patient, medViews, runId };
  ctx.question = effectiveQuestion;

  /* ---------- 2. 规划 ---------- */
  const fallbackPlan = mockPlan(effectiveQuestion, ctx, safety.forceReferral);
  let steps = fallbackPlan;
  let planReasoning = '规则引擎：采用标准用药安全流水线（固定 7 步，便于审计与复现）';

  if (mode === 'llm') {
    try {
      const patientContext = buildPatientContext(patient, medViews);
      const { text } = await chatComplete(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildPlanPrompt(effectiveQuestion, patientContext, toolSpecsForPrompt()) },
        ],
        { json: true, temperature: 0.1, maxTokens: 700 },
      );
      const normalized = normalizeLlmPlan(text, fallbackPlan);
      steps = normalized.steps;
      planReasoning = `LLM 自主规划：${normalized.reasoning || '按患者风险点选择工具链'}`;
    } catch (error) {
      mode = 'mock';
      emit({
        type: 'note',
        level: 'warn',
        text: `大模型规划失败（${error instanceof Error ? error.message.slice(0, 60) : '未知错误'}），已自动降级到规则引擎，后续流程不受影响。`,
      });
    }
  }

  emit({ type: 'plan', steps });
  emit({ type: 'note', text: planReasoning });
  if (usedConversationContext) {
    emit({ type: 'note', text: '已结合上一轮用户问题消解本次追问语境；历史文本已脱敏并限制长度。' });
  }
  if (safety.forceReferral) {
    emit({ type: 'note', level: 'warn', text: '检测到危险信号：本轮回答将以「立即就医」为第一优先级，用药建议仅作参考。' });
  }

  const state: ExecState = { evidence: [], results: {}, toolCalls: [], retrievals: [] };

  // 预取药品库，用于判断「用户问题里是否已经点了药名（含商品名/俗名）」
  const drugCatalog = await getDrugs();
  const retrievalDrugs = medViews.map((m) => ({
    name: m.name,
    keys: [m.name, ...(drugCatalog.find((d) => d.id === m.drugId)?.aliases ?? [])],
  }));

  /* ---------- 3. 逐步执行 ---------- */
  for (const step of steps) {
    if (state.toolCalls.length >= MAX_STEPS + 2) break;
    const patched = { ...step };
    if (patched.tool === 'search_kb') {
      // 规则引擎检索式：用户原话 + 主诉（+ 少量未提到的药名），详见 buildRetrievalQuery
      patched.detail = `检索式：${buildRetrievalQuery(effectiveQuestion, patient.chiefComplaint, retrievalDrugs).slice(0, 40)}…`;
    }
    await execStep(patched, ctx as ToolContext & { question: string }, state, emit, patched.tool === 'search_kb'
      ? { query: buildRetrievalQuery(effectiveQuestion, patient.chiefComplaint, retrievalDrugs), topK: 8 }
      : patched.tool === 'make_referral'
        ? { reason: safety.flags.find((f) => f.category === 'redflag')?.title ?? '用药相关高风险需上级医院评估', urgency: safety.forceReferral ? 'emergency' : 'urgent' }
        : undefined);
  }

  const findings = assessFindings(ctx);
  const interactionData = (state.results['check_interaction']?.data as { interactions?: ComposeInput['interactions'] })?.interactions ?? [];
  const planData = (state.results['build_med_plan']?.data as { plan?: MedPlan })?.plan;
  const referralData = state.results['make_referral']?.data as ComposeInput['referral'] | undefined;

  /* ---------- 4. 证据锚定：为高风险发现定向取证 ---------- */
  const missingDocs = Array.from(
    new Set(findings.filter((f) => f.level !== 'info').flatMap((f) => f.evidence)),
  ).filter((docId) => !state.evidence.some((h) => h.docId === docId));

  if (missingDocs.length > 0) {
    const pinned: KbHit[] = [];
    for (const docId of missingDocs.slice(0, 6)) {
      const hit = await searchKb(`证据锚定 ${docId}`, { docIds: [docId], topK: 1 });
      if (hit.length > 0) pinned.push(hit[0]);
    }
    if (pinned.length > 0) {
      pushHits(state, pinned);
      state.retrievals.push({ query: '定向取证（证据锚定）', hits: pinned });
      emit({ type: 'retrieval', query: '定向取证（证据锚定）', hits: pinned });
    }
  }

  /* ---------- 5. 生成 ---------- */
  let answer = '';
  let tokenUsage: { prompt: number; completion: number } | undefined;

  const composed = composeMockAnswer({
    question: effectiveQuestion,
    patient,
    medViews,
    findings,
    interactions: interactionData,
    plan: planData,
    evidence: state.evidence,
    safety,
    referral: referralData,
  });

  if (mode === 'llm') {
    try {
      const patientContext = buildPatientContext(patient, medViews);
      const toolDigest = state.toolCalls
        .filter((t) => t.status === 'ok' && t.name !== 'search_kb')
        .map((t) => `- ${TOOLS[t.name]?.title ?? t.name}：${t.summary}\n${JSON.stringify(t.data).slice(0, 600)}`)
        .join('\n');
      const messages = [
        { role: 'system' as const, content: SYSTEM_PROMPT },
        {
          role: 'user' as const,
          content: buildAnswerPrompt(
            effectiveQuestion,
            patientContext,
            formatEvidence(state.evidence),
            toolDigest || '（无）',
          ),
        },
      ];
      for await (const chunk of chatStream(messages, { temperature: config.temperature })) {
        if (chunk.delta) {
          answer += chunk.delta;
        }
        if (chunk.usage) tokenUsage = chunk.usage;
      }
      if (answer.trim().length < 40) throw new Error('EMPTY_RESPONSE');
    } catch (error) {
      emit({
        type: 'note',
        level: 'warn',
        text: `大模型生成失败（${error instanceof Error ? error.message.slice(0, 60) : '未知错误'}），已用本地规则引擎生成同结构答案。`,
      });
      answer = '';
      mode = 'mock';
    }
  }

  if (!answer) {
    answer = composed;
  }

  /* ---------- 6. 输出守门 ---------- */
  answer = enforceReferralPriority(answer, safety);
  const guarded = guardOutput(answer, state.evidence, (process.env.SAFETY_MODE as 'strict' | 'balanced') ?? 'strict');
  answer = guarded.text;
  if (guarded.flags.length > 0) {
    emit({
      type: 'safety',
      level: guarded.level,
      flags: [...safety.flags, ...guarded.flags],
      forceReferral: safety.forceReferral,
    });
  }

  for (const piece of chunkText(answer)) {
    emit({ type: 'token', text: piece });
    if (STREAM_DELAY_MS > 0) await sleep(STREAM_DELAY_MS);
  }
  emit({ type: 'answer_final', text: guarded.text });

  const citationCheck = verifyCitations(answer, state.evidence);
  const requiredFindingDocs = findings
    .filter((finding) => finding.level !== 'info')
    .flatMap((finding) => finding.evidence);
  const verification = verifyAnswerGrounding(answer, state.evidence, requiredFindingDocs);

  /**
   * 安全等级取「输入闸门」与「输出闸门」中更严重的一档。
   * 只取输出侧会丢掉输入侧的性质：命中「可疑上消化道出血」的运行，
   * 输出可能只是被追加了一句提示（notice），审计里却会记成 ok——
   * 那么「强制转诊率」这类质量指标就永远是假的。
   */
  const LEVEL_RANK: Record<SafetyLevel, number> = { ok: 0, notice: 1, block: 2 };
  const finalLevel: SafetyLevel = LEVEL_RANK[guarded.level] >= LEVEL_RANK[safety.level] ? guarded.level : safety.level;

  /* ---------- 7. 置信度 ---------- */
  const avgTop = state.evidence.slice(0, 3).reduce((s, h) => s + h.score, 0) / Math.max(1, Math.min(3, state.evidence.length));
  const coverage = Math.min(1, citationCheck.validIds.length / Math.max(1, findings.filter((f) => f.level !== 'info').length));
  const confidence = Number(
    Math.max(
      0.2,
      Math.min(0.96, 0.35 + avgTop * 0.3 + coverage * 0.2 + (findings.length > 0 ? 0.08 : 0) - (citationCheck.invalidIds.length > 0 ? 0.1 : 0)),
    ).toFixed(2),
  );

  emit({
    type: 'answer_meta',
    citations: citationCheck.validIds,
    confidence,
    disclaimer: SAFETY_DISCLAIMER,
    verification,
  });

  const durationMs = Date.now() - t0;
  const run: AgentRun = {
    id: runId,
    patientId,
    question: currentSafety.sanitizedText,
    mode,
    model: mode === 'llm' ? config.model : 'rule-engine-v1.2',
    startedAt,
    durationMs,
    steps: steps.map((s) => ({ ...s, status: s.status === 'pending' ? 'done' : s.status })),
    toolCalls: state.toolCalls,
    retrievals: state.retrievals,
    citations: citationCheck.validIds,
    safety: {
      level: finalLevel,
      flags: [...safety.flags, ...guarded.flags],
      forceReferral: safety.forceReferral,
      requireDisclaimer: true,
      sanitizedText: currentSafety.sanitizedText,
    },
    answer,
    confidence,
    verification,
    tokenUsage,
  };

  await saveRun(run);
  await appendAudit({
    runId,
    at: startedAt,
    patientId,
    question: currentSafety.sanitizedText.slice(0, 120),
    mode,
    model: run.model,
    safetyLevel: run.safety.level,
    flags: run.safety.flags.map((f) => f.title),
    tools: state.toolCalls.map((t) => t.name),
    citations: citationCheck.validIds,
    durationMs,
    confidence,
  });

  emit({ type: 'done', runId, durationMs, mode, model: run.model, tokenUsage });
  return run;
}
