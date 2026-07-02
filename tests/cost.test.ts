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
});
