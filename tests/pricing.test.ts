import { describe, expect, it } from 'vitest';
import { PRICES } from '../src/pricing';

describe('PRICES table', () => {
  it('모든 행이 숫자 in/out을 갖고, 선택 필드(cachedIn/retiresOn)도 올바른 타입이다', () => {
    for (const [model, p] of Object.entries(PRICES)) {
      expect(typeof p.in, `${model}.in`).toBe('number');
      expect(typeof p.out, `${model}.out`).toBe('number');
      if (p.cachedIn !== undefined) expect(typeof p.cachedIn).toBe('number');
      if (p.retiresOn !== undefined) expect(typeof p.retiresOn).toBe('string');
    }
  });
});
