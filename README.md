# 守药人 MediGuardian

> **面向基层医疗的多模态用药安全 Agent**
> 让每一位老人都能用对药 —— AI Native 基层用药安全 Agent

[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-149eca)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-stdio-6b46c1)](https://modelcontextprotocol.io/)

---

## 一、项目简介

**守药人**是一个面向中国基层医疗场景的 AI Native 用药安全 Agent。它解决的是一类**极其常见但极易被忽视**的问题：

> 一位虚构老人同时使用处方药和自购药。单看一种药，未必能看出组合、检验指标和症状之间的联系。
> 这是合成演示场景；项目不在此处宣称具体风险倍数，也不将规则输出作为临床结论。

项目聚焦处方、自购药、检验结果和主诉分散时的清单核对工作流，不对各地药师配置或服务覆盖作未经核验的断言。

守药人把这件事拆成四步，并全部交给一个可审计的 Agent 完成：

| 步骤 | 做什么 | 对应实现 |
| --- | --- | --- |
| ① 采集 | 药盒拍照、语音问药、处方文本 → 结构化用药清单 | `app/api/vision/route.ts`、Web Speech API |
| ② 核查 | 两两相互作用 + 按 eGFR/血钾/INR/年龄分层 | `lib/tools/index.ts`（8 个确定性工具） |
| ③ 取证 | 混合检索循证知识库，每条结论带 `[n]` 引用 | `lib/rag/`（BM25 + 哈希向量 + RRF + 重排） |
| ④ 出方案 | 保留/调整/停用/复查/教育 五段式 + 转诊单 + 家属通知 | `lib/agent/runtime.ts` |

**核心主张：AI 的每一个判断都必须能被看见、被追问、被回溯。** 因此界面不是「一个聊天框」，而是三栏并行——在吃什么 / 说了什么 / 凭什么。

---

## 二、核心特性

### 🤖 双引擎 Agent（永不翻车的演示）

- **LLM 引擎**：模型自主规划（输出结构化 JSON 计划）→ 逐步调用工具 → 生成带引用约束的回答。
- **规则引擎**：未配置 API Key、断网、模型超时或输出不合格时**自动降级**，用确定性逻辑跑完整条流水线。
  两者共用同一套工具、检索与安全管线，**产品行为契约完全一致**。
- 层叠降级：LLM 规划失败 → 回退标准流水线；LLM 生成失败 → 规则引擎合成同结构答案；证据不足 → 保守回答 + 提示就医。
- **受限多轮语境**：客户端只传最近 6 条文本，服务端仅在明确追问时补回上一轮用户主题；历史先脱敏、再限长，并对消解后的有效问题重新执行红旗筛查，避免“那我先做什么”丢失上轮的紧急处置等级。
- **输出可信度自检**：回答完成后独立核对引用合法性、高风险证据覆盖和来源可追溯性；工程可信度分与逐项检查在右栏直接展示，不把模型自信当作事实。
- **可复现外部验证**：`npm run eval:llm` 只统计实际 `mode=llm` 的运行，`npm run eval:vision` 只统计真实非 mock 图片识别；`npm run review:export` 导出药师逐条复核清单，未采集的数据不会被写成已验证。

### 🔍 混合检索 RAG（可量化的检索质量）

```
原话 BM25 ─────────────┐
同义词 BM25（受限补充） ├→ RRF 融合 → 术语重排 → 证据锚定 → 引用校验
扩展查询 → 哈希向量 ──┘
```

- 不依赖向量数据库与外部 embedding 服务：百级分块内存检索 < 5ms，消除部署失败面；接入真实 embedding 只需替换 `embed()`。
- 每个命中都带 **BM25 / 向量 / RRF / 重排** 四项打分明细，任何人都能当场追问「为什么是这条证据」。
- **领域同义词扩展**（`data/synonyms.json`，18 组）：哈希向量不具备预训练语义能力，因此用人工维护词组映射「心里发慌 / 腿也肿」等口语。原话 BM25 负责精确，同义词 BM25 作为受限补充，扩展查询也进入向量路。
- 附检索评测：`npm run eval:rag` 使用 63 条项目自标注探针，统计 Hit@1/3/5、MRR@5、Recall@5、nDCG@5；本地实测 Hit@1/3/5 = 0.889/1.000/1.000、MRR@5 = 0.939、Recall@5 = 0.955、nDCG@5 = 0.910。它衡量工程检索回归，不代表临床准确率。基线对照需在服务进程启动时设置 `RAG_SYNONYMS=off`。

### 🕸 用药冲突图谱（交互创新）

`components/console/ConflictGraph.tsx` 用**手写 SVG**（约 150 行、零依赖）把 N 种药排成环形节点、把相互作用画成连线：

- 连线颜色 = 严重程度，高风险连线做流动虚线动画；
- 节点颜色区分「医嘱药」与「非医嘱自购药」（最危险的往往不在处方里）；
- 点击连线即展开机制与处置建议。

### 🧭 决策轨迹回放（可解释性）

每次运行落盘为 `logs/runs/{runId}.json`，`/trace/[runId]` 可逐帧回放：
规划步骤 → 每个工具的入参与返回 → 检索证据与打分明细 → 安全守门改写记录 → 最终回答。

### 🛡 四道安全闸门

| 闸门 | 机制 |
| --- | --- |
| 输入侧 | 11 条红旗症状规则，命中即强制转诊；用户提问中的手机号/身份证/银行卡/邮箱在外部模型调用前脱敏 |
| 过程侧 | 工具白名单 + 最大步数 + 运行超时；未知工具跳过并记录 |
| 输出侧 | 诊断断言改写、绝对化表述拦截、**剂量无引用拦截**、`[n]` 引用合法性校验 |
| 事后 | `logs/audit.jsonl` 逐次追加并形成 SHA-256 哈希链，支持篡改检测、统计与回放；多轮追问会在轨迹中标明语境消解 |

**数据边界**：默认规则引擎不调用外部模型。启用云端 LLM 后，脱敏后的问题以及患者档案、用药和检验上下文会发送给所配置的模型服务；药盒图片识别也会将图片转发给该视觉服务。演示数据为合成数据，请勿录入真实患者信息。

### 🔊 适老化交互

语音输入（Web Speech API）、0.92 倍速 TTS 播报、整站 rem 缩放大字模式、深浅主题、`prefers-reduced-motion` 尊重系统偏好。

### 🔌 MCP 工具外化

`mcp/server.mjs` 通过 MCP 协议（stdio）暴露 5 个能力，任何支持 MCP 的客户端（Claude Desktop / Cursor / 自研 Agent）都能把守药人当作「用药安全工具箱」调用。协议层与实现层通过 `/api/mcp` 桥接，**工具实现只有一份**。

---

## 三、技术架构

```
┌──────────────────────────── 浏览器（React 19 / App Router）────────────────────────────┐
│  落地页 /          智能诊台 /console          依据 /evidence   审计 /safety   轨迹 /trace/[id] │
│  ├─ Zustand 会话状态（lib/store/useConsoleStore.ts）                                      │
│  ├─ 自研 SSE 消费器（plan/step/tool_call/retrieval/token/answer_final/safety/answer_meta/done） │
│  ├─ MiniMarkdown 渲染器（[n] → 可点击证据徽标）                                            │
│  └─ ConflictGraph（手写 SVG）/ 三视角 InsightPanel / 语音 + 拍照 + TTS                     │
└───────────────────────────────────────┬──────────────────────────────────────────────┘
                                        │ POST /api/chat (text/event-stream)
┌───────────────────────────────────────▼──────────────────────────────────────────────┐
│ Agent 运行时 lib/agent/runtime.ts                                                     │
│  ① 输入安全审查 → ② 规划（LLM/规则）→ ③ 工具编排 → ④ 证据锚定 → ⑤ 生成 → ⑥ 输出守门 → ⑦ 落盘 │
└───┬───────────────┬────────────────┬───────────────────┬─────────────────────────────┘
    │               │                │                   │
┌───▼─────┐  ┌──────▼──────┐  ┌──────▼──────┐  ┌─────────▼──────────┐
│ 工具层   │  │ 检索层 RAG  │  │ 安全层       │  │ LLM Provider        │
│ 8 tools │  │ BM25+向量   │  │ 4 道闸门     │  │ OpenAI 兼容协议      │
│ 确定性   │  │ RRF+重排    │  │ 审计 JSONL   │  │ DeepSeek/智谱/通义   │
└───┬─────┘  └──────┬──────┘  └──────────────┘  └─────────────────────┘
    │               │
┌───▼───────────────▼──────────────────────────────────────────────────────────────────┐
│ 数据层（随仓库分发，无数据库）                                                          │
│ data/kb/*.md（17 篇）· drugs.json（29 种）· interactions.json（21 条）· redflags.json（11 条）· patients.json（4 位） │
└──────────────────────────────────────────────────────────────────────────────────────┘
                                        ▲
                              mcp/server.mjs（MCP stdio）→ /api/mcp
```

### 目录结构

> 文中所有数量（药品种类、知识库篇数、规则条数）均以 `data/` 下的数据文件为准，改动数据后请同步更新文档。

```
chuanzhi/
├─ app/
│  ├─ page.tsx                    # 落地页（痛点 → 方案 → 适用边界 → 技术底座）
│  ├─ console/page.tsx            # 智能诊台（服务端组装患者数据包）
│  ├─ evidence/page.tsx           # 依据与规则 + 依据检索（规则表 / 红旗 / 知识来源）
│  ├─ safety/page.tsx             # 安全审计流水
│  ├─ trace/[runId]/page.tsx      # 决策轨迹回放
│  └─ api/
│     ├─ chat/route.ts            # Agent SSE 流式接口
│     ├─ kb/search/route.ts       # 检索调试/评测接口
│     ├─ vision/route.ts          # 药盒识别（含演示模式）
│     ├─ patients/route.ts        # 患者数据包
│     ├─ audit/route.ts           # 审计 + 运行列表
│     ├─ tools/route.ts           # 工具清单
│     └─ mcp/route.ts             # MCP 工具桥接
├─ components/
│  ├─ TopNav.tsx                  # 大字 / 主题切换
│  ├─ MiniMarkdown.tsx            # 自研渲染器（引用徽标）
│  ├─ console/                    # Console / PatientRail / ChatPanel / InsightPanel / ConflictGraph
│  ├─ evidence/RetrievalPlayground.tsx
│  └─ ui/Bits.tsx
├─ lib/
│  ├─ agent/runtime.ts            # ★ Agent 运行时
│  ├─ agent/store.ts              # 轨迹落盘与回放
│  ├─ tools/index.ts              # ★ 8 个确定性工具 + 14 类演示规则（待专业复核）
│  ├─ rag/{index,text,embed}.ts   # ★ 混合检索
│  ├─ safety/index.ts             # ★ 安全四闸门 + 审计
│  ├─ llm/{provider,prompts}.ts   # LLM 抽象 + Prompt 工程
│  ├─ store/useConsoleStore.ts    # Zustand + SSE 消费
│  ├─ data.ts / types.ts / utils.ts
├─ data/                          # 知识库与演示数据
├─ mcp/server.mjs                 # MCP Server（stdio）
├─ scripts/
│  ├─ eval-retrieval.mjs          # 检索质量评测（Hit@1/Hit@3/MRR）
│  └─ audit-report.mjs            # 审计汇总 → docs/audit-summary.md
└─ docs/                          # 技术文档 / 视频脚本 / 演示要点 / 自评
```

---

## 四、快速开始

### 环境要求

- Node.js **≥ 20**（推荐 20 LTS / 22）
- 包管理器：npm ≥ 10（也支持 pnpm / yarn）

### 三步启动

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（可选；不配置也能完整运行）
cp .env.example .env.local     # Windows: copy .env.example .env.local

# 3. 启动
npm run dev
```

打开 <http://localhost:3000> → 进入「智能诊台」→ 选择患者 → 提问。

> **不配置任何 API Key 也能跑完整流程**：默认 `LLM_PROVIDER=mock`，走本地规则引擎，
> 工具调用、检索、证据、安全守门、轨迹回放全部真实执行，只有自然语言生成改为模板合成。

### Docker Compose（本机演示）

```bash
docker compose up --build
```

打开 <http://127.0.0.1:3000>。默认使用 mock 引擎，不需要密钥；服务只绑定本机回环地址，运行日志挂载到 `./logs`。Compose 模板没有认证，不应直接改为公网监听。若配置云端模型，将密钥放在本地未提交的 `.env` 中，并注意患者上下文会发送给所选服务商；不要输入真实患者资料。

### 接入真实大模型（可选）

编辑 `.env.local`：

```bash
LLM_PROVIDER=deepseek
LLM_API_KEY=sk-xxxx
# 其余走预设；如需自定义：
# LLM_BASE_URL=https://api.deepseek.com/v1
# LLM_MODEL=deepseek-chat
LLM_TEMPERATURE=0.2
```

支持的 provider：`deepseek` / `zhipu` / `qwen` / `openai` / `custom`（任意 OpenAI 兼容网关）。DeepSeek 预设仅用于文本；药盒识别必须另配支持图像输入的 `VISION_MODEL`，或使用自带视觉预设的 OpenAI、智谱、通义。

### 其他命令

```bash
npm run build        # 生产构建
npm start            # 生产启动
npm run typecheck    # TypeScript 严格检查（tsc --noEmit）
npm run lint         # ESLint（next/core-web-vitals）
npm run smoke        # 端到端冒烟：4 个场景，校验 SSE 事件序列/引用/红旗转诊/多轮语境（需先启动服务）
npm run smoke:mcp    # MCP 集成冒烟：官方 SDK Client 真实拉起 stdio Server，走 initialize→tools/list→tools/call
npm run eval:rag     # 检索质量评测：63 条自标注探针、多相关文档指标（需先启动服务）
npm run eval:llm     # 真实文本模型链路：实际模式、降级率、延迟与 usage 覆盖
npm run eval:llm:summary # 汇总 data/eval 下多轮真实模型结果
npm run eval:vision:build # 由公开许可原图重建 36 张视觉鲁棒性样本
npm run eval:vision  # 真实视觉模型评测；mock 与未配置视觉模型不计准确率
npm run eval:safety  # 安全回归：红旗检出/否定句特异度/输出守门断言
npm run mcp          # 启动 MCP Server（stdio，需先启动服务）
npm run audit:report # 汇总审计日志 → docs/audit-summary.md
```

> 提示：`eval:rag` / `smoke` 走的是真实 HTTP 接口，建议先访问一次 `/evidence` 让检索路由完成编译
> （`next dev` 首次编译约 15–20 秒），再执行命令，避免把冷启动误当成失败。
> 若 `next build` 与 `next dev` 交替使用，切换前清理 `.next` 目录最稳。

### 环境变量说明

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LLM_PROVIDER` | `mock` | `mock`/`openai`/`deepseek`/`zhipu`/`qwen`/`custom` |
| `LLM_API_KEY` | 空 | 密钥（**严禁提交到仓库**） |
| `LLM_BASE_URL` / `LLM_MODEL` | 按 provider 预设 | 自定义网关时填写 |
| `VISION_MODEL` | 仅视觉 provider 有预设 | 药盒识别用视觉模型；文本模型不会被自动冒充为视觉模型 |
| `LLM_TEMPERATURE` | `0.2` | 用药场景建议 ≤ 0.3 |
| `RAG_TOP_K` / `RAG_MIN_SCORE` | `6` / `0.12` | 检索参数 |
| `SAFETY_MODE` | `strict` | `strict` 下无引用剂量会被拦截 |
| `AGENT_MAX_STEPS` | `6` | Agent 最大工具步数 |
| `AUDIT_LOG_PATH` | `logs/audit.jsonl` | 审计日志路径 |
| `MCP_API_BASE` | `http://127.0.0.1:3000` | MCP 桥接目标 |

---

## 五、MCP 集成

```bash
# 终端 A
npm run dev

# 终端 B
npm run mcp
```

挂载到 Claude Desktop（`claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "mediguardian": {
      "command": "node",
      "args": ["C:/path/to/chuanzhi/mcp/server.mjs"],
      "env": { "MCP_API_BASE": "http://127.0.0.1:3000" }
    }
  }
}
```

暴露的能力：`list_patients`、`check_interaction`、`lab_assess`、`search_kb`、`build_med_plan`。

---

## 六、设计取舍（为什么不用某些「标准答案」）

### 界面语言：「病历纸」，不是「AI 落地页」

医疗产品的界面不该长得像又一个 AI SaaS。设计令牌全部按一份文书来定规则，写在 `app/globals.css` 顶部：暖白纸底、1px 细线分层（不用投影堆层次）、圆角上限 10px、青绿只留给主操作与当前位置、数字用等宽 + `tabular-nums`。

聊天区用**对话转录**而不是气泡：左栏位标签（问 / 守药人）+ 整行正文 + 细线分隔——气泡是社交 App 的隐喻，病历是转录体。

这些约束不是靠"我觉得"，而是可机器判定的：`npm run audit:style` 逐元素检查毛玻璃、模糊装饰、大圆角、弥散投影四条规则（当前 0 违规），并测出高饱和色块面积占比仅 **0.18%（首页）/ 0.44%（诊台）**。完整评审记录见 `docs/评审-界面.md`。

| 决策 | 理由 |
| --- | --- |
| 不用 Vercel AI SDK | 需要向前端暴露 `plan`/`tool_call`/`retrieval` 等自定义事件，SDK 的 data-stream 反而要二次封装；自研 SSE 协议约 60 行，完全可控 |
| 不用向量数据库 | 百级分块、内存检索 < 5ms；引入 Milvus/pgvector 只增加部署失败面。换真实 embedding 只需替换 `embed()` |
| 不用 LangChain | Agent 环路只有 7 步、工具 8 个，抽象成本高于收益；手写后每行逻辑都可解释 |
| 不用 react-markdown | 输出结构受控，自研渲染器 40 行省 100KB，且能原生渲染可点击引用徽标 |
| 不用图表库 | 冲突图谱手写 SVG，150 行、零体积、可加动画与无障碍标签 |
| 不用数据库 | JSON/Markdown 随仓库分发，`npm i && npm run dev` 即可复现，消除演示环境风险 |

---

## 七、测试与验证

| 类型 | 方式 | 实测 |
| --- | --- | --- |
| 类型安全 | `npm run typecheck`（`strict: true`，含测试文件） | 0 error |
| 代码规范 | `npm run lint` | 0 warning / 0 error |
| **单元测试** | `npm test`（vitest：检索 / 工具 / 安全 / 模型能力 / 图片输入边界 / 评测回归） | 本轮 74 / 74 通过 |
| **持续集成** | GitHub Actions：typecheck → lint → test → build | 四关全绿 |
| 生产构建 | `npm run build` | 成功 |
| 端到端 | `npm run smoke`（3 位患者 + 1 个多轮追问，校验 SSE 序列 / 引用 / 红旗转诊） | 4 / 4 通过 |
| MCP 集成 | `npm run smoke:mcp`（官方 SDK 拉起 stdio Server） | 7 / 7 通过 |
| 检索质量 | `npm run eval:rag`（63 条自标注，多相关文档，四类查询） | 工程指标，非临床验证 |
| 真实 LLM | `npm run eval:llm:summary` | 2026-11-17 最新一轮 DeepSeek 3/3 最终 LLM 通过，无降级，平均 12.3 秒，usage 覆盖 3/3；历史前三轮失败仍保留在汇总中 |
| 视觉数据集 | `npm run eval:vision:build` | 4 张开放许可原图派生 36 张鲁棒性样本；不是 36 张独立临床照片 |
| 真实视觉 | `npm run eval:vision` | 当前 DeepSeek 文本预设明确报告未配置视觉模型，不生成虚假准确率 |
| 安全回归 | `npm run eval:safety`（红旗正例/否认负例/输出守门） | 以当前运行结果为准 |
| **前端审计** | `npm run audit:ui`（2 视口 × 5 个关键页面 + 大字模式） | 无运行时异常 / 无横向溢出 / 无缺失可访问名称；自动纳入最近一次轨迹回放页 |
| **可用性实测** | `npm run audit:review`（对比度 / 焦点 / 点击区 / 320px 重排，双主题） | 4 项全部 0 不合格；详见 `docs/评审-界面.md` |
| **视觉语言** | `npm run audit:style`（毛玻璃 / 模糊装饰 / 大圆角 / 浮起投影，逐元素） | 0 违规；高饱和色面积占比 0.18% / 0.44% |
| 截图素材 | `npm run shots` → `docs/screenshots/` | 10 张 1440×900@2x |
| 安全守门 | 提问「确诊是胃溃疡吗？直接把华法林停了吧」→ 观察输出改写与告警 | 断言改写 + 拒绝直接停药 |
| 降级路径 | 只填错误的 `LLM_API_KEY` → 观察自动回退规则引擎的提示 | 事件流完整 |

> 单元测试只覆盖**纯函数与确定性契约**（检索排序、规则命中、PII 脱敏、输出守门），
> 不写"点一下按钮看有没有渲染"的脆弱测试——理由：本项目最怕的不是页面崩，而是
> **改一条临床规则时悄悄破坏另一条**，这只有纯函数测试能守住。

---

## 八、数据说明与免责声明

- `data/` 下全部为**演示数据**：患者为虚构人物。知识条目登记了候选来源，但具体建议尚未由药师逐条复核并映射到原文，**不可作为临床依据**。
- 本项目是工程演示原型，输出**不构成诊断或处方**；不得输入真实患者数据，任何用药调整须由执业医师确认。
- 本地开发时运行轨迹与审计日志写入 `logs/`（已被 `.gitignore` 忽略）。启用云端模型会将患者上下文发送给所配置的服务商；容器模板默认无认证且仅绑定本机回环地址，不得直接公开到公网。

---

## 九、团队信息

| 角色 | 姓名 | 分工 |
| --- | --- | --- |
| 队长 | 魏士博 | 团队统筹 |
| 队员 | 张志翔 | 团队成员 |
| 队员 | 吕晶晶 | 团队成员 |
| 指导教师 | 高旸、袁磊 | 指导教师 |

> 组别：B 组　学校：大连东软信息学院

---

## 十、许可

MIT License，详见 `LICENSE`。第三方数据集与文献引用遵循其原始许可。
