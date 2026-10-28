'use client';

import { useMemo, useState } from 'react';
import type { PatientBundle } from '@/lib/types';
import { cn, SEVERITY_META } from '@/lib/utils';

/**
 * 用药冲突图谱（核心视觉创新）
 * ------------------------------------------------------------------
 * 传统用药清单是「平铺列表」，多重用药的风险藏在两两组合里，
 * 医生与家属很难用眼睛看出「哪两个药在打架」。
 * 这里把 N 种药排成环形节点，把相互作用画成连线：
 *  - 连线颜色 = 严重程度（红/橙/绿），高风险连线做流动虚线动画，吸引注意；
 *  - 点击连线展开机制与处置建议，并可跳到对应证据；
 *  - 节点色 = 是否「非医嘱自购药」，因为最危险的往往不是处方药。
 *
 * 用纯 SVG 手写而非图表库：约 150 行、体积 0、完全可控，且能做成可访问的焦点元素。
 */

export function ConflictGraph({ bundle }: { bundle: PatientBundle }) {
  const [selected, setSelected] = useState<string | null>(null);

  const size = 320;
  const center = size / 2;
  const radius = 112;

  const nodes = useMemo(() => {
    const n = bundle.meds.length;
    return bundle.meds.map((med, i) => {
      const angle = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
      return {
        ...med,
        x: center + radius * Math.cos(angle),
        y: center + radius * Math.sin(angle),
        selfBought: /自购|自行|邻居|家人/.test(med.source),
        index: i,
      };
    });
  }, [bundle.meds, center, radius]);

  const edges = useMemo(() => {
    return bundle.interactions
      .map((ix) => {
        const a = nodes.find((n) => n.drugId === ix.a);
        const b = nodes.find((n) => n.drugId === ix.b);
        if (!a || !b) return null;
        return { ...ix, from: a, to: b, key: `${ix.a}-${ix.b}` };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
  }, [bundle.interactions, nodes]);

  const selectedEdge = edges.find((e) => e.key === selected);
  const strokeOf = (severity: string) =>
    severity === 'high' ? 'rgb(var(--danger))' : severity === 'moderate' ? 'rgb(var(--warn))' : 'rgb(var(--ok))';

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl border border-line bg-surface p-1">
        <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full" role="img" aria-label="用药冲突关系图">
          <defs>
            <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%" stop-opacity="0">
              <stop offset="0%" stopColor="rgb(var(--brand-100))" stopOpacity="0.9" />
              <stop offset="100%" stopColor="rgb(var(--brand-100))" stopOpacity="0" />
            </radialGradient>
          </defs>

          <circle cx={center} cy={center} r={radius} fill="none" stroke="rgb(var(--line))" strokeDasharray="2 4" />

          {/* 连线 */}
          {edges.map((edge) => {
            const isSelected = edge.key === selected;
            const dim = selected !== null && !isSelected;
            return (
              <g key={edge.key} opacity={dim ? 0.25 : 1} className="transition-opacity">
                <line
                  x1={edge.from.x}
                  y1={edge.from.y}
                  x2={edge.to.x}
                  y2={edge.to.y}
                  stroke={strokeOf(edge.severity)}
                  strokeWidth={isSelected ? 3 : edge.severity === 'high' ? 2 : 1.4}
                  strokeLinecap="round"
                  strokeDasharray={edge.severity === 'high' ? '5 4' : undefined}
                  className={edge.severity === 'high' ? 'animate-trace-dash' : undefined}
                />
                {/* 透明加粗命中区，方便手指点击 */}
                <line
                  x1={edge.from.x}
                  y1={edge.from.y}
                  x2={edge.to.x}
                  y2={edge.to.y}
                  stroke="transparent"
                  strokeWidth={12}
                  className="cursor-pointer"
                  onClick={() => setSelected(isSelected ? null : edge.key)}
                />
              </g>
            );
          })}

          {/* 节点 */}
          {nodes.map((node) => (
            <g key={node.drugId}>
              <circle cx={node.x} cy={node.y} r={16} fill="url(#nodeGlow)" />
              <circle
                cx={node.x}
                cy={node.y}
                r={11}
                fill={node.selfBought ? 'rgb(var(--warn))' : 'rgb(var(--brand-600))'}
                stroke="rgb(var(--surface-raised))"
                strokeWidth={2}
              />
              <text
                x={node.x}
                y={node.y + 3.2}
                textAnchor="middle"
                className="fill-white font-mono text-[7px] font-bold"
              >
                {node.index + 1}
              </text>
              <text
                x={node.x}
                y={node.y + (node.y > center ? 26 : -18)}
                textAnchor="middle"
                className={cn('text-[7.5px]', node.selfBought ? 'fill-[rgb(var(--warn))]' : 'fill-[rgb(var(--ink-soft))]')}
              >
                {node.name.length > 5 ? `${node.name.slice(0, 5)}…` : node.name}
              </text>
            </g>
          ))}
        </svg>

        <div className="absolute bottom-1.5 left-2 flex flex-wrap items-center gap-2 text-[9px] text-ink-mute">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-3 rounded-full bg-danger" /> 高风险
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-3 rounded-full bg-warn" /> 中风险
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-3 rounded-full bg-ok" /> 低风险
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-warn" /> 非医嘱药
          </span>
        </div>
      </div>

      {/* 选中连线详情 */}
      {selectedEdge ? (
        <div className="animate-fade-up rounded-xl border border-line bg-surface px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <span className={cn('chip', SEVERITY_META[selectedEdge.severity].tone)}>
              {SEVERITY_META[selectedEdge.severity].label}
            </span>
            <p className="text-[11px] font-medium text-ink">
              {selectedEdge.from.name} + {selectedEdge.to.name}
            </p>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-ink-soft">
            <span className="text-ink-mute">机制：</span>
            {selectedEdge.mechanism}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-ink-soft">
            <span className="text-ink-mute">处置：</span>
            {selectedEdge.action}
          </p>
        </div>
      ) : (
        <p className="px-1 text-[10px] leading-relaxed text-ink-mute">
          共 {bundle.interactions.length} 组相互作用。点击任意连线查看机制与处置建议；
          {bundle.interactions.filter((i) => i.severity === 'high').length > 0
            ? '红色虚线为需要优先处理的组合。'
            : '当前未发现高风险组合。'}
        </p>
      )}
    </div>
  );
}
