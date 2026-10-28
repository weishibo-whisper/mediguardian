'use client';

import type { PatientBundle } from '@/lib/types';
import { useConsoleStore } from '@/lib/store/useConsoleStore';
import { Badge } from '@/components/ui/Bits';
import { ckdStage, cn } from '@/lib/utils';
import { AlertTriangle, Phone, Pill, Stethoscope, UserRound } from 'lucide-react';

/**
 * 左侧患者栏
 * 视觉重点：把「自购药 / 家属给的药」与「医嘱药」在视觉上区分开，
 * 因为真实场景中最危险的药物往往不在处方里。
 */
export function PatientRail({ bundles, activeId }: { bundles: PatientBundle[]; activeId: string }) {
  const selectPatient = useConsoleStore((s) => s.selectPatient);
  const active = bundles.find((b) => b.patient.id === activeId) ?? bundles[0];
  const highRisks = active.interactions.filter((i) => i.severity === 'high').length;
  const renal = ckdStage(active.patient.labs.eGFR);
  const { INR, potassium, hemoglobin } = active.patient.labs;

  return (
    <div className="space-y-3 lg:sticky lg:top-[4.6rem] lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1">
      {/* 患者切换 */}
      <div className="card p-2">
        <p className="px-2 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-ink-mute">
          随访名单 · {bundles.length} 人
        </p>
        <ul className="space-y-1">
          {bundles.map((b) => {
            const isActive = b.patient.id === activeId;
            const risk = b.interactions.filter((i) => i.severity === 'high').length;
            return (
              <li key={b.patient.id}>
                <button
                  type="button"
                  onClick={() => selectPatient(b.patient.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition',
                    isActive ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-surface-sunken',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold',
                      isActive ? 'bg-accent-solid text-white' : 'bg-surface-sunken text-ink-soft',
                    )}
                  >
                    {b.patient.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-ink">{b.patient.name}</span>
                      <span className="shrink-0 text-[11px] text-ink-mute">
                        {b.patient.sex}·{b.patient.age}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-ink-mute">
                      <Pill size={10} /> {b.meds.length} 种药
                      {risk > 0 ? <span className="text-danger">· {risk} 项高风险</span> : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 档案卡 */}
      <div className="card space-y-3 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <UserRound size={14} className="text-brand-600" />
              {active.patient.name}
            </h3>
            <p className="mt-0.5 text-[11px] text-ink-mute">{active.patient.region}</p>
          </div>
          <Badge tone={highRisks > 0 ? 'danger' : 'ok'}>
            {highRisks > 0 ? `${highRisks} 项高风险` : '暂无高风险'}
          </Badge>
        </div>

        <p className="flex items-start gap-1.5 rounded-lg bg-surface-sunken px-2 py-1.5 text-[11px] leading-relaxed text-ink-soft">
          <Stethoscope size={12} className="mt-0.5 shrink-0 text-brand-600" />
          {active.patient.conditions.join('、')}
        </p>

        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          <Lab label="eGFR" value={active.patient.labs.eGFR ? `${active.patient.labs.eGFR}` : '—'} hint={renal.stage} tone={renal.tone} />
          <Lab label="INR" value={INR ? `${INR}` : '—'} hint={INR && INR > 3 ? '超出上限' : '—'} tone={INR && INR > 3 ? 'text-danger' : 'text-ink-mute'} />
          <Lab label="血钾" value={potassium ? `${potassium}` : '—'} hint={potassium && potassium >= 5 ? '偏高' : '正常'} tone={potassium && potassium >= 5 ? 'text-warn' : 'text-ink-mute'} />
          <Lab label="血红蛋白" value={hemoglobin ? `${hemoglobin}` : '—'} hint={hemoglobin && hemoglobin < 110 ? '贫血' : '正常'} tone={hemoglobin && hemoglobin < 110 ? 'text-warn' : 'text-ink-mute'} />
        </div>

        <div>
          <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-ink-soft">
            <Pill size={11} className="text-brand-600" /> 在用药清单
          </p>
          <ul className="space-y-1.5">
            {active.meds.map((m) => {
              const selfBought = /自购|自行|邻居|家人赠/.test(m.source);
              return (
                <li
                  key={m.drugId}
                  className={cn(
                    'rounded-lg border px-2 py-1.5',
                    selfBought ? 'border-warn/30 bg-warn/5' : 'border-line bg-surface',
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[12px] font-medium text-ink">{m.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-mute">{m.dose}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-1">
                    <span className="truncate text-[10px] text-ink-mute">{m.freq}</span>
                    {selfBought ? (
                      <span className="chip shrink-0 border-warn/25 bg-warn/10 px-1 text-[9px] text-warn">
                        <AlertTriangle size={8} /> 非医嘱
                      </span>
                    ) : (
                      <span className="shrink-0 text-[9px] text-ink-mute">医嘱</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] text-ink-soft">
          <Phone size={11} className="text-brand-600" />
          {active.patient.family.name}（{active.patient.family.relation}）· {active.patient.family.available}
        </div>
      </div>
    </div>
  );
}

function Lab({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-2 py-1">
      <p className="text-[10px] text-ink-mute">{label}</p>
      <p className="font-mono text-[12px] font-semibold text-ink">{value}</p>
      {hint && hint !== '—' ? <p className={cn('text-[9px] leading-tight', tone ?? 'text-ink-mute')}>{hint}</p> : null}
    </div>
  );
}
