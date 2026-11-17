import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatStream } from '@/lib/llm/provider';

function sseResponse(frames: string[]): Response {
  return new Response(frames.join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function collectStream(response: Response) {
  vi.stubEnv('LLM_PROVIDER', 'custom');
  vi.stubEnv('LLM_API_KEY', 'test-key');
  vi.stubEnv('LLM_BASE_URL', 'https://example.test/v1');
  vi.stubEnv('LLM_MODEL', 'test-model');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

  const chunks = [];
  for await (const chunk of chatStream([{ role: 'user', content: '测试' }])) {
    chunks.push(chunk);
  }
  return chunks;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('LLM 流式响应解析', () => {
  it('在 DONE 前回传服务端 usage，供运行记录统计真实 Token', async () => {
    const chunks = await collectStream(sseResponse([
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ]));

    expect(chunks).toEqual([
      { delta: '你好' },
      { delta: '', usage: { prompt: 12, completion: 3 } },
    ]);
  });

  it('上游未发送 DONE 时仍在流结束后回传 usage', async () => {
    const chunks = await collectStream(sseResponse([
      'data: {"choices":[{"delta":{"content":"完成"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2}}\n\n',
    ]));

    expect(chunks.at(-1)).toEqual({ delta: '', usage: { prompt: 8, completion: 2 } });
  });
});
