/**
 * LLM Provider 抽象层
 * ------------------------------------------------------------------
 * 统一走 OpenAI 兼容协议（/chat/completions），因此 DeepSeek、智谱 GLM、
 * 通义千问、Moonshot、OpenAI、以及本地 vLLM/Ollama 都可以零改造接入。
 *
 * 关键设计：不使用各厂商私有的 function-calling 字段，而是用「结构化 JSON 工具协议」：
 * 规划阶段让模型输出 JSON（含工具名 + 参数），运行时解析 → 执行 → 回填。
 * 好处：任何 OpenAI 兼容模型都能跑 Agent 循环，评委换成自己的 key 也不会挂。
 */

export type ProviderName = 'mock' | 'openai' | 'deepseek' | 'zhipu' | 'qwen' | 'anthropic' | 'custom';

interface ProviderPreset {
  baseUrl: string;
  model: string;
  visionModel?: string;
}

const PRESETS: Record<Exclude<ProviderName, 'mock' | 'custom'>, ProviderPreset> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', visionModel: 'gpt-4o-mini' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  zhipu: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-plus',
    visionModel: 'glm-4v-plus',
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    visionModel: 'qwen-vl-plus',
  },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest' },
};

export interface LlmConfig {
  provider: ProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
  visionModel: string;
  temperature: number;
  enabled: boolean;
}

/** 读取环境变量，得到当前生效的 LLM 配置 */
export function getLlmConfig(): LlmConfig {
  const provider = (process.env.LLM_PROVIDER || 'mock').toLowerCase() as ProviderName;
  const preset = provider !== 'mock' && provider !== 'custom' ? PRESETS[provider] : undefined;
  const apiKey = process.env.LLM_API_KEY || '';
  const baseUrl = process.env.LLM_BASE_URL || preset?.baseUrl || '';
  const model = process.env.LLM_MODEL || preset?.model || '';
  const visionModel = process.env.VISION_MODEL || preset?.visionModel || model;
  return {
    provider,
    apiKey,
    baseUrl,
    model,
    visionModel,
    temperature: Number(process.env.LLM_TEMPERATURE ?? 0.2),
    // 未配置 key 时自动降级为本地规则引擎，保证演示永不空白
    enabled: provider !== 'mock' && Boolean(apiKey && baseUrl && model),
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 非流式补全（用于规划阶段拿结构化 JSON） */
export async function chatComplete(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; json?: boolean } = {},
): Promise<{ text: string; usage?: { prompt: number; completion: number } }> {
  const config = getLlmConfig();
  if (!config.enabled) throw new Error('LLM_NOT_CONFIGURED');

  const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: opts.temperature ?? config.temperature,
      max_tokens: opts.maxTokens ?? 1200,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      stream: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM_HTTP_${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    usage: data.usage
      ? { prompt: data.usage.prompt_tokens ?? 0, completion: data.usage.completion_tokens ?? 0 }
      : undefined,
  };
}

/** 流式补全：逐 token yield，SSE 解析 */
export async function* chatStream(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number } = {},
): AsyncGenerator<{ delta: string; usage?: { prompt: number; completion: number } }> {
  const config = getLlmConfig();
  if (!config.enabled) throw new Error('LLM_NOT_CONFIGURED');

  const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: opts.temperature ?? config.temperature,
      max_tokens: opts.maxTokens ?? 1600,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`LLM_HTTP_${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage: { prompt: number; completion: number } | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        if (json.usage) {
          usage = {
            prompt: json.usage.prompt_tokens ?? 0,
            completion: json.usage.completion_tokens ?? 0,
          };
        }
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield { delta };
      } catch {
        // 跳过心跳/非 JSON 行
      }
    }
  }
  if (usage) yield { delta: '', usage };
}

/**
 * 视觉模型：药盒/处方照片 → 结构化用药信息
 * 支持 base64 dataURL 输入，返回模型原始文本（上层再做 JSON 解析与校验）
 */
export async function visionExtract(imageDataUrl: string, hint: string): Promise<string> {
  const config = getLlmConfig();
  if (!config.enabled) throw new Error('LLM_NOT_CONFIGURED');

  const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.visionModel,
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `识别图片中的药品包装或处方信息。${hint}\n请输出 JSON：{"drugs":[{"name":"","dose":"","freq":"","confidence":0-1}],"raw":"识别到的原文"}`,
            },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      stream: false,
    }),
  });

  if (!res.ok) throw new Error(`VISION_HTTP_${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}
