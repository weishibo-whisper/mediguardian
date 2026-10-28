'use client';

import { useEffect } from 'react';
import type { PatientBundle } from '@/lib/types';
import { useConsoleStore } from '@/lib/store/useConsoleStore';
import { PatientRail } from './PatientRail';
import { ChatPanel } from './ChatPanel';
import { InsightPanel } from './InsightPanel';

/**
 * 智能诊台三栏布局
 * ------------------------------------------------------------------
 * 左：患者与用药（看清「在吃什么」）
 * 中：Agent 对话（流式回答 + 证据徽标）
 * 右：思考轨迹 / 证据 / 冲突图谱（看清「为什么这么判断」）
 *
 * 三栏同时可见是本作品的核心交互主张：AI 的每一步推理都摆在用户眼前，
 * 而不是藏在一个聊天气泡里。
 */
export function Console({
  bundles,
  stats,
}: {
  bundles: PatientBundle[];
  stats: { docCount: number; chunkCount: number };
}) {
  const patientId = useConsoleStore((s) => s.patientId);
  const selectPatient = useConsoleStore((s) => s.selectPatient);

  useEffect(() => {
    if (!patientId && bundles.length > 0) selectPatient(bundles[0].patient.id);
  }, [patientId, bundles, selectPatient]);

  const active = bundles.find((b) => b.patient.id === patientId) ?? bundles[0];
  if (!active) return null;

  return (
    <div className="grid animate-fade-in gap-4 lg:grid-cols-[264px_minmax(0,1fr)_372px]">
      <PatientRail bundles={bundles} activeId={active.patient.id} />
      <ChatPanel bundle={active} stats={stats} />
      <InsightPanel bundle={active} />
    </div>
  );
}
