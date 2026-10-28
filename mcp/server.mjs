#!/usr/bin/env node
/**
 * 守药人 MCP Server（Model Context Protocol）
 * ==================================================================
 * 作用：把「用药安全工具链」外化成标准 MCP 能力，任何支持 MCP 的客户端
 * （Claude Desktop / Cursor / 自研 Agent）都能把本作品当作一个工具箱调用。
 *
 * 架构：本进程只负责协议层（tools/list、tools/call），
 *       实际计算通过 HTTP 桥调用 Next 服务端的 /api/mcp（工具实现唯一一份）。
 *
 * 启动：
 *   1) 另开终端启动 Web 服务：npm run dev   （默认 http://127.0.0.1:3000）
 *   2) 启动 MCP：npm run mcp
 *
 * 挂载到 Claude Desktop 的配置示例（claude_desktop_config.json）：
 *   {
 *     "mcpServers": {
 *       "mediguardian": {
 *         "command": "node",
 *         "args": ["C:/path/to/chuanzhi/mcp/server.mjs"],
 *         "env": { "MCP_API_BASE": "http://127.0.0.1:3000" }
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const API_BASE = (process.env.MCP_API_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');

/** 暴露的工具清单（inputSchema 需为 JSON Schema） */
const TOOLS = [
  {
    name: 'list_patients',
    description: '列出当前随访名单中的全部患者（含用药清单与相互作用摘要）。用于让外部 Agent 先感知可用对象。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'check_interaction',
    description:
      '对指定患者的全部在用药（可追加额外药名）做两两相互作用核查，返回严重程度、机制、处置建议与证据文档 id。',
    inputSchema: {
      type: 'object',
      properties: {
        patientId: { type: 'string', description: '患者 id，如 p-001' },
        extraText: { type: 'string', description: '额外描述，例如患者自行加服的药名' },
      },
      required: ['patientId'],
      additionalProperties: false,
    },
  },
  {
    name: 'lab_assess',
    description: '结合 eGFR、血钾、INR、血红蛋白、年龄与用药清单，输出结构化的用药风险发现（含严重程度与证据）。',
    inputSchema: {
      type: 'object',
      properties: { patientId: { type: 'string', description: '患者 id' } },
      required: ['patientId'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_kb',
    description: '在本地循证知识库中做混合检索（BM25 + 向量 + RRF + 重排），返回带编号的证据片段。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索问题，建议使用具体术语，如「华法林 布洛芬 出血」' },
        topK: { type: 'number', description: '返回条数，默认 6' },
        patientId: { type: 'string', description: '患者 id（用于上下文，可选）' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'build_med_plan',
    description: '生成「保留 / 调整 / 停用 / 复查 / 教育」五段式用药重整与随访计划。',
    inputSchema: {
      type: 'object',
      properties: { patientId: { type: 'string', description: '患者 id' } },
      required: ['patientId'],
      additionalProperties: false,
    },
  },
];

/** 通过 HTTP 桥调用实际工具实现 */
async function callBridge(tool, patientId, args) {
  const res = await fetch(`${API_BASE}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, patientId, args }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`bridge ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const server = new Server(
  { name: 'mediguardian', version: '1.2.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    if (name === 'list_patients') {
      const res = await fetch(`${API_BASE}/api/patients`);
      if (!res.ok) throw new Error(`bridge ${res.status}`);
      const data = await res.json();
      const digest = (data.patients || []).map((b) => ({
        id: b.patient.id,
        name: b.patient.name,
        age: b.patient.age,
        medCount: b.meds.length,
        highRiskInteractions: b.interactions.filter((i) => i.severity === 'high').length,
        chiefComplaint: b.patient.chiefComplaint,
      }));
      return { content: [{ type: 'text', text: JSON.stringify({ count: digest.length, patients: digest }, null, 2) }] };
    }

    const patientId = args.patientId || 'p-001';
    const payload = await callBridge(name, patientId, args);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { tool: name, summary: payload.summary, data: payload.data, evidence: payload.hits },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `工具执行失败：${error instanceof Error ? error.message : String(error)}\n提示：请确认 Web 服务已启动（npm run dev），或设置 MCP_API_BASE。`,
        },
      ],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[mediguardian-mcp] ready · bridge=${API_BASE}`);
