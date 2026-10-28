import type { Metadata } from 'next';
import { BookOpen, ShieldAlert, Shuffle } from 'lucide-react';
import { getIndex, getKbStats } from '@/lib/rag';
import { getDrugs, getInteractions, getRedFlags } from '@/lib/data';
import { getLlmConfig } from '@/lib/llm/provider';
import { RetrievalPlayground } from '@/components/evidence/RetrievalPlayground';

export const metadata: Metadata = { title: '依据与规则 · 守药人 MediGuardian' };
export const dynamic = 'force-dynamic';

/**
 * 依据页（面向医护，不面向工程师）
 *
 * 刻意不放在主导航里展示「技术架构」：村医和家属不关心 BM25 与 RRF，
 * 他们关心的是「你凭什么说这两个药不能一起吃」。
 * 所以这一页给的是三样可核对的东西：知识库清单、相互作用规则、红旗分级，
 * 以及一个可以现场输入任意药名的依据检索。工程实现留在 docs/技术文档.md，
 * 需要时可以按 /evidence 的 URL 直接访问，不作为产品入口。
 */
export default async function EvidencePage() {
  const [stats, index, interactions, redFlags, drugs] = await Promise.all([
    getKbStats(),
    getIndex(),
    getInteractions(),
    getRedFlags(),
    getDrugs(),
  ]);
  const llm = getLlmConfig();

  const drugName = new Map(drugs.map((d) => [d.id, d.name]));
  const docList = [...index.docs].sort((a, b) => a.title.localeCompare(b.title, 'zh'));

  const emergency = redFlags.filter((r) => r.level === 'emergency');
  const urgent = redFlags.filter((r) => r.level === 'urgent');

  return (
    <div className="space-y-10 pb-6">
      <header className="border-b border-line pb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">凭什么这么说</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-[1.75] text-ink-soft">
          每一条用药建议背后必须有可核对的东西：查得到的文献条目、写得清的作用机制、
          分得出轻重的报警条件。这一页把它们全部列出来，随时可以对着原文核。
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-px border-y border-line bg-line sm:grid-cols-4">
          {[
            ['知识来源', `${docList.length} 篇`],
            ['检索分块', `${stats.chunkCount} 段`],
            ['相互作用规则', `${interactions.length} 条`],
            ['报警条件', `${redFlags.length} 条`],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface px-3 py-2.5">
              <dt className="text-[10.5px] text-ink-mute">{label}</dt>
              <dd className="tnum mt-0.5 font-mono text-[15px] font-semibold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </header>

      {/* ================= 相互作用规则 ================= */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-2">
          <Shuffle size={13} className="text-ink-mute" />
          <h2 className="text-[13px] font-semibold text-ink">不能一起吃的组合</h2>
          <span className="text-[11px] text-ink-mute">
            按严重度排序 · 高风险 {interactions.filter((i) => i.severity === 'high').length} 条
          </span>
        </div>
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-surface-sunken text-[10.5px] text-ink-mute">
              <tr>
                <th className="px-3 py-2 font-medium">组合</th>
                <th className="px-3 py-2 font-medium">严重度</th>
                <th className="px-3 py-2 font-medium">为什么</th>
                <th className="px-3 py-2 font-medium">怎么办</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-surface-raised">
              {[...interactions]
                .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1))
                .map((rule) => (
                  <tr key={rule.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">
                      {drugName.get(rule.a) ?? rule.a}
                      <span className="px-1 text-ink-mute">+</span>
                      {drugName.get(rule.b) ?? rule.b}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={rule.severity === 'high' ? 'chip border-danger/40 text-danger' : 'chip border-warn/40 text-warn'}>
                        {rule.severity === 'high' ? '高风险' : '中风险'}
                      </span>
                    </td>
                    <td className="px-3 py-2 leading-relaxed text-ink-soft">{rule.mechanism}</td>
                    <td className="px-3 py-2 leading-relaxed text-ink-soft">{rule.action}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ================= 报警条件 ================= */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-2">
          <ShieldAlert size={13} className="text-ink-mute" />
          <h2 className="text-[13px] font-semibold text-ink">什么情况必须立刻就医</h2>
          <span className="text-[11px] text-ink-mute">
            急诊级 {emergency.length} 条 · 需尽快就诊 {urgent.length} 条
          </span>
        </div>
        <div className="grid gap-px border border-line bg-line md:grid-cols-2">
          <div className="bg-surface px-3 py-3">
            <h3 className="text-[11px] font-semibold text-danger">急诊级（打 120 / 立刻送医）</h3>
            <ul className="mt-2 space-y-2">
              {emergency.map((r) => (
                <li key={r.id} className="text-[11.5px] leading-relaxed">
                  <p className="font-medium text-ink">{r.title}</p>
                  <p className="text-ink-soft">
                    {r.action}
                    <span className="text-ink-mute"> · 转到{r.escalateTo}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-surface px-3 py-3">
            <h3 className="text-[11px] font-semibold text-warn">需尽快就诊</h3>
            <ul className="mt-2 space-y-2">
              {urgent.map((r) => (
                <li key={r.id} className="text-[11.5px] leading-relaxed">
                  <p className="font-medium text-ink">{r.title}</p>
                  <p className="text-ink-soft">
                    {r.action}
                    <span className="text-ink-mute"> · 转到{r.escalateTo}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ================= 依据检索 ================= */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-2">
          <BookOpen size={13} className="text-ink-mute" />
          <h2 className="text-[13px] font-semibold text-ink">查一条依据</h2>
          <span className="text-[11px] text-ink-mute">
            用口语也行，例如「吃了止痛药大便发黑」
          </span>
        </div>
        <RetrievalPlayground />
        <p className="text-[10.5px] leading-relaxed text-ink-mute">
          当前引擎：
          {llm.enabled ? `${llm.provider} · ${llm.model}` : '本地规则引擎（未配置外部模型，结果完全可复现）'}
          {' · '}索引构建于 {new Date(index.builtAt).toLocaleString('zh-CN', { hour12: false })}
          {' · '}全部检索在本机完成，不依赖外部服务
        </p>
      </section>

      {/* ================= 知识与来源清单 ================= */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[13px] font-semibold text-ink">知识来源清单</h2>
          <span className="text-[11px] text-ink-mute">{docList.length} 篇 · {stats.chunkCount} 段可检索</span>
        </div>
        <ul className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {docList.map((doc) => (
            <li key={doc.id} className="bg-surface px-3 py-2">
              <p className="text-[11.5px] font-medium leading-snug text-ink">{doc.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-ink-mute">
                <span>{doc.id}</span>
                <span>· {doc.sectionCount} 段</span>
              </p>
            </li>
          ))}
        </ul>
        <p className="text-[11px] leading-relaxed text-ink-mute">
          全部条目为公开指南与说明书的整理稿，随仓库以 Markdown 分发，可直接打开原文核对。
          演示数据不构成临床依据；实际用药调整须经执业医师确认。工程实现细节（数据流、检索算法、
          评测方法）见仓库内 <code className="font-mono">docs/技术文档.md</code>。
        </p>
      </section>
    </div>
  );
}
