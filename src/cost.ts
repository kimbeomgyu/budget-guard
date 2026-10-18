import { PRICES } from './pricing.js';
import type { Usage } from './types.js';

// Bedrock cross-region inference profiles prefix the model id with a region.
const REGION_PREFIX = /^(us|eu|apac|global)\./;

/** 가격표에 없는 모델로 정산하려 할 때. definePrice()로 등록하거나 PRICES에 추가. */
export class UnknownModelError extends Error {
  constructor(public model: string) {
    super(`Unknown model: ${model}. Register it with definePrice() or add it to PRICES.`);
    this.name = 'UnknownModelError';
  }
}

/**
 * 토큰 사용량을 가격표 기준 USD 비용으로 환산한다.
 * cachedInput이 있으면 그 부분은 cachedIn 요율(없으면 in)로, 나머지 입력은 in 요율로 과금한다.
 */
export function cost(model: string, usage: Usage): number {
  const base = PRICES[model] ?? PRICES[model.replace(REGION_PREFIX, '')];
  if (!base) throw new UnknownModelError(model);
  // 긴 프롬프트 구간제: 입력이 문턱을 넘으면 그 요청 전체(입력·캐시·출력)가 상위 요율.
  const lc = base.longContext;
  const p = lc && usage.input > lc.above ? { ...base, ...lc } : base;
  const cached = usage.cachedInput ?? 0;
  const uncachedInput = Math.max(0, usage.input - cached);
  const cachedRate = p.cachedIn ?? p.in;
  // reasoningInOutput=false 제공자(xAI/Gemini)는 output 카운트에 reasoning이 빠져 있어 가산.
  const extraReasoning = p.reasoningInOutput === false ? (usage.reasoning ?? 0) : 0;
  // 캐시 쓰기는 input에 1×로 이미 들어 있으니 할증분만 더한다: 5분 TTL +0.25×, 1시간 TTL +1×.
  const write1h = usage.cacheWrite1h ?? 0;
  const writePremium = ((usage.cacheWrite ?? 0) - write1h) * 0.25 + write1h;
  return (
    (uncachedInput / 1000) * p.in +
    (cached / 1000) * cachedRate +
    (writePremium / 1000) * p.in +
    ((usage.output + extraReasoning) / 1000) * p.out
  );
}
