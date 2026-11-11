import { describe, expect, it } from 'vitest';
import { PRICES } from '../src/pricing';

describe('PRICES table', () => {
  it('모든 행이 숫자 in/out을 갖고, 선택 필드(cachedIn/retiresOn)도 올바른 타입이다', () => {
    for (const [model, p] of Object.entries(PRICES)) {
      expect(typeof p.in, `${model}.in`).toBe('number');
      expect(typeof p.out, `${model}.out`).toBe('number');
      if (p.cachedIn !== undefined) expect(typeof p.cachedIn).toBe('number');
      if (p.retiresOn !== undefined) expect(typeof p.retiresOn).toBe('string');
      if (p.longContext !== undefined) {
        // 장문 요율은 기본보다 싸지 않고, 기본에 캐시 요율이 있으면 장문에도 있어야 한다(안 그러면 기본 캐시 요율이 섞임)
        expect(p.longContext.in, `${model}.longContext.in`).toBeGreaterThanOrEqual(p.in);
        expect(p.longContext.out, `${model}.longContext.out`).toBeGreaterThanOrEqual(p.out);
        if (p.cachedIn !== undefined) expect(typeof p.longContext.cachedIn).toBe('number');
      }
    }
  });
});

describe('다른 모델 요율로 청구되는 폐기 모델', () => {
  it('gemini-2.5-pro는 3.8-flash 요율보다 싸게 계상하지 않는다 (2026-12-01부터 그 요율로 청구)', () => {
    const old = PRICES['gemini-2.5-pro'];
    const billedAs = PRICES['gemini-3.8-flash'];
    expect(old.in).toBeGreaterThanOrEqual(billedAs.in);
    expect(old.out).toBeGreaterThanOrEqual(billedAs.out);
    expect(old.cachedIn).toBeGreaterThanOrEqual(billedAs.cachedIn as number);
  });
});
