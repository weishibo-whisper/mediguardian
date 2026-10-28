'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { PatientBundle } from '@/lib/types';
import { useConsoleStore } from '@/lib/store/useConsoleStore';
import { Badge, Empty, SectionTitle } from '@/components/ui/Bits';
import { ConflictGraph } from './ConflictGraph';
import { cn, fmtMs, SEVERITY_META } from '@/lib/utils';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  GitBranch,
  Layers,
  Loader2,
  ShieldAlert,
  XCircle,
} from 'lucide-react';

/**
 * 右侧「可解释性」面板
 * ------------------------------------------------------------------
 * 三个视角回答同一个问题：AI 凭什么这么说？
 *  - 轨迹：逐步执行 + 工具调用 + 耗时（过程可审计）
 *  - 证据：检索命中的原文与四项打分明细（结论可追溯）
 *  - 图谱：用药冲突的拓扑结构（风险可感知）
 */
export function InsightPanel({ bundle }: { bundle: PatientBundle }) {
  const { activeTab, setTab, live, selectedChunkId, selectChunk } = useConsoleStore();
  const evidenceRef = useRef<HTMLDivElement>(null);

  const allHits = useMemo(() => live.retrievals.flatMap((r) => r.hits), [live.retrievals]);

  useEffect(() => {
    if (live.running && activeTab === 'graph') setTab('trace');
  }, [live.running, activeTab, setTab]);

  useEffect(() => {
    if (selectedChunkId && evidenceRef.current) {
      const el = evidenceRef.current.querySelector<HTMLElement>(`[data-chunk="${selectedChunkId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [selectedChunkId]);

  const tabs = [
    { id: 'trace' as const, label: '思考轨迹', icon: GitBranch, count: live.toolCalls.length },
    { id: 'evidence' as const, label: '证据', icon: Layers, count: allHits.length },
    { id: 'graph' as const, label: '冲突图谱', icon: AlertTriangle, count: bundle.interactions.length },
  ];

  return (
    <section className="card flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden lg:sticky lg:top-[4.6rem] lg:h-[calc(100vh-6rem)]">
      <div className="flex items-center gap-0.5 border-b border-line/80 px-2 py-1.5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              aria-selected={active}
              role="tab"
              className={cn(
                'flex flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] font-medium transition',
                active ? 'bg-brand-50 text-brand-700' : 'text-ink-mute hover:bg-surface-sunken hover:text-ink-soft',
              )}
            >
              <Icon size={12} />
              {tab.label}
              {tab.count > 0 ? (
                <span className={cn('rounded-full px-1 font-mono text-[9px]', active ? 'bg-brand-100' : 'bg-surface-sunken')}>
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3" ref={evidenceRef}>
        {activeTab === 'trace' ? (
          <TraceView bundle={bundle} />
        ) : activeTab === 'evidence' ? (
          <EvidenceView hits={allHits} selectedChunkId={selectedChunkId} onSelect={selectChunk} />
        ) : (
          <div className="space-y-3">
            <SectionTitle
              title="用药冲突图谱"
              desc="红色连线=高风险组合，点击连线查看机制与处置建议"
            />
            <ConflictGraph bundle={bundle} />
          </div>
        )}
      </div>
    </section>
  );
}

/* ==================================================================
 * 轨迹视图
 * ================================================================== */
function TraceView({ bundle }: { bundle: PatientBundle }) {
  const { live } = useConsoleStore();
  const hasRun = live.steps.length > 0;

  if (!hasRun) {
    return (
      <div className="space-y-3">
        <Empty
          title="还没有运行记录"
          desc="在中间输入一个问题，这里会实时长出 Agent 的规划、工具调用与耗时；每一行都可点开看参数与返回。"
        />
        <div className="rounded-xl bg-surface-sunken px-3 py-2 text-[11px] leading-relaxed text-ink-mute">
          <p className="font-medium text-ink-soft">本次患者已有静态风险（无需 AI 也能看到）：</p>
          <p className="mt-1">
            {live.safety?.forceReferral ? '危险信号已标记 · ' : ''}
            {bundle.interactions.length} 组相互作用，其中{' '}
            {bundle.interactions.filter((i) => i.severity === 'high').length} 组高风险。
          </p>
        </div>
      </div>
    );
  }

  const doneCount = live.steps.filter((s) => s.status === 'done').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionTitle title="执行轨迹" desc={`${doneCount}/${live.steps.length} 步完成`} />
        {live.elapsedMs ? (
          <span className="flex items-center gap-1 text-[10px] text-ink-mute">
            <Clock size={10} /> {fmtMs(live.elapsedMs)}
          </span>
        ) : null}
      </div>

      {/* 计划步骤 */}
      <ol className="relative space-y-1.5 pl-1">
        {live.steps.map((step, i) => {
          const running = step.status === 'running';
          const done = step.status === 'done';
          const error = step.status === 'error';
          return (
            <li key={step.id} className="relative flex gap-2">
              <span className="relative flex w-4 shrink-0 justify-center">
                {i < live.steps.length - 1 ? (
                  <span
                    className={cn(
                      'absolute top-4 h-full w-px',
                      done ? 'bg-brand-200' : 'bg-line',
                    )}
                  />
                ) : null}
                <span className="relative z-10 mt-0.5 bg-surface-raised">
                  {done ? (
                    <CheckCircle2 size={13} className="text-ok" />
                  ) : error ? (
                    <XCircle size={13} className="text-danger" />
                  ) : running ? (
                    <Loader2 size={13} className="animate-spin text-brand-500" />
                  ) : (
                    <Circle size={13} className="text-line" />
                  )}
                </span>
              </span>
              <div className="min-w-0 flex-1 pb-1">
                <p
                  className={cn(
                    'text-[12px] leading-snug',
                    done ? 'font-medium text-ink' : running ? 'font-medium text-brand-700' : 'text-ink-mute',
                  )}
                >
                  {step.title}
                </p>
                {step.detail ? (
                  <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-ink-mute">{step.detail}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {/* 工具调用 */}
      {live.toolCalls.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-ink-mute">工具调用明细</p>
          {live.toolCalls.map((call) => (
            <details key={call.id} className="group rounded-lg border border-line bg-surface px-2 py-1.5">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px]">
                <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[10px] text-brand-700">
                  {call.name}
                </code>
                <span className="ml-auto font-mono text-[9px] text-ink-mute">{call.ms}ms</span>
                <span
                  className={cn(
                    'rounded px-1 text-[9px]',
                    call.status === 'ok' ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger',
                  )}
                >
                  {call.status === 'ok' ? 'OK' : 'ERR'}
                </span>
              </summary>
              <p className="mt-1 text-[10px] leading-relaxed text-ink-soft">{call.summary}</p>
              {call.args && Object.keys(call.args).length > 0 ? (
                <pre className="mt-1 max-h-24 overflow-auto rounded bg-surface-sunken p-1.5 font-mono text-[9px] leading-relaxed text-ink-mute">
                  {JSON.stringify(call.args, null, 1)}
                </pre>
              ) : null}
            </details>
          ))}
        </div>
      ) : null}

      {/* 系统提示 */}
      {live.notes.length > 0 ? (
        <div className="space-y-1">
          {live.notes.map((note, i) => (
            <p
              key={i}
              className={cn(
                'rounded-lg px-2 py-1.5 text-[10px] leading-relaxed',
                note.level === 'warn' ? 'bg-warn/10 text-warn' : 'bg-surface-sunken text-ink-mute',
              )}
            >
              {note.text}
            </p>
          ))}
        </div>
      ) : null}

      {/* 安全标记 */}
      {live.safety && live.safety.flags.length > 0 ? (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-ink-mute">
            <ShieldAlert size={11} /> 安全守门记录
          </p>
          {live.safety.flags.map((flag) => (
            <div
              key={flag.id}
              className={cn(
                'rounded-lg border px-2 py-1.5 text-[10px] leading-relaxed',
                flag.level === 'critical'
                  ? 'border-danger/25 bg-danger/5 text-danger'
                  : flag.level === 'warn'
                    ? 'border-warn/25 bg-warn/5 text-warn'
                    : 'border-line bg-surface text-ink-mute',
              )}
            >
              <p className="font-medium">{flag.title}</p>
              <p className="mt-0.5 opacity-90">{flag.detail}</p>
            </div>
          ))}
        </div>
      ) : null}

      {live.confidence !== undefined ? (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5">
          <span className="text-[10px] text-ink-mute">置信度</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                live.confidence >= 0.75 ? 'bg-ok' : live.confidence >= 0.5 ? 'bg-warn' : 'bg-danger',
              )}
              style={{ width: `${Math.round(live.confidence * 100)}%` }}
            />
          </div>
          <span className="font-mono text-[10px] font-semibold text-ink">{Math.round(live.confidence * 100)}%</span>
        </div>
      ) : null}
    </div>
  );
}

/* ==================================================================
 * 证据视图
 * ================================================================== */
function EvidenceView({
  hits,
  selectedChunkId,
  onSelect,
}: {
  hits: ReturnType<typeof useConsoleStore.getState>['live']['retrievals'][number]['hits'];
  selectedChunkId: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (hits.length === 0) {
    return (
      <div className="space-y-3">
        <Empty
          title="还没有检索证据"
          desc="提问后，Agent 会用 BM25 + 哈希向量双路召回，再用 RRF 融合与规则重排选出证据，命中原文会显示在这里。"
        />
        <div className="rounded-xl bg-surface-sunken px-3 py-2 text-[10px] leading-relaxed text-ink-mute">
          点回答里的数字徽标（如 [2]）可以直接跳到对应证据片段。
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <SectionTitle title="检索证据" desc={`共 ${hits.length} 条，按融合得分排序`} />
      {hits.map((hit, i) => {
        const selected = selectedChunkId === hit.chunkId;
        return (
          <button
            key={hit.chunkId}
            type="button"
            data-chunk={hit.chunkId}
            onClick={() => onSelect(selected ? null : hit.chunkId)}
            className={cn(
              'w-full rounded-xl border px-2.5 py-2 text-left transition',
              selected ? 'border-brand-500 bg-brand-50/60 shadow-soft' : 'border-line bg-surface hover:border-brand-200',
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className="grid h-4 w-4 shrink-0 place-items-center rounded bg-brand-600 font-mono text-[9px] font-bold text-white">
                {i + 1}
              </span>
              <span className="truncate text-[11px] font-medium text-ink">{hit.title}</span>
              <span className="ml-auto shrink-0 font-mono text-[9px] text-ink-mute">{(hit.score * 100).toFixed(0)}</span>
            </div>
            <p className="mt-0.5 text-[10px] text-ink-mute">{hit.section}</p>
            {selected ? (
              <>
                <p className="mt-1.5 whitespace-pre-wrap text-[10px] leading-relaxed text-ink-soft">
                  {hit.text.replace(/^#+\s*/gm, '').slice(0, 480)}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(
                    [
                      ['bm25', hit.scoreBreakdown.bm25],
                      ['vector', hit.scoreBreakdown.vector],
                      ['rrf', hit.scoreBreakdown.rrf],
                      ['rerank', hit.scoreBreakdown.rerank],
                    ] as const
                  ).map(([k, v]) => (
                    <span key={k} className="chip border-line bg-surface-raised px-1 font-mono text-[9px] text-ink-mute">
                      {k} {v.toFixed(2)}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-ink-soft">
                {hit.text.replace(/^#+\s*/gm, '').slice(0, 90)}…
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
