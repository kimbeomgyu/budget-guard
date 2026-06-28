import type { Usage } from './types.js';

/**
 * 제공자별 usage 형태를 {input, output} 토큰으로 정규화한다.
 * - 우리 형태:  { input, output }
 * - OpenAI:    { prompt_tokens, completion_tokens }
 * - Anthropic: { input_tokens, output_tokens }
 * 인식 못 하면 guard()에 usageOf 추출기를 넘기라고 안내.
 */
export function normalizeUsage(raw: unknown): Usage {
  const u = raw as Record<string, number> | undefined | null;
  if (!u) {
    throw new Error('No usage on response. Pass a usageOf() extractor to guard().');
  }
  if (typeof u.input === 'number' && typeof u.output === 'number') {
    return { input: u.input, output: u.output };
  }
  if (typeof u.prompt_tokens === 'number') {
    return { input: u.prompt_tokens, output: u.completion_tokens ?? 0 };
  }
  if (typeof u.input_tokens === 'number') {
    return { input: u.input_tokens, output: u.output_tokens ?? 0 };
  }
  throw new Error('Unrecognized usage shape. Pass a usageOf() extractor to guard().');
}
