/**
 * budget-guard/testing — 소비자가 자기 앱의 예산 로직을 테스트할 때 쓰는 헬퍼.
 * 프로덕션 코드에서 import하지 말 것.
 */
import type { SpendStore } from './store.js';
import { MemoryStore } from './store.js';

/** OpenAI 형태 usage 팩토리. 기본 0, 필요한 필드만 덮어쓴다. */
export function buildOpenAIUsage(
  overrides: Partial<{
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details: { cached_tokens?: number };
    completion_tokens_details: { reasoning_tokens?: number };
  }> = {},
) {
  return { prompt_tokens: 0, completion_tokens: 0, ...overrides };
}

/** Anthropic 형태 usage 팩토리. 기본 0, 필요한 필드만 덮어쓴다. */
export function buildAnthropicUsage(
  overrides: Partial<{
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
  }> = {},
) {
  return { input_tokens: 0, output_tokens: 0, ...overrides };
}

/**
 * 고정 시계. guard()의 internals.now에 꽂으면 일/월 경계 테스트가 결정적이 된다.
 * @example guard(client, opts, { now: createFixedClock('2026-01-31T23:59:00Z') })
 */
export function createFixedClock(iso: string): () => Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`createFixedClock: invalid ISO date "${iso}"`);
  return () => new Date(d);
}

/** FakeSpendStore가 기록하는 연산 로그 항목. */
export interface SpendOp {
  op: 'add' | 'get' | 'entries' | 'addIfUnder';
  key?: string;
  amountUSD?: number;
  capUSD?: number;
}

/** 모든 연산을 기록하는 SpendStore (MemoryStore 위임). 호출 순서·인자 검증용. */
export class FakeSpendStore implements SpendStore {
  readonly ops: SpendOp[] = [];
  private inner = new MemoryStore();
  add(key: string, amountUSD: number): number {
    this.ops.push({ op: 'add', key, amountUSD });
    return this.inner.add(key, amountUSD);
  }
  get(key: string): number {
    this.ops.push({ op: 'get', key });
    return this.inner.get(key);
  }
  entries(prefix: string): Array<[string, number]> {
    this.ops.push({ op: 'entries', key: prefix });
    return this.inner.entries(prefix);
  }
  addIfUnder(key: string, amountUSD: number, capUSD: number): number {
    this.ops.push({ op: 'addIfUnder', key, amountUSD, capUSD });
    return this.inner.addIfUnder(key, amountUSD, capUSD);
  }
  clear(): void {
    this.inner.clear();
    this.ops.length = 0;
  }
}

/**
 * 같은 키에 n개의 add를 동시에 날려 최종 누적값을 돌려준다.
 * 커스텀 SpendStore 구현의 원자성(경쟁 add 합산 정확성) 검증용.
 */
export async function simulateConcurrentIncrements(
  store: SpendStore,
  key: string,
  n: number,
  amountUSD: number,
): Promise<number> {
  await Promise.all(Array.from({ length: n }, () => store.add(key, amountUSD)));
  return store.get(key);
}
