import { describe, expect, it } from 'vitest';
import { cost } from '../src/cost';

describe('cost()', () => {
  it('토큰 사용량을 가격표로 USD 비용으로 환산한다', () => {
    // gpt-4o: $0.0025/1K in, $0.01/1K out
    // 1000 in → 0.0025, 2000 out → 0.02  => 합 0.0225
    expect(cost('gpt-4o', { input: 1000, output: 2000 })).toBeCloseTo(0.0225, 6);
  });

  it('0 토큰이면 0달러', () => {
    expect(cost('gpt-4o-mini', { input: 0, output: 0 })).toBe(0);
  });

  it('모르는 모델이면 에러를 던진다', () => {
    expect(() => cost('not-a-real-model', { input: 1, output: 1 })).toThrow();
  });

  it('Bedrock 지역 프리픽스(us./eu.)는 기본 모델 행으로 해석된다', () => {
    const u = { input: 1000, output: 1000 };
    expect(cost('us.anthropic.claude-sonnet-4', u)).toBe(cost('anthropic.claude-sonnet-4', u));
    expect(cost('eu.anthropic.claude-sonnet-4', u)).toBeCloseTo(0.003 + 0.015, 6);
  });

  it('cachedInput은 cachedIn 요율로, 나머지 입력은 in 요율로 과금한다', () => {
    // claude-sonnet-4-6: in 0.003, cachedIn 0.0003. input 1000 중 800 캐시:
    // (200/1000)*0.003 + (800/1000)*0.0003 = 0.0006 + 0.00024 = 0.00084
    expect(cost('claude-sonnet-4-6', { input: 1000, output: 0, cachedInput: 800 })).toBeCloseTo(
      0.00084,
      8,
    );
  });

  it('cachedIn 요율이 없으면 캐시분도 in 요율로 과금한다', () => {
    // anthropic.claude-sonnet-4: cachedIn 없음 → cached도 in(0.003)
    expect(
      cost('anthropic.claude-sonnet-4', { input: 1000, output: 0, cachedInput: 500 }),
    ).toBeCloseTo(0.003, 8);
  });

  describe('reasoning-token 규약 (reasoningInOutput)', () => {
    it('xAI Grok: reasoning이 completion_tokens에서 제외 → output 요율로 가산 (100+400=500 과금)', () => {
      // grok-4.3 out 0.0025/1K → 500 out-class tokens = 0.00125
      expect(cost('grok-4.3', { input: 0, output: 100, reasoning: 400 })).toBeCloseTo(
        (500 / 1000) * 0.0025,
        8,
      );
    });

    it('OpenAI: reasoning이 이미 completion_tokens에 포함 → 이중과금하지 않는다 (500 그대로)', () => {
      // gpt-4.1 out 0.008/1K, reasoning 400은 output 500 안에 이미 포함된 카운트
      expect(cost('gpt-4.1', { input: 0, output: 500, reasoning: 400 })).toBeCloseTo(
        (500 / 1000) * 0.008,
        8,
      );
    });

    it('Gemini: thoughtsTokenCount는 candidatesTokenCount 밖 → output 요율로 가산', () => {
      // gemini-2.5-pro out 0.01/1K → (200+300)/1000*0.01
      expect(cost('gemini-2.5-pro', { input: 0, output: 200, reasoning: 300 })).toBeCloseTo(
        (500 / 1000) * 0.01,
        8,
      );
    });

    it('reasoning이 없으면 플래그와 무관하게 동일', () => {
      expect(cost('grok-4.3', { input: 1000, output: 1000 })).toBeCloseTo(0.00125 + 0.0025, 8);
    });
  });
});
