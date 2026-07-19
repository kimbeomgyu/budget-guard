import { describe, expect, it } from 'vitest';
import { cost, UnknownModelError } from '../src/cost';
import { guard } from '../src/guard';
import { definePrice } from '../src/pricing';
import { MemoryStore } from '../src/store';
import type { SpendEvent, Usage } from '../src/types';

const SOME_USAGE: Usage = { input: 1000, output: 1000 };

const clientFor = (usage: Usage = SOME_USAGE) => ({
  calls: 0,
  async create(_args: { model: string }) {
    this.calls++;
    return { usage };
  },
});

describe('definePrice (BYO 가격)', () => {
  it('등록하면 cost()가 즉시 인식한다', () => {
    expect(() => cost('acme-9000', SOME_USAGE)).toThrow(UnknownModelError);
    definePrice('acme-9000', { in: 0.001, out: 0.002 });
    expect(cost('acme-9000', SOME_USAGE)).toBeCloseTo(0.003, 10);
  });

  it('음수/누락 단가는 거부한다', () => {
    expect(() => definePrice('bad', { in: -1, out: 0 })).toThrow();
    // @ts-expect-error out 누락
    expect(() => definePrice('bad2', { in: 0.001 })).toThrow();
  });
});

describe("onUnknownModel: 'zero' (미등록 모델 정책)", () => {
  it("기본은 throw — 성공한 호출이라도 정산 시점에 UnknownModelError", async () => {
    const ai = guard(clientFor(), {
      project: 'um',
      dailyCapUSD: 5,
      store: new MemoryStore(),
    });
    await expect(ai.create({ model: 'mystery-model' })).rejects.toThrow(UnknownModelError);
  });

  it("'zero'면 경고 후 $0 청구, 앱 흐름 유지 (onMissingUsage 'zero'와 동일 규약)", async () => {
    const events: SpendEvent[] = [];
    const client = clientFor();
    const ai = guard(client, {
      project: 'um2',
      dailyCapUSD: 5,
      store: new MemoryStore(),
      onUnknownModel: 'zero',
      onSpend: (e) => events.push(e),
    });
    const res = await ai.create({ model: 'mystery-model' });
    expect(res).toHaveProperty('usage');
    expect(client.calls).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].usd).toBe(0);
  });

  it("'zero' + estimateUsage여도 사전 추정 단계에서 죽지 않는다", async () => {
    const ai = guard(clientFor(), {
      project: 'um3',
      dailyCapUSD: 5,
      store: new MemoryStore(),
      onUnknownModel: 'zero',
      estimateUsage: () => SOME_USAGE,
    });
    await expect(ai.create({ model: 'mystery-model' })).resolves.toHaveProperty('usage');
  });
});
