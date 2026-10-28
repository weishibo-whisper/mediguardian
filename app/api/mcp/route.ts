import { getPatient, getPatientMedViews } from '@/lib/data';
import { TOOLS, toolCatalog } from '@/lib/tools';

/**
 * MCP 工具桥接端点
 * ------------------------------------------------------------------
 * 为什么需要它：MCP Server 需要在 Node 侧运行（stdio 传输），
 * 而工具实现是 TypeScript 且依赖 Next 的运行时数据层。
 * 因此采用「MCP Server（协议层） → HTTP 桥 → 本端点（实现层）」的结构：
 *  - 工具实现只有一份，端内 Agent 与外部 Agent 行为完全一致；
 *  - MCP Server 可以独立进程启动，也可以被 Claude Desktop / Cursor 直接挂载。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    transport: 'http',
    tools: toolCatalog(),
    usage: 'POST { "tool": "check_interaction", "patientId": "p-001", "args": {} }',
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    tool?: string;
    patientId?: string;
    args?: Record<string, unknown>;
  };

  const tool = body.tool ? TOOLS[body.tool] : undefined;
  if (!tool) {
    return Response.json({ error: `未知工具：${body.tool ?? '未指定'}`, available: Object.keys(TOOLS) }, { status: 400 });
  }

  const patientId = body.patientId ?? 'p-001';
  const patient = await getPatient(patientId);
  if (!patient) return Response.json({ error: `患者不存在：${patientId}` }, { status: 404 });

  const medViews = await getPatientMedViews(patient);
  try {
    const output = await tool.run(body.args ?? {}, { patient, medViews, runId: 'mcp-bridge' });
    return Response.json({
      tool: tool.name,
      title: tool.title,
      summary: output.summary,
      data: output.data ?? null,
      hits: output.hits?.map((h) => ({
        chunkId: h.chunkId,
        docId: h.docId,
        title: h.title,
        section: h.section,
        score: h.score,
      })) ?? null,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '工具执行失败' },
      { status: 500 },
    );
  }
}
