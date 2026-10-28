import type { Metadata } from 'next';
import { getKbStats } from '@/lib/rag';
import { toolCatalog } from '@/lib/tools';
import { RetrievalPlayground } from '@/components/arch/RetrievalPlayground';
import { Badge, SectionTitle, Stat } from '@/components/ui/Bits';
import { getLlmConfig } from '@/lib/llm/provider';
import { ArrowRight, Boxes, Cpu, Database, Radio, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = { title: '技术架构 · 守药人 MediGuardian' };
export const dynamic = 'force-dynamic';

/**
 * 架构说明页
 * 面向评委：一页讲清「数据怎么流动、每一步为什么这么选、可以怎么验证」。
 * 所有数字（文档数/分块数/工具数）都是服务端实时统计，不是写死的文案。
 */
export default async function ArchPage() {
  const [stats, tools] = await Promise.all([getKbStats(), Promise.resolve(toolCatalog())]);
  const llm = getLlmConfig();

  const pipeline = [
    { title: '输入安全审查', desc: '红旗症状 + PII 脱敏', icon: ShieldCheck },
    { title: '规划', desc: '规则引擎 / LLM 自主规划', icon: Cpu },
    { title: '工具编排', desc: '8 工具按依赖执行', icon: Boxes },
    { title: '混合检索', desc: 'BM25 + 向量 + RRF', icon: Database },
    { title: '证据锚定', desc: '高风险发现定向取证', icon: Radio },
    { title: '生成', desc: '流式 + 引用约束', icon: Cpu },
    { title: '输出守门', desc: '断言/剂量/绝对化', icon: ShieldCheck },
  ];

  return (
    <div className="space-y-6 pb-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">技术架构</Badge>
          <Badge tone={llm.enabled ? 'ok' : 'warn'}>
            当前引擎：{llm.enabled ? `${llm.provider} / ${llm.model}` : '本地规则引擎（未配置 API Key）'}
          </Badge>
          <Badge>知识库 {stats.docCount} 篇 / {stats.chunkCount} 块 / {stats.termCount} 词项</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">一次提问，七个阶段，全部可观察</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
          设计原则只有一条：<strong className="font-medium text-ink">凡是对患者有影响的判断，都必须留下可验证的痕迹</strong>。
          因此整条链路上的每一步都是显式事件（SSE），既驱动前端可视化，也写入审计日志。
        </p>
      </header>

      {/* 流水线 */}
      <section className="card p-4">
        <SectionTitle title="Agent 执行流水线" desc="每个阶段都产生结构化事件：plan / step / tool_call / retrieval / token / safety" />
        <div className="mt-3 flex flex-wrap items-stretch gap-1.5">
          {pipeline.map((stage, i) => {
            const Icon = stage.icon;
            return (
              <div key={stage.title} className="flex flex-1 items-center gap-1.5">
                <div className="min-w-[104px] flex-1 rounded-xl border border-line bg-surface px-2.5 py-2">
                  <span className="flex items-center gap-1 text-[11px] font-medium text-ink">
                    <Icon size={11} className="text-brand-600" />
                    {stage.title}
                  </span>
                  <p className="mt-0.5 text-[10px] leading-snug text-ink-mute">{stage.desc}</p>
                </div>
                {i < pipeline.length - 1 ? <ArrowRight size={12} className="shrink-0 text-line" /> : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* 指标 */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="知识库文档" value={`${stats.docCount}`} hint={`平均分块长度 ${stats.avgChunkLen} 字`} />
        <Stat label="语义分块" value={`${stats.chunkCount}`} hint={`词项 ${stats.termCount} 个`} />
        <Stat label="Agent 工具" value={`${tools.length}`} hint="MCP 暴露同一套实现" />
        <Stat label="检索维度" value="384" hint="本地哈希向量（零网络依赖）" />
      </section>

      {/* 双栏：RAG + 工具 */}
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="card space-y-3 p-4">
          <SectionTitle
            title="混合检索（RAG）"
            desc="BM25 稀疏 + 哈希向量稠密 → RRF 融合 → 术语重排"
          />
          <ul className="space-y-1.5 text-[11px] leading-relaxed text-ink-soft">
            <li>
              <strong className="text-ink">为什么不用向量库：</strong>
              百级分块、内存检索 &lt; 5ms，引入 Milvus/pgvector 只会增加部署失败面；
              换成真实 embedding 时只需替换 <code className="rounded bg-surface-sunken px-1 font-mono text-[10px]">embed()</code>。
            </li>
            <li>
              <strong className="text-ink">为什么加 RRF：</strong>
              单路打分尺度不可比（BM25 无上界），取倒数排名融合可显著压低「某一路异常高分」的支配。
            </li>
            <li>
              <strong className="text-ink">为什么加术语重排：</strong>
              医疗检索里「标题命中术语」比语义漂移更可信，命中给 0.05/词、上限 0.2 的加分。
            </li>
            <li>
              <strong className="text-ink">幻觉守卫：</strong>
              回答中的 [n] 会被校验是否指向真实片段，非法编号计入审计并降低置信度。
            </li>
          </ul>
          <div className="rounded-xl bg-surface-sunken p-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-ink-mute">实时检索演示</p>
            <RetrievalPlayground />
          </div>
        </div>

        <div className="card space-y-3 p-4">
          <SectionTitle title="工具层（MCP 同源）" desc="8 个工具全部为确定性函数，无 LLM 参与判断" />
          <ul className="space-y-1.5">
            {tools.map((tool) => (
              <li key={tool.name} className="rounded-xl border border-line bg-surface px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[10px] text-brand-700">
                    {tool.name}
                  </code>
                  <span className="text-[11px] font-medium text-ink">{tool.title}</span>
                </div>
                <p className="mt-0.5 text-[10px] leading-relaxed text-ink-mute">{tool.description}</p>
              </li>
            ))}
          </ul>
          <p className="text-[10px] leading-relaxed text-ink-mute">
            MCP Server 通过 <code className="font-mono">mcp/server.mjs</code> 暴露
            <code className="ml-1 font-mono">check_interaction / lab_assess / search_kb / build_med_plan</code>，
            任何支持 MCP 的客户端（Claude Desktop、Cursor、自研 Agent）都能把守药人当作一个「用药安全工具链」调用。
          </p>
        </div>
      </section>

      {/* 安全层 */}
      <section className="card space-y-3 p-4">
        <SectionTitle
          title="安全与可控性：四道闸门"
          desc="对应评审维度「AI 安全与可控性」——不是免责声明，而是可执行的技术约束"
        />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['输入侧', '11 条红旗症状规则，命中即强制转诊；手机号/身份证/银行卡在进入模型前脱敏。'],
            ['过程侧', '工具白名单 + 最大步数 + 单次运行超时；未知工具直接跳过并记录。'],
            ['输出侧', '诊断断言改写、绝对化表述拦截、剂量无引用拦截、引用编号合法性校验。'],
            ['事后', '每次运行写入 logs/runs/*.json 与 logs/audit.jsonl，可回放、可统计、可导出。'],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-xl border border-line bg-surface px-3 py-2.5">
              <p className="text-[11px] font-semibold text-brand-700">{title}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-ink-soft">{desc}</p>
            </div>
          ))}
        </div>
        <div className="rounded-xl bg-surface-sunken px-3 py-2 text-[10px] leading-relaxed text-ink-mute">
          降级策略：未配置 Key → 规则引擎；LLM 规划失败 → 回退标准流水线；LLM 生成失败 → 规则引擎合成同结构答案；
          证据不足 → 保守回答 + 提示就医。任何一条都不会给出「空白页」。
        </div>
      </section>

      {/* 数据与工程 */}
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="card space-y-2 p-4">
          <SectionTitle title="数据分层" desc="全部随仓库分发，克隆即可复现" />
          <pre className="overflow-x-auto rounded-xl bg-surface-sunken p-3 font-mono text-[10px] leading-relaxed text-ink-soft">
{`data/
├─ kb/*.md              # 17 篇循证知识（frontmatter + 小节分块）
├─ drugs.json           # 29 种基层常用药：别名/常规剂量/肾损/老年注意/监测项
├─ interactions.json    # 21 条相互作用规则（机制 + 处置 + 证据 docId）
├─ redflags.json        # 11 条红旗症状（分诊等级 + 去向）
└─ patients.json        # 4 位演示患者（含自购药、检验异常、家属联系人）`}
          </pre>
        </div>
        <div className="card space-y-2 p-4">
          <SectionTitle title="工程取舍" desc="每一处「不用某个库」都有理由" />
          <ul className="space-y-1.5 text-[11px] leading-relaxed text-ink-soft">
            <li>· <strong className="text-ink">不装 Vercel AI SDK</strong>：自研 SSE 协议需要暴露 plan/tool_call 等自定义事件，SDK 的 data stream 反而要二次封装。</li>
            <li>· <strong className="text-ink">不装 react-markdown</strong>：输出结构受控，40 行渲染器省 100KB，且能原生渲染可点击的引用徽标。</li>
            <li>· <strong className="text-ink">不装图表库</strong>：冲突图谱用 SVG 手写，150 行、零体积、可加动画与无障碍标签。</li>
            <li>· <strong className="text-ink">不用数据库</strong>：JSON/Markdown + 运行时索引，消除演示环境的部署风险。</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
