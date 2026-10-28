import type { Metadata } from 'next';
import Link from 'next/link';
import { readAudit } from '@/lib/safety';
import { listRuns } from '@/lib/agent/store';
import { Badge, Empty, SectionTitle, Stat } from '@/components/ui/Bits';
import { cn, fmtMs } from '@/lib/utils';
import { ArrowRight, FileClock, ShieldAlert, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = { title: '安全审计 · 守药人 MediGuardian' };
export const dynamic = 'force-dynamic';

/**
 * 安全审计页
 * 对应「AI 安全与可控性 / 可解释性」：把每一次 Agent 运行的输入、工具链、
 * 引用、安全等级、置信度与耗时全部摊开，支持逐条跳转到决策轨迹回放。
 */
export default async function SafetyPage() {
  const [audit, runs] = await Promise.all([readAudit(40), listRuns(20)]);

  const blocked = audit.filter((a) => a.safetyLevel === 'block').length;
  const notices = audit.filter((a) => a.safetyLevel === 'notice').length;
  const avgConfidence =
    audit.length > 0 ? (audit.reduce((s, a) => s + a.confidence, 0) / audit.length).toFixed(2) : '—';

  return (
    <div className="space-y-5 pb-4">
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">安全审计</Badge>
          <Badge>日志路径 logs/audit.jsonl</Badge>
          <Badge>轨迹路径 logs/runs/*.json</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">每一次判断，都留下证据</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
          医疗 AI 的可信度不来自「模型很强」，而来自「出错时能被发现、被复现、被纠正」。
          本页是运行时的审计出口：任何一次对话都能看到它调用了哪些工具、引用了哪些证据、触发了哪些安全规则。
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="审计条目" value={`${audit.length}`} hint="最近 40 次运行" />
        <Stat
          label="触发强转诊"
          value={`${blocked}`}
          hint="命中红旗症状，输出被改写为「立即就医」优先"
          tone={blocked > 0 ? 'text-danger' : undefined}
        />
        <Stat label="需要提示" value={`${notices}`} hint="含 PII 脱敏 / 输出改写 / 证据不足" tone={notices > 0 ? 'text-warn' : undefined} />
        <Stat label="平均置信度" value={`${avgConfidence}`} hint="由证据得分与引用覆盖率联合计算" />
      </section>

      <section className="card p-4">
        <SectionTitle
          title="审计流水"
          desc="每条记录对应一次完整 Agent 运行，可跳转查看逐步轨迹"
          right={
            <span className="flex items-center gap-1 text-[10px] text-ink-mute">
              <FileClock size={11} /> JSONL 追加写
            </span>
          }
        />

        <div className="mt-3 min-w-0">
          {audit.length === 0 ? (
            <Empty
              title="还没有运行记录"
              desc="先到智能诊台提一个问题（例如「牙龈出血、大便发黑，是不是止痛药引起的」），
                这里就会出现完整的审计条目与可回放的决策轨迹。"
            />
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[11px]">
                <thead className="text-[10px] uppercase tracking-wide text-ink-mute">
                  <tr className="border-b border-line">
                    <th className="py-2 pr-3 font-medium">时间</th>
                    <th className="py-2 pr-3 font-medium">患者</th>
                    <th className="py-2 pr-3 font-medium">问题</th>
                    <th className="py-2 pr-3 font-medium">引擎</th>
                    <th className="py-2 pr-3 font-medium">工具链</th>
                    <th className="py-2 pr-3 font-medium">安全</th>
                    <th className="py-2 pr-3 font-medium">置信度</th>
                    <th className="py-2 pr-1 font-medium">轨迹</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {audit.map((entry) => (
                    <tr key={entry.runId} className="align-top text-ink-soft">
                      <td className="whitespace-nowrap py-2 pr-3 font-mono text-[10px] text-ink-mute">
                        {entry.at.slice(5, 19).replace('T', ' ')}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">{entry.patientId}</td>
                      <td className="max-w-[220px] py-2 pr-3">
                        <span className="line-clamp-2">{entry.question}</span>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        <Badge tone={entry.mode === 'llm' ? 'brand' : 'neutral'}>{entry.mode}</Badge>
                      </td>
                      <td className="py-2 pr-3 font-mono text-[10px]">
                        {entry.tools.length} 个 · {fmtMs(entry.durationMs)}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={cn(
                            'chip',
                            entry.safetyLevel === 'block'
                              ? 'border-danger/25 bg-danger/10 text-danger'
                              : entry.safetyLevel === 'notice'
                                ? 'border-warn/25 bg-warn/10 text-warn'
                                : 'border-ok/25 bg-ok/10 text-ok',
                          )}
                        >
                          {entry.safetyLevel === 'block' ? <ShieldAlert size={9} /> : <ShieldCheck size={9} />}
                          {entry.safetyLevel}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono">{entry.confidence.toFixed(2)}</td>
                      <td className="py-2 pr-1">
                        <Link
                          href={`/trace/${entry.runId}`}
                          /* 点击区：链接文字仅 17px 高，用 min-h-6 撑到 WCAG 2.5.8 的 24px */
                          className="inline-flex min-h-6 items-center gap-0.5 text-accent-text hover:underline"
                        >
                          查看 <ArrowRight size={9} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {runs.length > 0 ? (
        <section className="card p-4">
          <SectionTitle title="可供回放的运行" desc="点击查看完整的规划、工具参数、检索证据与最终回答" />
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {/* min-w-0：grid 子项默认 min-width:auto，里面那条 shrink-0 的 run id 会把 320px 视口顶出横向滚动条 */}
            {runs.map((run) => (
              <li key={run.id} className="min-w-0">
                <Link
                  href={`/trace/${run.id}`}
                  className="flex items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-2 text-[11px] transition hover:border-brand-200 hover:bg-brand-50/40"
                >
                  <code className="shrink-0 rounded bg-surface-sunken px-1 py-0.5 font-mono text-[9px] text-accent-text">
                    {run.id}
                  </code>
                  <span className="truncate text-ink-soft">{run.question}</span>
                  <span className="ml-auto shrink-0 font-mono text-[9px] text-ink-mute">
                    {fmtMs(run.durationMs)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
