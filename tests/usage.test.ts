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

  it('Anthropic: input_tokens는 캐시 제외분 — 총 입력 = input + 캐시 읽기 + 캐시 쓰기', () => {
    expect(
      normalizeUsage({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 30 }),
    ).toEqual({ input: 130, output: 50, cachedInput: 30 });
    expect(
      normalizeUsage({
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 1000,
        cache_creation: { ephemeral_5m_input_tokens: 600, ephemeral_1h_input_tokens: 400 },
      }),
    ).toEqual({ input: 1010, output: 5, cachedInput: 0, cacheWrite: 1000, cacheWrite1h: 400 });
  });

  it('Responses API input_tokens(캐시 포함 총합)는 그대로 둔다', () => {
    expect(
      normalizeUsage({
        input_tokens: 100,
        output_tokens: 5,
        input_tokens_details: { cached_tokens: 80 },
      }),
    ).toEqual({ input: 100, output: 5, cachedInput: 80 });
  });

  it('OpenAI Responses 캐시 쓰기(GPT-5.6+)는 cacheWrite로, 12시간 TTL 분량은 cacheWrite12h로', () => {
    // OpenAI 프롬프트 캐싱 가이드의 예시 응답 그대로 (2026-11-25)
    expect(
      normalizeUsage({
        input_tokens: 12000,
        output_tokens: 0,
        input_tokens_details: {
          cached_tokens: 4000,
          cache_write_tokens: 7000,
          cache_write_tokens_details: { ttl_30m_tokens: 3000, ttl_12h_tokens: 4000 },
        },
      }),
    ).toEqual({
      input: 12000,
      output: 0,
      cachedInput: 4000,
      cacheWrite: 7000,
      cacheWrite12h: 4000,
    });
    expect(
      normalizeUsage({
        input_tokens: 12000,
        output_tokens: 0,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 12000 },
      }),
    ).toEqual({ input: 12000, output: 0, cachedInput: 0, cacheWrite: 12000 });
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

  it('Cohere billed_units에서 정규화한다 (raw tokens 아님)', () => {
    expect(
      normalizeUsage({
        billed_units: { input_tokens: 100, output_tokens: 50 },
        tokens: { input_tokens: 999, output_tokens: 999 },
        cached_tokens: 20,
      }),
    ).toEqual({ input: 100, output: 50, cachedInput: 20 });
  });

  it('usage가 없거나 모르는 형태면 UnknownUsageShapeError를 던진다 (조용히 0 반환 금지)', () => {
    expect(() => normalizeUsage(undefined)).toThrow(UnknownUsageShapeError);
    expect(() => normalizeUsage(null)).toThrow(UnknownUsageShapeError);
    expect(() => normalizeUsage({ foo: 1 })).toThrow(UnknownUsageShapeError);
  });
});
