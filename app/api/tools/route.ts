import { toolCatalog } from '@/lib/tools';

/** 工具清单接口：供架构页展示，也方便外部 MCP 客户端发现能力 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const tools = toolCatalog();
  return Response.json({ count: tools.length, tools });
}
