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
});
