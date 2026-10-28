# 守药人 MediGuardian

> **面向基层医疗的多模态用药安全 Agent**
> 让每一位老人都能用对药 —— AI Native Web 应用参赛作品

[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-149eca)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-stdio-6b46c1)](https://modelcontextprotocol.io/)

---

## 一、项目简介

**守药人**是一个面向中国基层医疗场景的 AI Native 用药安全 Agent。它解决的是一类**极其常见但极易被忽视**的问题：

> 一位 78 岁的农村老人，同时服用 6–8 种药物；其中既有县医院开的华法林，也有子女买的钙片、邻居给的「安定」、膝盖疼时自己从村卫生室买的布洛芬。
> 每一种药单独看都合理，但**组合在一起**，消化道出血风险会升高 2–3 倍。

村卫生室通常只有 1–2 名村医，既看病又随访，基层几乎没有临床药师岗位。**「谁来做用药重整」是一个真实存在、规模巨大的空白。**

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

### 🔍 混合检索 RAG（可量化的检索质量）

```
分块 → BM25(稀疏) ┐
                ├→ RRF 融合 → 术语重排 → 证据锚定 → 引用合法性校验
     哈希向量(稠密) ┘
```

- 不依赖向量数据库与外部 embedding 服务：百级分块内存检索 < 5ms，消除部署失败面；接入真实 embedding 只需替换 `embed()`。
- 每个命中都带 **BM25 / 向量 / RRF / 重排** 四项打分明细，评委可当场追问「为什么是这条证据」。
- 附离线评测脚本：`npm run eval:rag` 输出 14 条探针的 **Hit@1 / Hit@3 / MRR**。

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
| 输入侧 | 11 条红旗症状规则，命中即强制转诊；手机号/身份证/银行卡/邮箱在进入模型前脱敏 |
| 过程侧 | 工具白名单 + 最大步数 + 运行超时；未知工具跳过并记录 |
| 输出侧 | 诊断断言改写、绝对化表述拦截、**剂量无引用拦截**、`[n]` 引用合法性校验 |
| 事后 | `logs/audit.jsonl` 逐次追加，支持统计与回放；`npm run audit:report` 生成汇总 |

### 🔊 适老化交互

语音输入（Web Speech API）、0.92 倍速 TTS 播报、整站 rem 缩放大字模式、深浅主题、`prefers-reduced-motion` 尊重系统偏好。

### 🔌 MCP 工具外化

`mcp/server.mjs` 通过 MCP 协议（stdio）暴露 5 个能力，任何支持 MCP 的客户端（Claude Desktop / Cursor / 自研 Agent）都能把守药人当作「用药安全工具箱」调用。协议层与实现层通过 `/api/mcp` 桥接，**工具实现只有一份**。

---

## 三、技术架构

```
┌──────────────────────────── 浏览器（React 19 / App Router）────────────────────────────┐
│  落地页 /            智能诊台 /console            架构 /arch     审计 /safety   轨迹 /trace/[id] │
│  ├─ Zustand 会话状态（lib/store/useConsoleStore.ts）                                      │
│  ├─ 自研 SSE 消费器（plan/step/tool_call/retrieval/token/safety/answer_meta/done）        │
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
│  ├─ page.tsx                    # 落地页（痛点 → 方案 → 评分点自检）
│  ├─ console/page.tsx            # 智能诊台（服务端组装患者数据包）
│  ├─ arch/page.tsx               # 技术架构 + 实时检索演示
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
│  ├─ arch/RetrievalPlayground.tsx
│  └─ ui/Bits.tsx
├─ lib/
│  ├─ agent/runtime.ts            # ★ Agent 运行时
│  ├─ agent/store.ts              # 轨迹落盘与回放
│  ├─ tools/index.ts              # ★ 8 个确定性工具 + 14 条临床规则
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
└─ docs/                          # 技术文档 / 视频脚本 / 答辩要点 / 评分自评
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

支持的 provider：`deepseek` / `zhipu`（支持视觉，可识别药盒）/ `qwen` / `openai` / `custom`（任意 OpenAI 兼容网关）。

### 其他命令

```bash
npm run build        # 生产构建
npm start            # 生产启动
npm run typecheck    # TypeScript 严格检查（tsc --noEmit）
npm run lint         # ESLint（next/core-web-vitals）
npm run smoke        # 端到端冒烟：3 个患者用例，校验 SSE 事件序列/引用/红旗转诊（需先启动服务）
npm run smoke:mcp    # MCP 集成冒烟：官方 SDK Client 真实拉起 stdio Server，走 initialize→tools/list→tools/call
npm run eval:rag     # 检索质量评测：14 条探针的 Hit@1 / Hit@3 / MRR（需先启动服务）
npm run mcp          # 启动 MCP Server（stdio，需先启动服务）
npm run audit:report # 汇总审计日志 → docs/audit-summary.md
```

> 提示：`eval:rag` / `smoke` 走的是真实 HTTP 接口，建议先访问一次 `/arch` 让检索路由完成编译
> （`next dev` 首次编译约 15–20 秒），再执行命令，避免把冷启动误当成失败。
> 若 `next build` 与 `next dev` 交替使用，切换前清理 `.next` 目录最稳。

### 环境变量说明

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LLM_PROVIDER` | `mock` | `mock`/`openai`/`deepseek`/`zhipu`/`qwen`/`custom` |
| `LLM_API_KEY` | 空 | 密钥（**严禁提交到仓库**） |
| `LLM_BASE_URL` / `LLM_MODEL` | 按 provider 预设 | 自定义网关时填写 |
| `VISION_MODEL` | 按 provider 预设 | 药盒识别用视觉模型 |
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

| 类型 | 方式 |
| --- | --- |
| 类型安全 | `npm run typecheck`（`strict: true`） |
| 代码规范 | `npm run lint` |
| 生产构建 | `npm run build` |
| 接口冒烟 | `curl -N -X POST localhost:3000/api/chat -d '{"patientId":"p-001","question":"牙龈出血，大便发黑"}'`（观察事件序列） |
| 检索质量 | `npm run eval:rag`（Hit@1 / Hit@3 / MRR） |
| 安全守门 | 提问「确诊是胃溃疡吗？直接把华法林停了吧」→ 观察输出改写与告警 |
| 降级路径 | 只填错误的 `LLM_API_KEY` → 观察自动回退规则引擎的提示 |

---

## 八、数据说明与免责声明

- `data/` 下全部为**演示数据**：患者为虚构人物，药物信息与相互作用条目依据公开说明书与 Beers 标准整理并改写，**不可作为临床依据**。
- 本项目输出仅供基层医护与家属参考，**不构成诊断或处方**；任何用药调整须经执业医师确认。
- 项目不收集任何真实患者数据；运行时产生的轨迹与审计日志仅保存在本地 `logs/`（已被 `.gitignore` 忽略）。

---

## 九、团队信息

| 角色 | 姓名 | 分工 |
| --- | --- | --- |
| 队长 / 前端与 AI 工程 | ［待填］ | Agent 运行时、RAG、前端架构、MCP |
| 队员 / 交互与视觉 | ［待填］ | 设计系统、冲突图谱、适老化交互、演示视频 |
| 队员 / 临床知识与测试 | ［待填］ | 知识库整理、规则校验、用例测试 |
| 指导教师 | ［待填］ | 选题指导、临床合理性把关 |

> 组别：［按规则填写 A/B/C/研究生组］　学校：［待填］

---

## 十、许可

MIT License，详见 `LICENSE`。第三方数据集与文献引用遵循其原始许可。
