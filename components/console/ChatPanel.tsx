'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { PatientBundle } from '@/lib/types';
import { useConsoleStore } from '@/lib/store/useConsoleStore';
import { MiniMarkdown } from '@/components/MiniMarkdown';
import { Badge } from '@/components/ui/Bits';
import { confidenceMeta, cn, fmtMs } from '@/lib/utils';
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  Loader2,
  Mic,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Volume2,
} from 'lucide-react';

/** 语音识别的最小类型声明（Web Speech API 尚未进入 TS 标准库） */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const QUICK_PROMPTS = [
  '最近牙龈出血、大便发黑，是不是止痛药引起的？',
  '这些药一起吃安全吗？我把药盒都带来了',
  '她总忘记吃药，能不能简化一下方案？',
  '这个月的检验结果需要复查哪些项目？',
];

export function ChatPanel({
  bundle,
  stats,
}: {
  bundle: PatientBundle;
  stats: { docCount: number; chunkCount: number };
}) {
  const { messages, live, ask, reset } = useConsoleStore();
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [vision, setVision] = useState<{ items: Array<{ name: string; matchedName: string | null; confidence: number }>; provider: string; note?: string } | null>(null);
  const [visionLoading, setVisionLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, live.running]);

  /* ---------------- 发送 ---------------- */
  const submit = async () => {
    const text = input.trim();
    if (!text || live.running) return;
    setInput('');
    await ask(text);
  };

  /* ---------------- 语音输入 ---------------- */
  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setInput((prev) => prev || '（当前浏览器不支持语音识别，请使用 Chrome 或 Edge）');
      return;
    }
    const recognition = new Ctor();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let text = '';
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      setInput(text);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  };

  /* ---------------- 药盒拍照识别 ---------------- */
  const onPickImage = async (file: File) => {
    if (file.size > 4 * 1024 * 1024) {
      setVision({ items: [], provider: 'error', note: '图片超过 4MB，请压缩后重试' });
      return;
    }
    setVisionLoading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, hint: `患者：${bundle.patient.name}，${bundle.patient.age} 岁` }),
      });
      const data = (await res.json()) as {
        items?: Array<{ name: string; matchedName: string | null; confidence: number }>;
        provider?: string;
        note?: string;
        error?: string;
      };
      setVision({
        items: data.items ?? [],
        provider: data.provider ?? 'unknown',
        note: data.error ?? data.note,
      });
    } catch {
      setVision({ items: [], provider: 'error', note: '识别请求失败，请重试' });
    } finally {
      setVisionLoading(false);
    }
  };

  const speak = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const clean = text
      .replace(/[#>*_`]/g, '')
      .replace(/\[\d+\]/g, '')
      .replace(/\n+/g, '。')
      .slice(0, 400);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.92;
    window.speechSynthesis.speak(utterance);
  };

  const forceReferral = live.safety?.forceReferral;

  return (
    <section className="card flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center gap-2 border-b border-line/80 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink">
            用药核对 · {bundle.patient.name}
          </h2>
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-mute">
            <span>{bundle.meds.length} 种在用药</span>
            <span className="text-line">|</span>
            <span>
              知识库 {stats.docCount} 篇 / {stats.chunkCount} 块
            </span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Badge tone={live.mode === 'llm' ? 'brand' : 'neutral'}>
            <Sparkles size={10} />
            {live.mode === 'llm' ? '大模型引擎' : '规则引擎'}
          </Badge>
          <button type="button" onClick={reset} className="btn-ghost !px-2 !py-1.5" title="清空对话">
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      {/* 危险信号横幅 */}
      {forceReferral ? (
        <div className="animate-fade-in border-b border-danger/20 bg-danger/10 px-4 py-2 text-[12px] leading-relaxed text-danger">
          <p className="flex items-start gap-1.5 font-medium">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            检测到危险信号：本回答以「立即就医」为第一优先级，用药建议仅作参考
          </p>
        </div>
      ) : null}

      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-lg py-6 text-center">
            <h3 className="text-sm font-semibold text-ink">问一句，Agent 会跑完整条用药安全流水线</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-mute">
              7 步规划 · 8 个工具 · 混合检索取证 · 输出守门。
              右侧可以实时看到它调用了哪些工具、命中了哪些证据。
            </p>
            <div className="mt-4 space-y-1.5 text-left">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => ask(p)}
                  className="flex w-full items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-left text-xs text-ink-soft transition-colors hover:border-ink-mute hover:text-ink"
                >
                  <ArrowRight size={12} className="shrink-0 text-ink-mute" />
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m) => {
          const isUser = m.role === 'user';
          const conf = m.confidence !== undefined ? confidenceMeta(m.confidence) : null;
          return (
            <div key={m.id} className={cn('animate-fade-up border-b border-line', isUser && 'bg-surface-sunken')}>
              {isUser ? (
                <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-2 px-4 py-2.5">
                  <span className="pt-0.5 font-mono text-[10px] text-ink-mute">问</span>
                  <p className="text-[13px] leading-relaxed text-ink">{m.content}</p>
                </div>
              ) : (
                <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-2 px-4 py-3">
                  <span className="pt-0.5 font-mono text-[10px] text-ink-mute">守药人</span>
                  <div className="min-w-0">
                  {m.content ? (
                    <MiniMarkdown
                      text={m.content}
                      streaming={m.streaming}
                      onCite={(i) => {
                        const hit = live.retrievals.flatMap((r) => r.hits)[i - 1];
                        if (hit) useConsoleStore.getState().selectChunk(hit.chunkId);
                      }}
                    />
                  ) : (
                    <p className="flex items-center gap-2 text-xs text-ink-mute">
                      <Loader2 size={13} className="animate-spin text-ink-mute" />
                      正在规划与取证…
                    </p>
                  )}

                  {!m.streaming && m.content ? (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-[10px] text-ink-mute">
                      {m.citations && m.citations.length > 0 ? (
                        <span>引用证据 {m.citations.length} 条</span>
                      ) : (
                        <span className="text-warn">无引用（保守回答）</span>
                      )}
                      {conf ? <span className={conf.tone}>· {conf.label}</span> : null}
                      {m.runId ? (
                        <Link
                          href={`/trace/${m.runId}`}
                          className="ml-auto inline-flex min-h-6 items-center gap-1 border-b border-line px-0.5 transition-colors hover:border-accent-solid hover:text-accent-text"
                        >
                          决策轨迹 <ArrowRight size={9} />
                        </Link>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => speak(m.content)}
                        className="inline-flex min-h-6 items-center gap-1 border-b border-line px-0.5 transition-colors hover:border-accent-solid hover:text-accent-text"
                        title="朗读（适老化）"
                      >
                        <Volume2 size={9} /> 朗读
                      </button>
                    </div>
                  ) : null}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* 思考中提示 */}
        {live.running ? (
          <div className="flex items-center gap-2 text-[11px] text-ink-mute">
            <Loader2 size={12} className="animate-spin text-ink-mute" />
            <span>
              {live.steps.find((s) => s.status === 'running')?.title ?? '正在推理'}
              <span className="ml-1 font-mono text-[10px]">
                {live.toolCalls.length > 0 ? `· 已调用 ${live.toolCalls.length} 个工具` : ''}
              </span>
            </span>
          </div>
        ) : null}

        {live.elapsedMs ? (
          <p className="text-center text-[10px] text-ink-mute">
            本次运行耗时 {fmtMs(live.elapsedMs)} · 可在右侧「轨迹」查看完整链路
          </p>
        ) : null}

        <div ref={bottomRef} />
      </div>

      {/* 拍照识别结果 */}
      {vision ? (
        <div className="animate-fade-up border-t border-line bg-surface-sunken px-4 py-2.5 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-medium text-ink">
              药盒识别 · {vision.provider === 'mock' ? '演示模式' : vision.provider}
            </span>
            <button type="button" onClick={() => setVision(null)} className="text-ink-mute hover:text-ink">
              关闭
            </button>
          </div>
          {vision.items.length > 0 ? (
            <>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {vision.items.map((item, i) => (
                  <li key={i} className="chip border-line bg-surface">
                    {item.name}
                    {item.matchedName ? (
                      <span className="text-ok">→ {item.matchedName}</span>
                    ) : (
                      <span className="text-warn">未匹配</span>
                    )}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  const names = vision.items.map((i) => i.matchedName ?? i.name).join('、');
                  ask(`我刚拍了药盒，识别到这些药：${names}。请把它们一起纳入相互作用核对。`);
                  setVision(null);
                }}
                className="mt-1.5 text-accent-text underline-offset-2 hover:underline"
              >
                把它们加入本次核对 →
              </button>
            </>
          ) : null}
          {vision.note ? <p className="mt-1 text-ink-mute">{vision.note}</p> : null}
        </div>
      ) : null}

      {/* 输入区 */}
      <div className="border-t border-line/80 bg-surface-raised px-3 py-2.5">
        <div className="flex items-end gap-1.5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
            }}
            rows={2}
            placeholder="描述症状、疑问，或粘贴检验结果…（Ctrl/⌘ + Enter 发送）"
            className="max-h-32 min-h-[2.6rem] flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-ink-mute focus:border-brand-500 focus:outline-none"
            aria-label="输入问题"
          />
          <div className="flex shrink-0 items-center gap-1 pb-0.5">
            <button
              type="button"
              onClick={toggleVoice}
              className={cn('btn-ghost !px-2', listening && 'border-danger/30 bg-danger/10 text-danger')}
              title={listening ? '停止语音输入' : '语音输入'}
              aria-pressed={listening}
            >
              {listening ? <Square size={14} /> : <Mic size={14} />}
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="btn-ghost !px-2"
              title="拍摄药盒 / 上传处方"
              disabled={visionLoading}
            >
              {visionLoading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onPickImage(file);
                e.target.value = '';
              }}
            />
            <button type="button" onClick={submit} disabled={!input.trim() || live.running} className="btn-primary !px-3">
              {live.running ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              <span className="hidden sm:inline">发送</span>
            </button>
          </div>
        </div>
        <p className="mt-1.5 flex items-center gap-1 px-0.5 text-[10px] text-ink-mute">
          <AlertTriangle size={9} /> 输出仅供专业参考，不构成诊断或处方；危急情况请立即拨打 120
        </p>
      </div>
    </section>
  );
}
