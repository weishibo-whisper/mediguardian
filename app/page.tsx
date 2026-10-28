import Link from 'next/link';
import {
  ArrowRight,
  BrainCircuit,
  Camera,
  GitBranch,
  Layers,
  Mic,
  ShieldCheck,
  Sparkles,
  Timer,
  Users,
  Workflow,
} from 'lucide-react';
import { getKbStats } from '@/lib/rag';
import { TOOL_NAMES } from '@/lib/tools';
import { Badge } from '@/components/ui/Bits';

export const dynamic = 'force-dynamic';

/**
 * 落地页
 * 叙事结构：真实痛点 → 我们怎么做 → 为什么难被替代 → 技术底座 → 评分点自检
 * 全部为静态文案 + 少量服务端统计，首屏无阻塞请求。
 */
export default async function HomePage() {
  const stats = await getKbStats();

  const pains = [
    {
      title: '药越吃越多，没人统账',
      desc: '一位 78 岁老人平均同时服用 6–8 种药，处方药、子女买的保健品、邻居给的「偏方」混在一个塑料袋里。',
      tone: 'danger' as const,
    },
    {
      title: '风险藏在组合里，不藏在说明书里',
      desc: '华法林 + 阿司匹林 + 布洛芬，三种「常用药」叠在一起，消化道出血风险升高 2–3 倍——但每一种单独看都很安全。',
      tone: 'warn' as const,
    },
    {
      title: '基层没有临床药师',
      desc: '村卫生室通常只有 1–2 名村医，既要看病又要随访；县级医院药师难以覆盖到村，用药重整几乎空白。',
      tone: 'neutral' as const,
    },
  ];

  const pillars = [
    {
      icon: Camera,
      title: '多模态采集',
      desc: '药盒拍照识别、语音问药、处方文本解析，把老人手里的「一袋药」变成结构化清单。',
    },
    {
      icon: Workflow,
      title: 'Agent 编排',
      desc: '7 步规划 + 8 个工具，自主决定调哪些工具、按什么顺序调，并在证据不足时主动补检索。',
    },
    {
      icon: Layers,
      title: '混合检索取证',
      desc: 'BM25 稀疏召回 + 本地哈希向量稠密召回 + RRF 融合 + 术语重排，每条结论都能点到原文。',
    },
    {
      icon: ShieldCheck,
      title: '全链路守门',
      desc: '红旗症状强制转诊、PII 脱敏、诊断断言拦截、无引用剂量拦截、JSONL 审计可回放。',
    },
  ];

  const scores = [
    ['AI 技术深度 35%', 'LLM 双引擎 + 7 步 Agent 工作流 + 混合 RAG + 多模态 + MCP + 安全守门', 'brand'],
    ['创新性 25%', '冲突图谱可视化 + 可回溯决策轨迹 + 适老化语音/大字交互', 'brand'],
    ['前端工程质量 10%', 'Next.js 15 App Router + TS strict + Zustand + 自研 SSE 协议 + 零图表库 SVG', 'ok'],
    ['实用性 10%', '面向村医/家属的真实工作流，输出可直接执行的用药清单与转诊单', 'ok'],
    ['用户体验 10%', '三栏并行、流式渲染、思考状态可视化、错误边界与降级路径', 'ok'],
    ['社会价值 10%', '基层用药安全 → 减少可预防的出血/低血糖/跌倒事件', 'ok'],
  ] as const;

  return (
    <div className="space-y-14 pb-6">
      {/* ================= Hero：文书头，不是营销大屏 ================= */}
      <section className="border-b border-line pb-9">
        <p className="font-mono text-[10.5px] leading-5 text-ink-mute">
          AI Native 用药安全 Agent · Next.js 15 · TypeScript · RAG · MCP · 离线可运行
        </p>

        <h1 className="mt-4 max-w-3xl text-[2rem] font-semibold leading-[1.15] tracking-tight text-ink md:text-[2.6rem]">
          让每一位老人都能用对药
        </h1>

        <p className="mt-4 max-w-2xl text-[13.5px] leading-[1.75] text-ink-soft md:text-sm">
          守药人是一个面向基层医疗的 AI Native 用药安全 Agent。它把老人手里的一袋药变成结构化清单，
          自主调用工具做相互作用核查、按肾功能与年龄分层、检索循证依据，
          最后输出一份<strong className="font-medium text-ink">能直接执行</strong>的用药重整与随访方案——
          并且每一步判断都摆在桌面上，可点开、可回溯、可审计。
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <Link href="/console" className="btn-primary !px-3.5 !py-2">
            进入智能诊台 <ArrowRight size={14} />
          </Link>
          <Link href="/arch" className="btn-ghost !px-3.5 !py-2">
            <GitBranch size={13} /> 看技术架构
          </Link>
          <span className="text-[11px] text-ink-mute">
            无需配置 API Key，内置规则引擎可完整演示
          </span>
        </div>

        {/* 数字台账：1px 细线分栏，等宽数字，像一张表格的头 */}
        <dl className="mt-9 grid grid-cols-2 gap-px border-y border-line bg-line sm:grid-cols-4">
          {[
            ['知识库文档', `${stats.docCount} 篇`],
            ['语义分块', `${stats.chunkCount} 块`],
            ['Agent 工具', `${TOOL_NAMES.length} 个`],
            ['演示患者', '4 位'],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface px-3 py-2.5">
              <dt className="text-[10.5px] text-ink-mute">{label}</dt>
              <dd className="tnum mt-0.5 font-mono text-[15px] font-semibold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ================= 痛点 ================= */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-ink">为什么是「用药安全」</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-soft">
              中国 60 岁及以上人口已超过 3 亿，基层随访名单中「多重用药」是常态。
              可预防的用药伤害（消化道出血、低血糖、跌倒、急性肾损伤）大多不是某个药错了，
              而是<strong className="font-medium text-ink">组合错了、剂量没跟着肾功能走、疼痛时自己加了药</strong>。
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {pains.map((p) => (
            <article key={p.title} className="card p-4">
              <Badge tone={p.tone}>真实场景</Badge>
              <h3 className="mt-2 text-sm font-semibold text-ink">{p.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{p.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ================= 能力四柱 ================= */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight text-ink">它是怎么做到的</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {pillars.map((p) => {
            const Icon = p.icon;
            return (
              <article key={p.title} className="card group p-4 transition-colors hover:border-ink-mute">
                <span className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface text-ink-soft transition-colors group-hover:border-accent-solid group-hover:text-accent-solid">
                  <Icon size={17} />
                </span>
                <h3 className="mt-2.5 text-sm font-semibold text-ink">{p.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-ink-soft">{p.desc}</p>
              </article>
            );
          })}
        </div>
      </section>

      {/* ================= 交互范式 ================= */}
      <section className="grid gap-3 lg:grid-cols-[1.15fr_1fr]">
        <div className="card p-5">
          <Badge tone="brand">交互创新</Badge>
          <h2 className="mt-2 text-lg font-semibold tracking-tight text-ink">
            三栏并行：把 AI 的「思考」变成可观察对象
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-ink-soft">
            绝大多数 AI 医疗产品只给一个聊天框：用户看到结论，看不到依据。
            守药人把界面拆成三块，同时呈现「在吃什么 / 说了什么 / 凭什么」：
          </p>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-ink-soft">
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 bg-ink-mute" />
              <span>
                <strong className="font-medium text-ink">冲突图谱</strong>：N 种药排成环形，高风险组合画成流动红色虚线，点击即看机制——把抽象的「相互作用」变成一眼可见的结构。
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 bg-ink-mute" />
              <span>
                <strong className="font-medium text-ink">决策轨迹</strong>：规划 → 工具调用 → 检索 → 生成，每步带耗时与参数，可跳转
                <code className="mx-1 rounded bg-surface-sunken px-1 font-mono text-[10px]">/trace/[runId]</code>
                完整回放。
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 bg-ink-mute" />
              <span>
                <strong className="font-medium text-ink">证据徽标</strong>：回答里的 [1][2] 可点击，直接跳到原文与四项打分明细，幻觉无处可藏。
              </span>
            </li>
          </ul>
        </div>

        <div className="card space-y-2.5 p-5">
          <Badge tone="warn">适老化不是把字放大</Badge>
          <h3 className="text-sm font-semibold text-ink">为「不会打字、看不清」的用户重做输入输出</h3>
          <div className="space-y-2 text-xs leading-relaxed text-ink-soft">
            <p className="flex items-start gap-2">
              <Mic size={13} className="mt-0.5 shrink-0 text-ink-mute" />
              语音问药：Web Speech API 直接把老人说的话变成检索式，播报用 0.92 倍速的中文 TTS。
            </p>
            <p className="flex items-start gap-2">
              <Camera size={13} className="mt-0.5 shrink-0 text-ink-mute" />
              药盒拍照：视觉模型识别后强制做「名称归一化」，把「拜阿司匹灵」映射回 drugId 才能参与风险计算。
            </p>
            <p className="flex items-start gap-2">
              <Users size={13} className="mt-0.5 shrink-0 text-ink-mute" />
              家属协同：一键生成可直接粘贴到微信的口语化通知，明确「停药 / 复查 / 何时打 120」。
            </p>
            <p className="flex items-start gap-2">
              <Timer size={13} className="mt-0.5 shrink-0 text-ink-mute" />
              大字模式 + 深色主题：整站 rem 缩放与主题令牌，投影演示与背光诊室都能用。
            </p>
          </div>
        </div>
      </section>

      {/* ================= 评分点自检 ================= */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink">对照评审维度逐项落地</h2>
          <p className="mt-1 text-sm text-ink-soft">
            不是「做完再找亮点」，而是从评分表倒推功能——每一项都有对应的可演示入口。
          </p>
        </div>
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-sunken text-[10.5px] text-ink-mute">
              <tr>
                <th className="px-4 py-2.5 font-medium">评审维度</th>
                <th className="px-4 py-2.5 font-medium">本作品的落点</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-surface-raised">
              {scores.map(([dim, impl, tone]) => (
                <tr key={dim} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Badge tone={tone}>{dim}</Badge>
                  </td>
                  <td className="px-4 py-2.5 leading-relaxed text-ink-soft">{impl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ================= 技术底座 ================= */}
      <section className="card flex flex-col items-start gap-3 p-5 md:flex-row md:items-center">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-surface text-ink">
          <BrainCircuit size={19} />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-ink">技术底座</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
            Next.js 15 App Router · React 19 · TypeScript strict · Tailwind CSS · Zustand · 自研 SSE Agent 协议 ·
            混合检索（BM25 + 哈希向量 + RRF + 重排）· MCP Server · Web Speech API · OpenAI 兼容 Provider（DeepSeek / 智谱 / 通义 / GPT）
          </p>
        </div>
        <Link href="/console" className="btn-primary shrink-0">
          现在试一次 <ArrowRight size={14} />
        </Link>
      </section>
    </div>
  );
}
