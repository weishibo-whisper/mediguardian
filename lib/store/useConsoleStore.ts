'use client';

import { create } from 'zustand';
import type {
  ChatMessage,
  KbHit,
  PlanStep,
  SafetyReport,
  SseEvent,
  ToolCallRecord,
  VerificationReport,
} from '@/lib/types';
import { shortId } from '@/lib/utils';

/**
 * 智能诊台状态机（Zustand）
 * ------------------------------------------------------------------
 * 只放「一次会话」需要的状态，患者主数据由服务端组件下发，避免客户端重复请求。
 * 设计要点：
 *  - SSE 事件用 reducer 式 applyEvent 统一消费，组件不直接碰 fetch 细节；
 *  - live 与 messages 分离：live 是「正在进行中的思考过程」，完成后仍保留供回看；
 *  - 流式 token 直接追加到最后一条 assistant 消息，避免全量重渲染。
 */

export type InsightTab = 'trace' | 'evidence' | 'graph';

export interface LiveState {
  running: boolean;
  runId?: string;
  mode?: string;
  steps: PlanStep[];
  toolCalls: ToolCallRecord[];
  retrievals: Array<{ query: string; hits: KbHit[] }>;
  safety?: SafetyReport;
  citations: string[];
  confidence?: number;
  verification?: VerificationReport;
  notes: Array<{ text: string; level?: 'info' | 'warn' }>;
  elapsedMs?: number;
  error?: string;
}

const initialLive: LiveState = {
  running: false,
  steps: [],
  toolCalls: [],
  retrievals: [],
  citations: [],
  notes: [],
};

interface ConsoleState {
  patientId: string;
  messages: ChatMessage[];
  live: LiveState;
  activeTab: InsightTab;
  selectedChunkId: string | null;
  selectPatient: (id: string) => void;
  setTab: (tab: InsightTab) => void;
  selectChunk: (id: string | null) => void;
  ask: (question: string) => Promise<void>;
  reset: () => void;
}

export const useConsoleStore = create<ConsoleState>((set, get) => ({
  patientId: '',
  messages: [],
  live: initialLive,
  activeTab: 'trace',
  selectedChunkId: null,

  selectPatient: (id) => set({ patientId: id, messages: [], live: initialLive, selectedChunkId: null }),
  setTab: (tab) => set({ activeTab: tab }),
  selectChunk: (id) => set({ selectedChunkId: id, activeTab: 'evidence' }),
  reset: () => set({ messages: [], live: initialLive, selectedChunkId: null }),

  ask: async (question) => {
    const state = get();
    const text = question.trim();
    if (!text || !state.patientId || state.live.running) return;

    const userMsg: ChatMessage = { id: shortId('m'), role: 'user', content: text };
    const botId = shortId('m');
    const botMsg: ChatMessage = {
      id: botId,
      role: 'assistant',
      content: '',
      streaming: true,
      citations: [],
    };

    set((s) => ({
      messages: [...s.messages, userMsg, botMsg],
      live: { ...initialLive, running: true },
      activeTab: s.activeTab === 'graph' ? 'trace' : s.activeTab,
    }));

    /** 统一的 SSE 事件消费入口 */
    const applyEvent = (event: SseEvent) => {
      switch (event.type) {
        case 'run_start':
          set((s) => ({ live: { ...s.live, running: true, runId: event.runId, mode: event.mode } }));
          break;
        case 'plan':
          set((s) => ({ live: { ...s.live, steps: event.steps } }));
          break;
        case 'step':
          set((s) => ({
            live: {
              ...s.live,
              steps: s.live.steps.map((step) =>
                step.id === event.stepId ? { ...step, status: event.status, detail: event.detail ?? step.detail } : step,
              ),
            },
          }));
          break;
        case 'tool_call':
          set((s) => ({
            live: {
              ...s.live,
              toolCalls: [
                ...s.live.toolCalls,
                { id: event.id, name: event.name, args: event.args, status: 'ok', ms: 0, summary: '执行中…' },
              ],
            },
          }));
          break;
        case 'tool_result':
          set((s) => ({
            live: {
              ...s.live,
              toolCalls: s.live.toolCalls.map((call) =>
                call.id === event.id
                  ? { ...call, status: event.status, ms: event.ms, summary: event.summary, data: event.data }
                  : call,
              ),
            },
          }));
          break;
        case 'retrieval':
          set((s) => ({ live: { ...s.live, retrievals: [...s.live.retrievals, { query: event.query, hits: event.hits }] } }));
          break;
        case 'token':
          set((s) => ({
            messages: s.messages.map((m) => (m.id === botId ? { ...m, content: m.content + event.text } : m)),
          }));
          break;
        case 'answer_final':
          set((s) => ({
            messages: s.messages.map((m) => (m.id === botId ? { ...m, content: event.text } : m)),
          }));
          break;
        case 'safety':
          set((s) => ({
            live: {
              ...s.live,
              safety: {
                level: event.level,
                flags: event.flags,
                forceReferral: event.forceReferral,
                requireDisclaimer: true,
                sanitizedText: '',
              },
            },
          }));
          break;
        case 'answer_meta':
          set((s) => ({
            live: {
              ...s.live,
              citations: event.citations,
              confidence: event.confidence,
              verification: event.verification,
            },
            messages: s.messages.map((m) =>
              m.id === botId
                ? {
                    ...m,
                    citations: event.citations,
                    confidence: event.confidence,
                    verification: event.verification,
                  }
                : m,
            ),
          }));
          break;
        case 'note':
          set((s) => ({ live: { ...s.live, notes: [...s.live.notes, { text: event.text, level: event.level }] } }));
          break;
        case 'done':
          set((s) => ({
            live: { ...s.live, running: false, elapsedMs: event.durationMs, runId: event.runId },
            messages: s.messages.map((m) => (m.id === botId ? { ...m, streaming: false, runId: event.runId } : m)),
          }));
          break;
        case 'error':
          set((s) => ({
            live: { ...s.live, running: false, error: event.message },
            messages: s.messages.map((m) =>
              m.id === botId && !m.content
                ? { ...m, content: `**运行失败**：${event.message}`, streaming: false }
                : m,
            ),
          }));
          break;
        default:
          break;
      }
    };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: state.patientId,
          question: text,
          history: state.messages.slice(-6).map((message) => ({
            role: message.role,
            content: message.content.slice(0, 2000),
          })),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            applyEvent(JSON.parse(payload) as SseEvent);
          } catch {
            /* 忽略心跳等非 JSON 帧 */
          }
        }
      }
    } catch (error) {
      set((s) => ({
        live: {
          ...s.live,
          running: false,
          error: error instanceof Error ? error.message : '网络异常',
        },
        messages: s.messages.map((m) =>
          m.id === botId
            ? { ...m, streaming: false, content: m.content || '**网络异常**：请检查服务是否运行后重试。' }
            : m,
        ),
      }));
    } finally {
      set((s) => ({
        live: { ...s.live, running: false },
        messages: s.messages.map((m) => (m.id === botId ? { ...m, streaming: false } : m)),
      }));
    }
  },
}));
