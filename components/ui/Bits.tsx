import { cn } from '@/lib/utils';

/** 轻量徽标 */
export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'brand' | 'danger' | 'warn' | 'ok';
  className?: string;
}) {
  const tones = {
    neutral: 'border-line bg-surface-sunken text-ink-soft',
    brand: 'border-brand-200 bg-brand-50 text-brand-700',
    danger: 'border-danger/25 bg-danger/10 text-danger',
    warn: 'border-warn/25 bg-warn/10 text-warn',
    ok: 'border-ok/25 bg-ok/10 text-ok',
  } as const;
  return <span className={cn('chip', tones[tone], className)}>{children}</span>;
}

/** 小节标题：左侧竖线 + 右侧可选的说明 */
export function SectionTitle({
  title,
  desc,
  right,
  className,
}: {
  title: string;
  desc?: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-end justify-between gap-3', className)}>
      <div className="flex items-start gap-2">
        <span className="mt-1 h-4 w-1 shrink-0 rounded-full bg-brand-500" />
        <div>
          <h2 className="text-[0.95rem] font-semibold tracking-tight text-ink">{title}</h2>
          {desc ? <p className="mt-0.5 text-xs leading-relaxed text-ink-mute">{desc}</p> : null}
        </div>
      </div>
      {right}
    </div>
  );
}

/** 指标卡 */
export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="card p-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-mute">{label}</p>
      <p className={cn('mt-1 font-mono text-xl font-semibold tracking-tight', tone ?? 'text-ink')}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] leading-snug text-ink-mute">{hint}</p> : null}
    </div>
  );
}

/** 空状态 */
export function Empty({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-line px-4 py-8 text-center">
      <p className="text-sm font-medium text-ink-soft">{title}</p>
      {desc ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-ink-mute">{desc}</p> : null}
    </div>
  );
}
