import { PRICES } from './pricing';
import type { Usage } from './types';

/** 토큰 사용량을 가격표 기준 USD 비용으로 환산한다. */
export function cost(model: string, usage: Usage): number {
  const p = PRICES[model];
  if (!p) throw new Error(`Unknown model: ${model}. Add it to PRICES in pricing.ts`);
  return (usage.input / 1000) * p.in + (usage.output / 1000) * p.out;
}
