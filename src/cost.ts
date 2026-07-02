import { PRICES } from './pricing.js';
import type { Usage } from './types.js';

// Bedrock cross-region inference profiles prefix the model id with a region.
const REGION_PREFIX = /^(us|eu|apac|global)\./;

/**
 * 토큰 사용량을 가격표 기준 USD 비용으로 환산한다.
 * cachedInput이 있으면 그 부분은 cachedIn 요율(없으면 in)로, 나머지 입력은 in 요율로 과금한다.
 */
export function cost(model: string, usage: Usage): number {
  const p = PRICES[model] ?? PRICES[model.replace(REGION_PREFIX, '')];
  if (!p) throw new Error(`Unknown model: ${model}. Add it to PRICES in pricing.ts`);
  const cached = usage.cachedInput ?? 0;
  const uncachedInput = Math.max(0, usage.input - cached);
  const cachedRate = p.cachedIn ?? p.in;
  return (
    (uncachedInput / 1000) * p.in + (cached / 1000) * cachedRate + (usage.output / 1000) * p.out
  );
}
