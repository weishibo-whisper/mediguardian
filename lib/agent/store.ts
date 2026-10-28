import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentRun } from '@/lib/types';

/**
 * 运行轨迹仓库
 * ------------------------------------------------------------------
 * 内存 Map 提供零延迟读取（当前进程内），同时把轨迹落盘为 JSON，
 * 使 /trace/[runId] 在服务重启后依然可回放——这是「可解释性」的硬要求：
 * 任何人都可以现场点开任意一次运行的完整决策链。
 */

const RUN_DIR = path.join(process.cwd(), 'logs', 'runs');
const memory = new Map<string, AgentRun>();
const MAX_MEMORY = 60;

export async function saveRun(run: AgentRun): Promise<void> {
  memory.set(run.id, run);
  if (memory.size > MAX_MEMORY) {
    const oldest = memory.keys().next().value;
    if (oldest) memory.delete(oldest);
  }
  try {
    await fs.mkdir(RUN_DIR, { recursive: true });
    await fs.writeFile(path.join(RUN_DIR, `${run.id}.json`), JSON.stringify(run, null, 2), 'utf-8');
  } catch {
    // 只读环境下仅保留内存轨迹
  }
}

export async function loadRun(id: string): Promise<AgentRun | null> {
  const cached = memory.get(id);
  if (cached) return cached;
  try {
    const raw = await fs.readFile(path.join(RUN_DIR, `${id}.json`), 'utf-8');
    const run = JSON.parse(raw) as AgentRun;
    memory.set(run.id, run);
    return run;
  } catch {
    return null;
  }
}

/** 列出最近的运行（按开始时间倒序） */
export async function listRuns(limit = 12): Promise<Array<Pick<AgentRun, 'id' | 'patientId' | 'question' | 'mode' | 'startedAt' | 'durationMs' | 'confidence'>>> {
  try {
    const files = await fs.readdir(RUN_DIR);
    const runs: AgentRun[] = [];
    for (const file of files.slice(-40)) {
      try {
        const raw = await fs.readFile(path.join(RUN_DIR, file), 'utf-8');
        runs.push(JSON.parse(raw) as AgentRun);
      } catch {
        /* 跳过损坏文件 */
      }
    }
    return runs
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        patientId: r.patientId,
        question: r.question,
        mode: r.mode,
        startedAt: r.startedAt,
        durationMs: r.durationMs,
        confidence: r.confidence,
      }));
  } catch {
    return Array.from(memory.values())
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .slice(0, limit);
  }
}
