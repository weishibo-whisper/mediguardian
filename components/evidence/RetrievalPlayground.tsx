'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KbSourceRecord, RetrievalMode } from '@/lib/types';

interface Hit {
  chunkId: string;
  docId: string;
  title: string;
  section: string;
  source: KbSourceRecord;
  score: number;
  scoreBreakdown: { bm25: number; vector: number; rrf: number; rerank: number };
  snippet: string;
}

/**
 * 检索实时演示
 * 任何访客都可以现场输入任意术语（如「低钠盐」「三个 30 秒」「三联打击」），
 * 直接看到双路召回得分与融合结果——把 RAG 从「看不见的中间层」变成可验证的黑板。
 */
export function RetrievalPlayground() {
  const [query, setQuery] = useState('华法林 牙龈出血 止痛药');
  const [hits, setHits] = useState<Hit[]>([]);
  const [mode, setMode] = useState<RetrievalMode>('hybrid');
  const [useSynonyms, setUseSynonyms] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => () => activeRequest.current?.abort(), []);

  const run = async (q?: string, nextMode = mode, nextUseSynonyms = useSynonyms) => {
    const text = (q ?? query).trim();
    if (!text) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/kb/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: text,
          topK: 5,
          mode: nextMode,
          useSynonyms: nextUseSynonyms,
        }),
        signal: controller.signal,
      });
      const data = (await res.json()) as { hits?: Hit[]; error?: string };
      if (data.error) throw new Error(data.error);
      if (requestId === requestSequence.current) setHits(data.hits ?? []);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (requestId === requestSequence.current) setError(e instanceof Error ? e.message : '检索失败');
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  };

  const samples = ['低钠盐 血钾', '三个 30 秒 跌倒', '三联打击 肌酐', '氯吡格雷 奥美拉唑'];

  return (
    <div className="space-y-2.5">
      <div className="flex flex-col gap-2 border-b border-line pb-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-fit rounded-md border border-line bg-surface-sunken p-0.5" role="group" aria-label="检索模式">
          {([
            ['hybrid', '混合'],
            ['bm25', '仅 BM25'],
            ['vector', '仅哈希向量'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                run(undefined, value, useSynonyms);
              }}
              className={cn(
                'min-h-8 rounded px-2.5 text-[11px] font-medium transition-colors',
                mode === value
                  ? 'bg-surface-raised text-ink shadow-sm'
                  : 'text-ink-mute hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="inline-flex min-h-8 items-center gap-2 text-[11px] text-ink-soft">
          <input
            type="checkbox"
            checked={useSynonyms}
            disabled={mode === 'vector'}
            onChange={(event) => {
              const checked = event.target.checked;
              setUseSynonyms(checked);
              run(undefined, mode, checked);
            }}
            className="h-6 w-6 accent-[rgb(var(--accent-solid))]"
          />
          领域同义词扩展
        </label>
      </div>
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-mute" aria-hidden="true" />
          <label htmlFor="retrieval-query" className="sr-only">检索医学依据</label>
          <input
            id="retrieval-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            className="w-full rounded-xl border border-line bg-surface py-2 pl-8 pr-3 text-xs text-ink placeholder:text-ink-mute focus:border-brand-500 focus:outline-none"
            placeholder="输入任意医学/生活化表述，试试「我妈牙龈出血」"
          />
        </div>
        <button type="button" onClick={() => run()} className="btn-primary !px-3 !py-2" disabled={loading}>
          {loading ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
          {loading ? '检索中' : '检索'}
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

      {error ? <p role="alert" className="rounded-lg bg-danger/10 px-2 py-1.5 text-[11px] text-danger">{error}，请检查服务后重试。</p> : null}

      <p role="status" aria-live="polite" className="sr-only">
        {loading ? '正在检索' : hits.length > 0 ? `检索完成，共 ${hits.length} 条结果` : ''}
      </p>

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
            {hit.source.references.length > 0 ? (
              <p className="mt-1 text-[9px] leading-relaxed text-warn">
                候选来源：{hit.source.references.map((ref, index) => (
                  <span key={ref.doi}>
                    {index > 0 ? '；' : ''}
                    <a href={ref.url} target="_blank" rel="noreferrer" className="inline-flex min-h-6 items-center underline underline-offset-2">
                      {ref.organization} {ref.year}
                    </a>
                  </span>
                ))}
                {' · 内容映射待复核'}
              </p>
            ) : (
              <p className="mt-1 text-[9px] text-warn">未登记外部来源</p>
            )}
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
      <p className="text-[10px] leading-relaxed text-ink-mute">
        模式切换用于消融对照：完整产品默认使用混合检索；“仅哈希向量”展示的是确定性词形投影基线，不是预训练语义模型。
      </p>
    </div>
  );
}
