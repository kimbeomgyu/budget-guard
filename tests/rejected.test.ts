import { describe, expect, it } from 'vitest';
import { BudgetExceededError, guard } from '../src/guard';
import { MemoryStore } from '../src/store';
import type { RejectedEvent, Usage } from '../src/types';

// gpt-4o out $0.01/1K → 10000 out tokens = $0.10
const TEN_CENTS: Usage = { input: 0, output: 10000 };

const okClient = () => ({
  calls: 0,
  async create(_args: { model: string }) {
    this.calls++;
    return { usage: TEN_CENTS };
  },
});

const todayKey = (project: string) =>
  `${project}|__total__|${new Date().toISOString().slice(0, 10)}`;

describe('onRejected (dead-letter 훅, #54)', () => {
  it('예약 경로: 차단된 호출의 요청 원본·추정 비용이 이벤트로 나온다', async () => {
    const store = new MemoryStore();
    store.add(todayKey('dlq'), 10); // 이미 초과
    const rejected: RejectedEvent[] = [];
    const client = okClient();
    const ai = guard(client, {
      project: 'dlq',
      dailyCapUSD: 5,
      store,
      estimateUsage: () => TEN_CENTS,
      onRejected: (e) => rejected.push(e),
    });
    const args = { model: 'gpt-4o', messages: [{ role: 'user', content: '비싼 프롬프트' }] };
    await expect(ai.create(args, { feature: 'enrich' })).rejects.toThrow(BudgetExceededError);
    expect(client.calls).toBe(0); // 제공자로 안 나감
    expect(rejected).toHaveLength(1);
    expect(rejected[0].project).toBe('dlq');
    expect(rejected[0].feature).toBe('enrich');
    expect(rejected[0].model).toBe('gpt-4o');
    expect(rejected[0].capUsd).toBe(5);
    expect(rejected[0].estimatedUsd).toBeCloseTo(0.1, 10);
    expect(rejected[0].args).toBe(args); // 원본 그대로 → 그대로 재실행 가능
  });

  it('비예약 경로(estimateUsage 없음)에서도 발화한다', async () => {
    const store = new MemoryStore();
    store.add(todayKey('dlq2'), 10);
    const rejected: RejectedEvent[] = [];
    const ai = guard(okClient(), {
      project: 'dlq2',
      dailyCapUSD: 5,
      store,
      onRejected: (e) => rejected.push(e),
    });
    await expect(ai.create({ model: 'gpt-4o' })).rejects.toThrow(BudgetExceededError);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].feature).toBe('default');
    expect(rejected[0].spentUsd).toBe(10);
    expect(rejected[0].estimatedUsd).toBeUndefined();
  });

  it("onCap 'warn'이면 호출이 통과하므로 발화하지 않는다", async () => {
    const store = new MemoryStore();
    store.add(todayKey('dlq3'), 10);
    const rejected: RejectedEvent[] = [];
    const client = okClient();
    const ai = guard(client, {
      project: 'dlq3',
      dailyCapUSD: 5,
      store,
      onCap: 'warn',
      onRejected: (e) => rejected.push(e),
    });
    await ai.create({ model: 'gpt-4o' });
    expect(client.calls).toBe(1);
    expect(rejected).toHaveLength(0);
  });
});
