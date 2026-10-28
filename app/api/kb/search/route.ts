import { getKbStats, searchKb } from '@/lib/rag';

/**
 * 检索调试接口
 * ------------------------------------------------------------------
 * 用途：
 *  1. /arch 架构页的「实时检索演示」，访客可以现场输入任意术语看命中证据与打分明细；
 *  2. scripts/eval-retrieval.mjs 用它跑离线评测（Hit@1 / MRR），
 *     把「RAG 检索策略是否合理」量化成数字，写进技术文档。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { query?: string; topK?: number; docIds?: string[] };
  const query = body.query?.trim();
  if (!query) return Response.json({ error: 'query 不能为空', hits: [] }, { status: 400 });

  const hits = await searchKb(query, {
    topK: Math.min(Number(body.topK ?? 6), 12),
    docIds: body.docIds,
  });

  return Response.json({
    query,
    count: hits.length,
    hits: hits.map((h) => ({
      chunkId: h.chunkId,
      docId: h.docId,
      title: h.title,
      section: h.section,
      score: h.score,
      scoreBreakdown: h.scoreBreakdown,
      snippet: h.text.replace(/^#+\s*/gm, '').slice(0, 160),
    })),
  });
}

export async function GET() {
  const stats = await getKbStats();
  return Response.json(stats);
}
