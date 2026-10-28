import { getKbStats } from '@/lib/rag';
import { getPatientBundle, getPatients } from '@/lib/data';
import { Console } from '@/components/console/Console';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: '智能诊台 · 守药人 MediGuardian' };
export const dynamic = 'force-dynamic';

/**
 * 智能诊台（服务端组装数据，客户端只做交互）
 * 把患者数据包一次性下发，客户端切换患者无需重新请求，
 * 交互延迟从「一次往返」降到 0。
 */
export default async function ConsolePage() {
  const [patients, stats] = await Promise.all([getPatients(), getKbStats()]);
  const bundles = await Promise.all(patients.map((p) => getPatientBundle(p)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">智能诊台</h1>
          <p className="mt-0.5 text-xs text-ink-mute">
            选中患者 → 提问 → 右侧实时查看 Agent 的规划、工具调用、检索证据与安全守门记录
          </p>
        </div>
        <p className="text-[11px] text-ink-mute">
          数据均为演示样例 · 无真实患者信息 · 全部推理在本机完成
        </p>
      </div>
      <Console bundles={bundles} stats={{ docCount: stats.docCount, chunkCount: stats.chunkCount }} />
    </div>
  );
}
