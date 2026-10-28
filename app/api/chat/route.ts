import type { SseEvent } from '@/lib/types';
import { runAgent } from '@/lib/agent/runtime';

/**
 * Agent 流式接口（SSE）
 * ------------------------------------------------------------------
 * 用原生 ReadableStream 而不是第三方 SDK：
 *  - 事件协议由我们自己定义（plan / step / tool_call / retrieval / token / safety / done），
 *    前端可以把「思考过程」逐步可视化，这是本作品交互创新的基础；
 *  - 不依赖厂商 SDK，换模型只需改环境变量。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { patientId?: string; question?: string; mode?: 'mock' | 'llm' | 'auto' };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const patientId = body.patientId?.trim();
  const question = body.question?.trim();
  if (!patientId || !question) {
    return Response.json({ error: '患者与问题不能为空' }, { status: 400 });
  }
  if (question.length > 1000) {
    return Response.json({ error: '问题过长（上限 1000 字）' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: SseEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        await runAgent({ patientId, question, mode: body.mode ?? 'auto', emit: send });
      } catch (error) {
        send({
          type: 'error',
          message: error instanceof Error ? error.message : 'Agent 运行异常',
        });
      } finally {
        if (!closed) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          closed = true;
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
