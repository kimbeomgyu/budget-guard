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

  it('캐시 쓰기는 5분 TTL 1.25×, 1시간 TTL 2× in 요율 (input에 포함된 토큰 기준)', () => {
    // claude-sonnet-4-6 in 0.003: 쓰기 1000(그중 1h 400) → 600×1.25 + 400×2 = 1550 토큰분
    expect(
      cost('claude-sonnet-4-6', { input: 1000, output: 0, cacheWrite: 1000, cacheWrite1h: 400 }),
    ).toBeCloseTo((1550 / 1000) * 0.003, 10);
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

  describe('longContext 구간제', () => {
    it('문턱 이하는 기본 요율, 초과하면 요청 전체(입력·캐시·출력)가 상위 요율', () => {
      // claude-haiku-5-5: ≤100K $0.10/$0.50(캐시 $0.01), >100K $0.50/$2.50(캐시 $0.05) per MTok
      expect(cost('claude-haiku-5-5', { input: 100_000, output: 1000 })).toBeCloseTo(
        0.01 + 0.0005,
        8,
      );
      expect(
        cost('claude-haiku-5-5', { input: 100_001, output: 1000, cachedInput: 50_001 }),
      ).toBeCloseTo((50_000 / 1000) * 0.0005 + (50_001 / 1000) * 0.00005 + 0.0025, 8);
    });

    it('OpenAI 272K 문턱 — gpt-5.4 장문은 입력 2×·출력 1.5×', () => {
      const u = { input: 300_000, output: 1000 };
      expect(cost('gpt-5.4', u)).toBeCloseTo(300 * 0.005 + 0.0225, 8);
    });

    it('gpt-6.1-terra: 기본 $1/$5, 272K 초과 $2/$7.50 per MTok', () => {
      expect(cost('gpt-6.1-terra', { input: 1000, output: 1000 })).toBeCloseTo(0.001 + 0.005, 8);
      expect(cost('gpt-6.1-terra', { input: 300_000, output: 1000 })).toBeCloseTo(
        300 * 0.002 + 0.0075,
        8,
      );
    });

    it('xAI는 200K에 "도달"하면 상위 요율 — 정확히 200,000토큰부터 2배', () => {
      expect(cost('grok-4.3', { input: 199_999, output: 0 })).toBeCloseTo(199.999 * 0.00125, 8);
      expect(cost('grok-4.3', { input: 200_000, output: 0 })).toBeCloseTo(200 * 0.0025, 8);
      expect(cost('grok-4.7', { input: 200_000, output: 1000 })).toBeCloseTo(
        200 * 0.004 + 0.012,
        8,
      );
    });
  });

  describe('DeepSeek — 피크·오프피크 중 피크 요율로 계상', () => {
    it('deepseek-flash: $0.30/$1.20, 캐시 $0.006 per MTok', () => {
      expect(cost('deepseek-flash', { input: 1000, output: 1000 })).toBeCloseTo(0.0015, 8);
      expect(cost('deepseek-flash', { input: 1000, output: 0, cachedInput: 1000 })).toBeCloseTo(
        0.000006,
        10,
      );
    });

    it('옛 이름 deepseek-v4-flash는 Flash 가격으로 청구되므로 같은 요율', () => {
      const u = { input: 1000, output: 1000 };
      expect(cost('deepseek-v4-flash', u)).toBeCloseTo(cost('deepseek-flash', u), 10);
    });
  });

  it('2026-11 현행 모델 ID가 전부 가격표에 있다', () => {
    for (const m of [
      'claude-fable-5-1',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'gpt-6-astra',
      'gpt-6.1-sol',
      'gpt-6.1-terra',
      'gpt-6-luna',
      'gpt-5.5-pro',
      'gpt-5.2',
      'gpt-5.1',
      'gpt-5',
      'gpt-5-mini',
      'gpt-5-nano',
      'gemini-4-argon',
      'gemini-3.8-flash',
      'gemini-3.1-pro-preview',
      'grok-4.7',
      'grok-4.6',
      'grok-4.5',
      'deepseek-flash',
      'deepseek-v4-pro',
    ]) {
      expect(() => cost(m, { input: 1, output: 1 }), m).not.toThrow();
    }
  });
});
