import type { Usage } from './types.js';

/** normalizeUsage가 인식하지 못한(또는 없는) usage 형태에 대해 던지는 에러. */
export class UnknownUsageShapeError extends Error {
  constructor(public readonly received: unknown) {
    super('Unrecognized or missing usage shape. Pass a usageOf() extractor to guard().');
    this.name = 'UnknownUsageShapeError';
  }
}

type RawUsage = Record<string, unknown> & {
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
  cache_creation?: { ephemeral_1h_input_tokens?: number };
  billed_units?: { input_tokens?: number; output_tokens?: number };
};

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

function withExtras(base: Usage, cachedInput?: number, reasoning?: number): Usage {
  if (typeof cachedInput === 'number') base.cachedInput = cachedInput;
  if (typeof reasoning === 'number') base.reasoning = reasoning;
  return base;
}

/**
 * 제공자별 usage 형태를 {input, output}(+ 선택 cachedInput, reasoning)로 정규화한다.
 * 지원: 우리 형태 / OpenAI 계열(+ Azure Chat, Mistral, DeepSeek, xAI) / Anthropic /
 *       Azure Responses API / Google Gemini(usageMetadata) / AWS Bedrock Converse(camelCase).
 * 인식하지 못하면 조용히 0을 반환하지 않고 UnknownUsageShapeError를 던진다.
 */
export function normalizeUsage(raw: unknown): Usage {
  if (!raw || typeof raw !== 'object') throw new UnknownUsageShapeError(raw);
  const u = raw as RawUsage;

  // 우리 형태
  if (typeof u.input === 'number' && typeof u.output === 'number') {
    return withExtras({ input: u.input, output: u.output }, num(u.cachedInput), num(u.reasoning));
  }
  // OpenAI 계열 + Azure Chat Completions (prompt_tokens / completion_tokens)
  if (typeof u.prompt_tokens === 'number') {
    return withExtras(
      { input: u.prompt_tokens, output: num(u.completion_tokens) ?? 0 },
      num(u.prompt_tokens_details?.cached_tokens),
      num(u.completion_tokens_details?.reasoning_tokens),
    );
  }
  // Anthropic + Azure Responses API (input_tokens / output_tokens)
  if (typeof u.input_tokens === 'number') {
    // Anthropic의 input_tokens는 캐시 읽기·쓰기를 뺀 나머지 — 총 입력 = 셋의 합.
    // (Responses API의 input_tokens는 이미 캐시 포함 총합이고 이 필드들이 없다.)
    const read = num(u.cache_read_input_tokens);
    const write = num(u.cache_creation_input_tokens);
    if (read !== undefined || write !== undefined) {
      const usage: Usage = {
        input: u.input_tokens + (read ?? 0) + (write ?? 0),
        output: num(u.output_tokens) ?? 0,
      };
      if (read !== undefined) usage.cachedInput = read;
      if (write) {
        usage.cacheWrite = write;
        const w1h = num(u.cache_creation?.ephemeral_1h_input_tokens);
        if (w1h) usage.cacheWrite1h = w1h;
      }
      return usage;
    }
    return withExtras(
      { input: u.input_tokens, output: num(u.output_tokens) ?? 0 },
      num(u.cache_read_input_tokens) ?? num(u.input_tokens_details?.cached_tokens),
      num(u.output_tokens_details?.reasoning_tokens),
    );
  }
  // Google Gemini (usageMetadata) — promptTokenCount includes the cached subset
  if (typeof u.promptTokenCount === 'number') {
    return withExtras(
      { input: u.promptTokenCount, output: num(u.candidatesTokenCount) ?? 0 },
      num(u.cachedContentTokenCount),
      num(u.thoughtsTokenCount),
    );
  }
  // AWS Bedrock Converse (camelCase)
  if (typeof u.inputTokens === 'number') {
    return withExtras(
      { input: u.inputTokens, output: num(u.outputTokens) ?? 0 },
      num(u.cacheReadInputTokens),
      undefined,
    );
  }
  // Cohere — bill from `billed_units` (not the raw `tokens` field)
  if (u.billed_units && typeof u.billed_units === 'object') {
    const b = u.billed_units;
    if (typeof b.input_tokens === 'number') {
      return withExtras(
        { input: b.input_tokens, output: num(b.output_tokens) ?? 0 },
        num(u.cached_tokens),
        undefined,
      );
    }
  }
  throw new UnknownUsageShapeError(raw);
}
