import fs from 'node:fs/promises';
import path from 'node:path';
import type { Drug, InteractionRule, Patient, PatientBundle, PatientMedView, RedFlagRule, Severity } from '@/lib/types';

export type { PatientMedView };

/**
 * 静态数据仓库
 * ------------------------------------------------------------------
 * 比赛作品刻意不引入数据库：全部业务数据以 JSON/Markdown 形式随仓库分发，
 * 评委克隆后 `npm i && npm run dev` 即可完整复现，消除「演示环境不可用」的风险。
 * 生产化路径见技术文档「演进路线」：Postgres + pgvector 替换本文件即可。
 */

const DATA_DIR = path.join(process.cwd(), 'data');

async function readJson<T>(file: string): Promise<T> {
  const raw = await fs.readFile(path.join(DATA_DIR, file), 'utf-8');
  return JSON.parse(raw) as T;
}

/* ---------------- 药物 ---------------- */

let drugCache: Promise<Drug[]> | null = null;
export function getDrugs(): Promise<Drug[]> {
  if (!drugCache) drugCache = readJson<Drug[]>('drugs.json');
  return drugCache;
}

let drugMapCache: Promise<Map<string, Drug>> | null = null;
async function getDrugMap(): Promise<Map<string, Drug>> {
  if (!drugMapCache) {
    drugMapCache = getDrugs().then((list) => new Map(list.map((d) => [d.id, d])));
  }
  return drugMapCache;
}

/** 按 id / 通用名 / 别名 解析药物（患者口语化描述常来自别名） */
export async function findDrug(name: string): Promise<Drug | null> {
  const list = await getDrugs();
  const q = name.trim().toLowerCase();
  if (!q) return null;
  return (
    list.find((d) => d.id.toLowerCase() === q) ??
    list.find((d) => d.name.toLowerCase() === q) ??
    list.find((d) => d.aliases.some((a) => a.toLowerCase() === q)) ??
    list.find((d) => d.name.includes(q) || q.includes(d.name)) ??
    list.find((d) => d.aliases.some((a) => a.toLowerCase().includes(q) || q.includes(a.toLowerCase()))) ??
    null
  );
}

/** 从自由文本中抽取药物（支持别名共现，用于语音/OCR 输入的解析） */
export async function extractDrugs(text: string): Promise<Drug[]> {
  const list = await getDrugs();
  const norm = text.toLowerCase();
  const found = new Map<string, Drug>();
  for (const drug of list) {
    const keys = [drug.name, ...drug.aliases].map((k) => k.toLowerCase());
    if (keys.some((k) => k.length >= 2 && norm.includes(k))) found.set(drug.id, drug);
  }
  return Array.from(found.values());
}

/* ---------------- 相互作用 ---------------- */

let ixCache: Promise<InteractionRule[]> | null = null;
export function getInteractions(): Promise<InteractionRule[]> {
  if (!ixCache) ixCache = readJson<InteractionRule[]>('interactions.json');
  return ixCache;
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, moderate: 1, low: 2 };

/** 检查一组药物之间的两两相互作用 */
export async function checkInteractions(drugIds: string[]): Promise<InteractionRule[]> {
  const rules = await getInteractions();
  const set = new Set(drugIds);
  return rules
    .filter((r) => set.has(r.a) && set.has(r.b))
    .sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity]);
}

/* ---------------- 患者 ---------------- */

let patientCache: Promise<Patient[]> | null = null;
export function getPatients(): Promise<Patient[]> {
  if (!patientCache) patientCache = readJson<Patient[]>('patients.json');
  return patientCache;
}

export async function getPatient(id: string): Promise<Patient | null> {
  const list = await getPatients();
  return list.find((p) => p.id === id) ?? null;
}

/* ---------------- 红旗症状 ---------------- */

let flagCache: Promise<RedFlagRule[]> | null = null;
export function getRedFlags(): Promise<RedFlagRule[]> {
  if (!flagCache) flagCache = readJson<RedFlagRule[]>('redflags.json');
  return flagCache;
}

/* ---------------- 药物 + 相互作用联合视图 ---------------- */

/**
 * 组装一次交互所需的完整患者数据包
 * 服务端组件调用一次，把「档案 + 用药视图 + 相互作用（含药名）」整体传给客户端，
 * 客户端即可零请求渲染冲突图谱与用药卡片。
 */
export async function getPatientBundle(patient: Patient): Promise<PatientBundle> {
  const meds = await getPatientMedViews(patient);
  const rules = await checkInteractions(meds.map((m) => m.drugId));
  const nameOf = new Map(meds.map((m) => [m.drugId, m.name]));
  return {
    patient,
    meds,
    interactions: rules.map((r) => ({
      a: r.a,
      b: r.b,
      aName: nameOf.get(r.a) ?? r.a,
      bName: nameOf.get(r.b) ?? r.b,
      severity: r.severity,
      mechanism: r.mechanism,
      action: r.action,
      evidence: r.evidence,
    })),
  };
}

/** 把患者用药记录补全为可渲染的视图对象 */
export async function getPatientMedViews(patient: Patient): Promise<PatientMedView[]> {
  const map = await getDrugMap();
  return patient.meds.map((m) => {
    const drug = map.get(m.drugId);
    return {
      drugId: m.drugId,
      name: drug?.name ?? m.drugId,
      dose: m.dose,
      freq: m.freq,
      source: m.source,
      className: drug?.class ?? '未知类别',
      riskTags: drug?.riskTags ?? [],
      renalNote: drug?.renalNote ?? '',
      elderlyCaution: drug?.elderlyCaution ?? '',
      monitoring: drug?.monitoring ?? [],
    };
  });
}
