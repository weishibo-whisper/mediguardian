import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRun } from '@/lib/agent/store';
import { MiniMarkdown } from '@/components/MiniMarkdown';
import { Badge, SectionTitle } from '@/components/ui/Bits';
import { cn, fmtMs } from '@/lib/utils';
import { ArrowLeft, CheckCircle2, Clock, ShieldAlert, Wrench } from 'lucide-react';

export const metadata: Metadata = { title: '决策轨迹回放 · 守药人 MediGuardian' };
export const dynamic = 'force-dynamic';

/**
 * 决策轨迹回放
 * 这一页是整个产品最有说服力的地方：任意一次运行都能逐帧展开——
 * 规划了哪几步、每个工具的入参与返回、检索到哪些证据、守门改写了什么、最终答案是什么。
 */
export default async function TracePage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await loadRun(runId);
  if (!run) notFound();

  const totalToolMs = run.toolCalls.reduce((s, t) => s + t.ms, 0);

  return (
    <div className="space-y-4 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/safety" className="btn-ghost !px-2 !py-1.5 text-xs">
          <ArrowLeft size={12} /> 返回审计
        </Link>
        <Badge tone={run.mode === 'llm' ? 'brand' : 'neutral'}>{run.mode === 'llm' ? '大模型引擎' : '规则引擎'}</Badge>
        <Badge>{run.model}</Badge>
        <Badge tone={run.safety.level === 'block' ? 'danger' : run.safety.level === 'notice' ? 'warn' : 'ok'}>
          安全等级 {run.safety.level}
        </Badge>
        <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-ink-mute">
          <Clock size={10} /> {fmtMs(run.durationMs)} · 工具耗时 {fmtMs(totalToolMs)}
        </span>
      </div>

      <header className="card space-y-2 p-4">
        <p className="font-mono text-[10px] text-ink-mute">
          run: {run.id} · {run.startedAt.replace('T', ' ').slice(0, 19)}
        </p>
        <h1 className="text-lg font-semibold leading-snug tracking-tight text-ink">{run.question}</h1>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-mute">
          <span>患者 {run.patientId}</span>
          <span className="text-line">|</span>
          <span>引用证据 {run.citations.length} 条</span>
          <span className="text-line">|</span>
          <span>置信度 {Math.round(run.confidence * 100)}%</span>
          <span className="text-line">|</span>
          <span>工具调用 {run.toolCalls.length} 次</span>
          {run.tokenUsage ? (
            <>
              <span className="text-line">|</span>
              <span>
                token {run.tokenUsage.prompt}+{run.tokenUsage.completion}
              </span>
            </>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* 左侧：步骤 + 工具 */}
        <div className="space-y-3">
          <section className="card p-3.5">
            <SectionTitle title="执行步骤" desc={`${run.steps.length} 步`} />
            <ol className="mt-2 space-y-1.5">
              {run.steps.map((step) => (
                <li key={step.id} className="flex gap-1.5">
                  <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-ok" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium leading-snug text-ink">{step.title}</p>
                    {step.detail ? <p className="text-[10px] leading-snug text-ink-mute">{step.detail}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="card p-3.5">
            <SectionTitle title="工具调用" desc="入参与返回完整保留" />
            <ul className="mt-2 space-y-1.5">
              {run.toolCalls.map((call) => (
                <li key={call.id} className="rounded-lg border border-line bg-surface px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <Wrench size={10} className="text-brand-600" />
                    <code className="font-mono text-[10px] text-accent-text">{call.name}</code>
                    <span className="ml-auto font-mono text-[9px] text-ink-mute">{call.ms}ms</span>
                  </div>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-ink-soft">{call.summary}</p>
                </li>
              ))}
            </ul>
          </section>

          {run.safety.flags.length > 0 ? (
            <section className="card p-3.5">
              <SectionTitle title="安全守门" desc={`${run.safety.flags.length} 条记录`} />
              <ul className="mt-2 space-y-1">
                {run.safety.flags.map((flag) => (
                  <li
                    key={flag.id}
                    className={cn(
                      'rounded-lg px-2 py-1.5 text-[10px] leading-relaxed',
                      flag.level === 'critical' ? 'bg-danger/10 text-danger' : 'bg-warn/10 text-warn',
                    )}
                  >
                    <p className="flex items-center gap-1 font-medium">
                      <ShieldAlert size={9} /> {flag.title}
                    </p>
                    <p className="mt-0.5 opacity-90">{flag.detail}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {/* 右侧：证据 + 回答 */}
        <div className="space-y-3">
          <section className="card p-4">
            <SectionTitle title="最终回答" desc="与用户看到的完全一致（含引用徽标）" />
            <div className="mt-2">
              <MiniMarkdown text={run.answer} />
            </div>
          </section>

          <section className="card p-4">
            <SectionTitle
              title="检索证据"
              desc={`${run.retrievals.reduce((s, r) => s + r.hits.length, 0)} 条命中 · 含四项打分明细`}
            />
            <ul className="mt-2 space-y-1.5">
              {run.retrievals.flatMap((r) =>
                r.hits.map((hit, i) => (
                  <li key={`${r.query}-${hit.chunkId}-${i}`} className="rounded-lg border border-line bg-surface px-2.5 py-2">
                    <div className="flex items-center gap-1.5">
                      <code className="rounded bg-surface-sunken px-1 font-mono text-[9px] text-accent-text">
                        {hit.chunkId}
                      </code>
                      <span className="truncate text-[11px] font-medium text-ink">
                        {hit.title} · {hit.section}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[9px] text-ink-mute">
                        {(hit.score * 100).toFixed(0)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-[10px] leading-relaxed text-ink-soft">
                      {hit.text.replace(/^#+\s*/gm, '').slice(0, 260)}
                    </p>
                  </li>
                )),
              )}
            </ul>
            {run.retrievals.length === 0 ? <p className="text-[11px] text-ink-mute">本次运行未产生检索。</p> : null}
          </section>
        </div>
      </div>
    </div>
  );
}
