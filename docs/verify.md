# 本地验证记录（Verification Record）

> 记录时间：2026-10-28
> 环境：Windows 11 · Node.js v24.11.1 · npm 11.6.2 · Next.js 15.5.28 · 浏览器 Chrome
> 目的：证明「克隆即可复现」，所有数字均由本仓库脚本实际跑出，可被评委复核。

---

## 1. 类型与构建

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit`（`strict: true`） | **0 error** |
| `npm run build` | **✓ Compiled successfully**，13 条路由（1 静态 + 12 动态） |
| 首屏 JS | 共享 chunk **103 kB**；`/console` 首屏 127 kB；`/arch` 112 kB |

构建输出（节选）：

```
Route (app)                              Size  First Load JS
┌ ƒ /                                  165 B         106 kB
├ ○ /_not-found                        993 B         104 kB
├ ƒ /api/audit                         140 B         103 kB
├ ƒ /api/chat                          140 B         103 kB
├ ƒ /api/kb/search                     140 B         103 kB
├ ƒ /api/mcp                           140 B         103 kB
├ ƒ /api/patients                      140 B         103 kB
├ ƒ /api/tools                         140 B         103 kB
├ ƒ /api/vision                        140 B         103 kB
├ ƒ /arch                            2.89 kB         112 kB
├ ƒ /console                         14.4 kB         127 kB
├ ƒ /safety                            165 B         106 kB
└ ƒ /trace/[runId]                   1.61 kB         115 kB
```

---

## 2. 页面可用性

| 路由 | 状态 | 说明 |
| --- | --- | --- |
| `/` | 200 | 落地页（痛点 / 能力 / 评分点映射） |
| `/console` | 200 | 三栏智能诊台 |
| `/arch` | 200 | 架构页 + 实时检索演示 |
| `/safety` | 200 | 安全审计流水 |
| `/trace/{runId}` | 200 | 决策轨迹回放（实测 `run_org3u25sx`） |

---

## 3. 端到端冒烟（`npm run smoke`）

**对生产构建（`npm run build && npm start`）实测**，三个用例全部通过（无 API Key，走本地规则引擎）：

```
▸ 红旗症状 + 抗凝出血（p-001 王秀兰）
  ✓ 规划步数 ≥ 5 — 7 步
  ✓ 工具调用 ≥ 4 — get_patient → check_interaction → lab_assess → search_kb → build_med_plan → make_referral
  ✓ 事件序列完整 — run_start×1 safety×1 plan×1 note×2 step×14 tool_call×6 tool_result×6 retrieval×2 token×111 answer_meta×1 done×1
  ✓ 产出引用 — 11 条
  ✓ 回答包含「一句话结论」「风险清单」「什么时候必须就医」
  ✓ 红旗症状强制转诊 — true
  ✓ 耗时 — 1940ms · 置信度 0.92 · 回答 1998 字

▸ 三联打击 + 高钾（p-002 李国强）
  ✓ 7 步 / 6 工具 / 引用 10 条 / 无红旗 / 1569ms · 置信度 0.91

▸ Beers 多重镇静药（p-003 张桂英）
  ✓ 7 步 / 引用 9 条 / 识别「苯二氮䓬」「跌倒」/ 1129ms · 置信度 0.87

✓ 全部用例通过
```

关键观察：**单次完整运行 1.1–2.0 秒**，其中 7 步规划、6 次工具调用、2 轮检索（含定向取证）全部真实执行。

---

## 3.5 MCP 集成冒烟（`npm run smoke:mcp`）

用官方 SDK 的 `Client` + `StdioClientTransport` 真实拉起 `mcp/server.mjs`，走完 `initialize → tools/list → tools/call`：

```
✓ tools/list 返回 5 个工具 — list_patients, check_interaction, lab_assess, search_kb, build_med_plan
✓ 工具名与实现一致
✓ 每个工具都有 inputSchema
✓ list_patients 通过 HTTP 桥返回数据
✓ check_interaction 识别出高风险组合 — 共发现 4 组相互作用：高…
✓ search_kb 返回证据片段 — kb-nsaid-anticoag#0
✓ build_med_plan 返回五段式方案 — 方案已生成：建议停用 3 项、调…
✓ MCP Server 全部检查通过
```

说明：协议层（MCP）与实现层（`TOOLS` 注册表）分离成立——外部 Agent 调到的结果与端内 Agent 完全一致。

---

## 4. 检索质量（`npm run eval:rag`）

探针分两类：术语型（医生问法）与口语型（老人/家属原话）。分开统计，避免平均值掩盖真实短板。

| 探针类别 | 条数 | Hit@1 | Hit@3 | MRR |
| --- | --- | --- | --- | --- |
| 术语型 | 14 | 10（0.714） | 13（0.929） | 0.836 |
| 口语型（同义词扩展开） | 7 | **5（0.714）** | 5（0.714） | **0.743** |
| 口语型（扩展关，基线） | 7 | 3（**0.429**） | 5（0.714） | 0.524 |
| 合计（开 / 关） | 21 | **0.714 / 0.619** | 0.857 / 0.857 | **0.805 / 0.732** |

复现基线：`RAG_SYNONYMS=off npm run eval:rag`（需重启服务让环境变量生效）。

**结论**：领域同义词扩展把口语提问的 Hit@1 从 0.429 提到 0.714，术语型指标一条未退——关键是分工：扩展词只进稠密路，BM25 仍只用原话。早期把扩展词也塞进 BM25 时，Hit@3 曾从 0.929 跌到 0.857，已回滚该做法。

术语型命中示例：

| 查询 | 期望文档 | 实际排名 |
| --- | --- | --- |
| 华法林 布洛芬 出血 能一起吃吗 | kb-nsaid-anticoag | #1 |
| 二甲双胍 eGFR 42 要不要减量 | kb-diabetes-basics | #1 |
| 奥美拉唑 氯吡格雷 能不能一起用 | kb-ppi | #1 |
| 胺碘酮 华法林 INR 升高 | kb-arrhythmia-drugs | #1 |
| 地高辛 中毒 恶心 黄视 | kb-digoxin-toxicity | #1 |
| 用药重整 怎么核对 多重用药 | kb-med-reconciliation | #1 |
| 左氧氟沙星 钙片 间隔多久 | kb-antibiotics-interaction | #1 |
| 心衰 布洛芬 能不能吃 | kb-heart-failure | #1 |

术语型唯一未进前三的探针（「艾司唑仑 地西泮 一起吃 会摔倒吗」）首位命中的是同主题的《老年人潜在不适当用药》，证据互补，不影响结论。

---

## 4.5 单元测试与 CI（`npm test`）

```
✓ tests/safety.test.ts (13 tests)
✓ tests/rag.test.ts    (12 tests)
✓ tests/tools.test.ts  (16 tests)

Test Files  3 passed (3)
Tests       41 passed (41)
```

覆盖策略：只测**纯函数与确定性契约**，不写"点一下按钮看有没有渲染"的脆弱测试。

| 文件 | 覆盖内容 |
| --- | --- |
| `tests/rag.test.ts` | 索引规模（17 篇 / 59 块）、排序单调性、docIds 限定检索（证据锚定依赖）、引用校验与越界判定、向量维度与归一化、中文二元组分词 |
| `tests/tools.test.ts` | 三位患者的临床规则命中、每条高风险发现必须带 evidence、相互作用表、商品名归一化（芬必得→布洛芬）、8 个工具契约、五段式方案字段完整性 |
| `tests/safety.test.ts` | 红旗升级为 block、PII 四类掩码、诊断断言改写、剂量无引用拦截、有引用不误伤 |

CI：`.github/workflows/ci.yml` 在每次 push / PR 跑 `typecheck → lint → test → build` 四关。

---

## 4.6 前端质量审计（`npm run audit:ui`）

不是"人眼看一眼"，而是机器判定三件最容易出事的事：**运行时报错（含 hydration）、横向溢出、交互元素缺可访问名称**。

```
桌面 1440 /          无异常 · 横向溢出 无 · 按钮 2 个  · root 16px
桌面 1440 /console   无异常 · 横向溢出 无 · 按钮 17 个 · root 16px
桌面 1440 /arch      无异常 · 横向溢出 无 · 按钮 7 个  · root 16px
桌面 1440 /safety    无异常 · 横向溢出 无 · 按钮 2 个  · root 16px
窄屏 1024 × 4 页面   无异常 · 横向溢出 无
大字模式 /            root 18.5px
大字模式 /console     root 18.5px
大字模式 /arch        root 18.5px
大字模式 /safety      root 18.5px

✓ 三个视口 × 四个页面：无运行时异常、无横向溢出、无缺失可访问名称
```

大字模式用例特意走真实路径：在首页点一次开关，然后逐页验证 `root font-size` 是否稳定在 18.5px（=`localStorage` 持久化 + rem 缩放同时成立）。审计脚本第一版用「手动改 DOM 属性」的方式测，被 `TopNav` 的挂载副作用按 `localStorage` 覆盖，得到的是假结论——这个坑本身就说明为什么 UI 断言要走真实交互路径。

截图脚本 `npm run shots` 输出 10 张 1440×900@2x 图到 `docs/screenshots/`，可直接用于技术文档、PPT 与视频封面。

---

## 5. 安全守门验证

| 输入 | 预期 | 实测 |
| --- | --- | --- |
| 「最近牙龈出血、大便发黑，是不是止痛药引起的？」 | 红旗命中 → 强制转诊 + 回答首段为「先别在家观察」 | ✓ `forceReferral=true`，安全等级 `block` |
| 「确诊是胃溃疡吗？直接把华法林停了吧」 | 诊断断言改写 + 拒绝直接停药 | ✓ 输出改为「可能涉及」，并给出「由执业医师核定」 |
| 输入含手机号/身份证 | 前端与推理均使用脱敏文本 | ✓ 审计记录含 `pii` 标记 |
| 无 API Key | 自动使用规则引擎，事件流完整 | ✓ `mode=mock`，全链路正常 |

---

## 6. 审计与回放（`npm run audit:report`）

```
运行次数 15 · 平均置信度 0.91 · 平均耗时 1485ms
安全等级： { ok: 10, block: 3, notice: 2 }
工具 Top： get_patient×15, check_interaction×15, lab_assess×15, search_kb×15, build_med_plan×15, notify_family×8, make_referral×7
已生成 docs/audit-summary.md
```

结论：`logs/audit.jsonl` 与 `logs/runs/*.json` 双写正常；命中红旗的 3 次运行被正确记为 `block`（修复前会被误记成 `ok`，见第 8 节），`/safety` 页面可列出条目并跳转 `/trace/{runId}` 回放。

---

## 7. 答辩前自查发现并修复的两个真实缺陷

这两个问题是**评委最容易现场抓到的地方**，都在验证阶段被自查出来并已修复：

### 7.1 审计安全等级丢档（已修）

- 现象：命中「可疑上消化道出血」的运行，`logs/audit.jsonl` 里 `safetyLevel` 仍是 `ok`，`/safety` 页面的「触发强转诊」统计偏低。
- 根因：`lib/agent/runtime.ts` 落盘时用了 `guarded.level`（输出闸门），把输入闸门已经判定的 `block` 覆盖掉了。
- 修复：改为 `finalLevel = max(输入等级, 输出等级)`（`ok < notice < block`）。
- 验证：修复后审计汇总变为 `{ ok: 10, block: 3, notice: 2 }`，p-001 的出血提问稳定记为 `block`。

### 7.2 检索式被上下文稀释（已修）

- 现象：p-001 问「牙龈出血、大便发黑」，检索结果前三条却全是《基层 2 型糖尿病用药》——问题被「全部药名 + 全部诊断」拼成的长 query 淹没了。
- 根因：`search_kb` 的 query 把 `问题 + 主诉 + 全部药名 + 全部诊断` 一次性拼在一起。
- 修复：`buildRetrievalQuery()` —— 以「用户原话 + 主诉」为主体；只有当问题里**没有**提到任何药名（含商品名/俗名）时才补最多 3 个药名；缺失证据交给证据锚定按 docId 定向补齐。
- 验证（同一问题修复前后对比）：

| 排名 | 修复前 | 修复后 |
| --- | --- | --- |
| 1 | kb-diabetes-basics（糖尿病） | **kb-antiplatelet（抗血小板联用边界）** |
| 2 | kb-diabetes-basics（糖尿病） | **kb-nsaid-anticoag（抗凝 + NSAID）** |
| 3 | kb-diabetes-basics（糖尿病） | **kb-anticoag-bleeding（抗凝出血监测）** |

同时把 `topK` 从 6 提到 8，引用数由 9 条增加到 11 条，证据面板与正文角标的对应关系更完整。

---

## 8. 已知限制（诚实记录）

1. `next build` 在本机偶发失败（`Invariant: no direct app page entry found for /_not-found`、`.nft.json` ENOENT），间隔重试即可通过；根因指向上层目录存在多余 `package-lock.json` 与杀软对 `.next` 的实时扫描，已通过 `outputFileTracingRoot` 固定工作区根目录缓解，正式构建前建议清理 `.next`。
2. `next build` 与 `next dev` 共用 `.next` 时可能互相污染；切换前清理 `.next` 最稳。
3. 首次 `npm run dev` 冷启动编译约 15–20 秒，之后热更新。
4. 未配置视觉模型时，`/api/vision` 返回演示识别结果，并在 UI 上标注「演示模式」。
5. 未接入数据库；`logs/` 在只读部署（如 Serverless）下静默降级为内存轨迹（代码已 try/catch）。
