import { afterEach, describe, expect, it } from 'vitest';
import { getLlmConfig } from '@/lib/llm/provider';

const envKeys = ['LLM_PROVIDER', 'LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'VISION_MODEL'] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('LLM provider capabilities', () => {
  it('does not treat DeepSeek text chat as a vision model', () => {
    process.env.LLM_PROVIDER = 'deepseek';
    process.env.LLM_API_KEY = 'test-key';
    delete process.env.VISION_MODEL;

    const config = getLlmConfig();
    expect(config.enabled).toBe(true);
    expect(config.visionEnabled).toBe(false);
    expect(config.visionModel).toBe('');
  });

  it('enables vision for presets or an explicit compatible model', () => {
    process.env.LLM_PROVIDER = 'qwen';
    process.env.LLM_API_KEY = 'test-key';
    delete process.env.VISION_MODEL;
    expect(getLlmConfig().visionEnabled).toBe(true);

    process.env.LLM_PROVIDER = 'deepseek';
    process.env.VISION_MODEL = 'compatible-vision-model';
    expect(getLlmConfig().visionEnabled).toBe(true);
  });
});
