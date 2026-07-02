import { describe, expect, it } from 'vitest';
import { normalizeUsage, UnknownUsageShapeError } from '../src/usage';

describe('normalizeUsage()', () => {
  it('우리 형태 {input,output}를 그대로 받는다', () => {
    expect(normalizeUsage({ input: 10, output: 20 })).toEqual({ input: 10, output: 20 });
  });

  it('OpenAI 형태(prompt_tokens/completion_tokens)를 정규화한다', () => {
    expect(normalizeUsage({ prompt_tokens: 10, completion_tokens: 20 })).toEqual({
      input: 10,
      output: 20,
    });
  });

  it('Anthropic 형태(input_tokens/output_tokens)를 정규화한다', () => {
    expect(normalizeUsage({ input_tokens: 10, output_tokens: 20 })).toEqual({
      input: 10,
      output: 20,
    });
  });

  it('OpenAI 캐시/추론 토큰을 cachedInput/reasoning으로 추출한다', () => {
    expect(
      normalizeUsage({
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 80 },
        completion_tokens_details: { reasoning_tokens: 20 },
      }),
    ).toEqual({ input: 100, output: 50, cachedInput: 80, reasoning: 20 });
  });

  it('Anthropic cache_read_input_tokens를 cachedInput으로 추출한다', () => {
    expect(
      normalizeUsage({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 30 }),
    ).toEqual({ input: 100, output: 50, cachedInput: 30 });
  });

  it('Gemini usageMetadata를 정규화한다 (cachedContent→cachedInput, thoughts→reasoning)', () => {
    expect(
      normalizeUsage({
        promptTokenCount: 1000,
        candidatesTokenCount: 200,
        cachedContentTokenCount: 800,
        thoughtsTokenCount: 128,
      }),
    ).toEqual({ input: 1000, output: 200, cachedInput: 800, reasoning: 128 });
  });

  it('Bedrock Converse(camelCase)를 정규화한다', () => {
    expect(
      normalizeUsage({ inputTokens: 30, outputTokens: 628, cacheReadInputTokens: 10 }),
    ).toEqual({ input: 30, output: 628, cachedInput: 10 });
  });

  it('Azure Responses API(input_tokens + *_tokens_details)를 정규화한다', () => {
    expect(
      normalizeUsage({
        input_tokens: 16,
        output_tokens: 40,
        input_tokens_details: { cached_tokens: 8 },
        output_tokens_details: { reasoning_tokens: 12 },
      }),
    ).toEqual({ input: 16, output: 40, cachedInput: 8, reasoning: 12 });
  });

  it('usage가 없거나 모르는 형태면 UnknownUsageShapeError를 던진다 (조용히 0 반환 금지)', () => {
    expect(() => normalizeUsage(undefined)).toThrow(UnknownUsageShapeError);
    expect(() => normalizeUsage(null)).toThrow(UnknownUsageShapeError);
    expect(() => normalizeUsage({ foo: 1 })).toThrow(UnknownUsageShapeError);
  });
});
