'use client';

import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Hit {
  chunkId: string;
  docId: string;
  title: string;
  section: string;
  score: number;
  scoreBreakdown: { bm25: number; vector: number; rrf: number; rerank: number };
  snippet: string;
}

/**
 * 检索实时演示
 * 评委可以现场输入任意术语（如「低钠盐」「三个 30 秒」「三联打击」），
 * 直接看到双路召回得分与融合结果——把 RAG 从「看不见的中间层」变成可验证的黑板。
 */
export function RetrievalPlayground() {
  const [query, setQuery] = useState('华法林 牙龈出血 止痛药');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (q?: string) => {
    const text = (q ?? query).trim();
    if (!text) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/kb/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, topK: 5 }),
      });
      const data = (await res.json()) as { hits?: Hit[]; error?: string };
      if (data.error) throw new Error(data.error);
      setHits(data.hits ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '检索失败');
    } finally {
      setLoading(false);
    }
  };

  const samples = ['低钠盐 血钾', '三个 30 秒 跌倒', '三联打击 肌酐', '氯吡格雷 奥美拉唑'];

  return (
    <div className="space-y-2.5">
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-mute" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            className="w-full rounded-xl border border-line bg-surface py-2 pl-8 pr-3 text-xs text-ink placeholder:text-ink-mute focus:border-brand-500 focus:outline-none"
            placeholder="输入任意医学/生活化表述，试试「我妈牙龈出血」"
          />
        </div>
        <button type="button" onClick={() => run()} className="btn-primary !px-3 !py-2" disabled={loading}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : '检索'}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {samples.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setQuery(s);
              run(s);
            }}
            className="chip border-line bg-surface text-ink-mute transition hover:border-brand-200 hover:text-accent-text"
          >
            {s}
          </button>
        ))}
      </div>

      {error ? <p className="rounded-lg bg-danger/10 px-2 py-1.5 text-[11px] text-danger">{error}</p> : null}

      <ul className="space-y-1.5">
        {hits.map((hit, i) => (
          <li key={hit.chunkId} className="rounded-xl border border-line bg-surface px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <span className="grid h-4 w-4 place-items-center rounded bg-accent-solid font-mono text-[9px] font-bold text-white">
                {i + 1}
              </span>
              <span className="truncate text-[11px] font-medium text-ink">{hit.title}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-accent-text">
                {(hit.score * 100).toFixed(0)}%
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-ink-mute">
              {hit.section} · <code className="font-mono">{hit.chunkId}</code>
            </p>
            <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-ink-soft">{hit.snippet}</p>
            <div className="mt-1.5 grid grid-cols-4 gap-1">
              {(
                [
                  ['BM25', hit.scoreBreakdown.bm25],
                  ['向量', hit.scoreBreakdown.vector],
                  ['RRF', hit.scoreBreakdown.rrf],
                  ['重排', hit.scoreBreakdown.rerank],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <div className="h-1 overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className={cn('h-full rounded-full bg-brand-500')}
                      style={{ width: `${Math.max(3, Math.min(100, value * 100))}%` }}
                    />
                  </div>
                  <p className="mt-0.5 flex justify-between text-[8px] text-ink-mute">
                    <span>{label}</span>
                    <span className="font-mono">{value.toFixed(2)}</span>
                  </p>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {!loading && hits.length === 0 ? (
        <p className="text-[11px] text-ink-mute">输入查询后回车，这里会显示命中的证据块与四项打分明细。</p>
      ) : null}
    </div>
  );
}
