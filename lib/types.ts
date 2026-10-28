/**
 * 全局共享类型定义
 * ------------------------------------------------------------------
 * 前端、服务端、Agent 运行时与 MCP 工具层共用同一套类型，
 * 保证「流式事件 → UI 渲染 → 审计落盘」全链路类型安全。
 */

/** 药物基础信息（来自 data/drugs.json） */
export interface Drug {
  id: string;
  name: string;
  aliases: string[];
  class: string;
  indications: string[];
  usualDose: string;
  therapeuticWindow?: string;
  elderlyCaution: string;
  renalNote: string;
  monitoring: string[];
  riskTags: string[];
}

/** 相互作用严重程度 */
export type Severity = 'high' | 'moderate' | 'low';

/** 药物相互作用规则（来自 data/interactions.json） */
export interface InteractionRule {
  id: string;
  a: string;
  b: string;
  severity: Severity;
  mechanism: string;
  action: string;
  /** 关联知识库文档 id，用于追溯证据 */
  evidence: string[];
}

/** 患者档案中的一条用药记录 */
export interface PatientMed {
  drugId: string;
  dose: string;
  freq: string;
  /** 处方来源：区分「医嘱」与「自行加服」，这是真实场景中最关键的差异 */
  source: string;
  since: string;
}

/** 患者档案 */
export interface Patient {
  id: string;
  name: string;
  age: number;
  sex: '男' | '女';
  region: string;
  conditions: string[];
  labs: {
    eGFR?: number;
    creatinine?: number;
    INR?: number;
    potassium?: number;
    HbA1c?: number;
    BP?: string;
    hemoglobin?: number;
  };
  meds: PatientMed[];
  adherence: { score: number; note: string };
  chiefComplaint: string;
  family: { name: string; relation: string; phone: string; available: string };
  lastVisit: string;
  riskNotes: string[];
}

/** 红旗症状规则（来自 data/redflags.json） */
export interface RedFlagRule {
  id: string;
  level: 'emergency' | 'urgent';
  keywords: string[];
  title: string;
  action: string;
  escalateTo: string;
}

/** 知识库分块 */
export interface KbChunk {
  /** 形如 kb-beers-elderly#2，可直接作为引用编号来源 */
  id: string;
  docId: string;
  title: string;
  section: string;
  tags: string[];
  text: string;
  /** 词频表，用于 BM25 */
  tf: Record<string, number>;
  len: number;
  /** 本地哈希向量，用于语义召回 */
  vector: Float32Array;
}

/** 检索命中结果（含可解释的打分明细） */
export interface KbHit {
  chunkId: string;
  docId: string;
  title: string;
  section: string;
  tags: string[];
  text: string;
  /** 融合后的最终得分 0~1 */
  score: number;
  /** 打分明细，前端「证据面板」会展开显示，体现可解释性 */
  scoreBreakdown: {
    bm25: number;
    vector: number;
    rrf: number;
    rerank: number;
  };
}

/** 检索请求参数 */
export interface SearchOptions {
  topK?: number;
  /** 限定检索的文档 id，用于「命中规则后精确取证据」 */
  docIds?: string[];
  minScore?: number;
}

/** 患者用药的「已补全视图」（药物信息 + 患者用法），供 UI 与 Agent 共用 */
export interface PatientMedView {
  drugId: string;
  name: string;
  dose: string;
  freq: string;
  source: string;
  className: string;
  riskTags: string[];
  renalNote: string;
  elderlyCaution: string;
  monitoring: string[];
}

/** 一次交互所需的患者数据包（服务端一次性组装，客户端只做渲染） */
export interface PatientBundle {
  patient: Patient;
  meds: PatientMedView[];
  interactions: Array<{
    a: string;
    b: string;
    aName: string;
    bName: string;
    severity: Severity;
    mechanism: string;
    action: string;
    evidence: string[];
  }>;
}

/** 安全等级 */
export type SafetyLevel = 'ok' | 'notice' | 'block';

/** 单条安全标记 */
export interface SafetyFlag {
  id: string;
  category: 'redflag' | 'pii' | 'output_guard' | 'scope' | 'citation';
  level: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
  /** Agent 已自动采取的兜底动作 */
  action?: string;
}

/** 安全审查结果 */
export interface SafetyReport {
  level: SafetyLevel;
  flags: SafetyFlag[];
  /** 是否强制插入转诊卡片 */
  forceReferral: boolean;
  /** 是否必须给出免责声明 */
  requireDisclaimer: boolean;
  /** 脱敏后的文本 */
  sanitizedText: string;
}

/** Agent 计划中的一步 */
export interface PlanStep {
  id: string;
  title: string;
  /** 该步骤由哪个工具完成（可空，表示纯推理） */
  tool?: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'error';
  detail?: string;
}

/** 工具调用记录（用于轨迹回放与审计） */
export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'ok' | 'error';
  ms: number;
  summary: string;
  /** 工具返回的结构化数据（前端可二次渲染） */
  data?: unknown;
}

/** 一次 Agent 运行的完整轨迹 */
export interface AgentRun {
  id: string;
  patientId: string;
  question: string;
  mode: 'mock' | 'llm';
  model: string;
  startedAt: string;
  durationMs: number;
  steps: PlanStep[];
  toolCalls: ToolCallRecord[];
  retrievals: Array<{ query: string; hits: KbHit[] }>;
  citations: string[];
  safety: SafetyReport;
  answer: string;
  confidence: number;
  tokenUsage?: { prompt: number; completion: number };
}

/* ------------------------------------------------------------------
 * SSE 流式事件协议
 * 每一种事件都是「可独立渲染」的最小单元，前端按 type 分发。
 * ------------------------------------------------------------------ */
export type SseEvent =
  | { type: 'run_start'; runId: string; patientId: string; mode: string; model: string }
  | { type: 'plan'; steps: PlanStep[] }
  | { type: 'step'; stepId: string; status: PlanStep['status']; detail?: string }
  | { type: 'retrieval'; query: string; hits: KbHit[] }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | {
      type: 'tool_result';
      id: string;
      name: string;
      status: 'ok' | 'error';
      ms: number;
      summary: string;
      data?: unknown;
    }
  | { type: 'token'; text: string }
  | { type: 'safety'; level: SafetyLevel; flags: SafetyFlag[]; forceReferral: boolean }
  | { type: 'answer_meta'; citations: string[]; confidence: number; disclaimer: string }
  | { type: 'note'; text: string; level?: 'info' | 'warn' }
  | { type: 'done'; runId: string; durationMs: number; tokenUsage?: { prompt: number; completion: number } }
  | { type: 'error'; message: string };

/** 对话消息（前端状态） */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** assistant 消息的附属信息 */
  citations?: string[];
  safety?: SafetyReport;
  confidence?: number;
  streaming?: boolean;
  runId?: string;
}
