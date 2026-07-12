import { describe, expect, it } from 'vitest';
import { guard, periodKey, spendReport } from '../src/guard';
import {
  buildAnthropicUsage,
  buildOpenAIUsage,
  createFixedClock,
  FakeSpendStore,
  simulateConcurrentIncrements,
} from '../src/testing';
import { normalizeUsage } from '../src/usage';

describe('budget-guard/testing', () => {
  it('usage 팩토리: 기본 0 + 오버라이드 적용, normalizeUsage와 맞물린다', () => {
    expect(normalizeUsage(buildOpenAIUsage())).toEqual({ input: 0, output: 0 });
    expect(normalizeUsage(buildOpenAIUsage({ prompt_tokens: 10, completion_tokens: 5 }))).toEqual({
      input: 10,
      output: 5,
    });
    expect(
      normalizeUsage(buildAnthropicUsage({ input_tokens: 7, cache_read_input_tokens: 3 })),
    ).toEqual({ input: 7, output: 0, cachedInput: 3 });
  });

  it('createFixedClock: 키 생성이 결정적이 된다 (일 경계 테스트)', async () => {
    const clock = createFixedClock('2026-01-31T23:59:00Z');
    expect(periodKey(clock())).toBe('2026-01-31');
    const store = new FakeSpendStore();
    const ai = guard(
      { create: async () => ({ usage: { input: 1000, output: 0 } }) },
      { project: 'clk', dailyCapUSD: 9, store },
      { now: clock },
    );
    await ai.create({ model: 'gpt-4o' }, { feature: 'f' });
    const rep = await spendReport('clk', '2026-01-31', store);
    expect(rep.f).toBeCloseTo(0.0025, 8);
    expect(() => createFixedClock('not-a-date')).toThrow(/invalid ISO/);
  });

  it('FakeSpendStore: 연산을 순서대로 기록한다', async () => {
    const store = new FakeSpendStore();
    const ai = guard(
      { create: async () => ({ usage: { input: 0, output: 1000 } }) },
      { project: 'ops', dailyCapUSD: 9, store },
    );
    await ai.create({ model: 'gpt-4o' });
    const kinds = store.ops.map((o) => o.op);
    expect(kinds[0]).toBe('get'); // 캡 검사
    expect(kinds).toContain('add'); // 정산
    store.clear();
    expect(store.ops).toHaveLength(0);
  });

  it('FakeSpendStore.addIfUnder도 기록·위임한다 (예약 경로 검증용)', async () => {
    const store = new FakeSpendStore();
    const ai = guard(
      { create: async () => ({ usage: { input: 0, output: 1000 } }) },
      { project: 'rsv', dailyCapUSD: 9, store, estimateUsage: () => ({ input: 0, output: 1000 }) },
    );
    await ai.create({ model: 'gpt-4o' });
    expect(store.ops[0].op).toBe('addIfUnder');
    expect(store.ops[0].capUSD).toBe(9);
  });

  it('simulateConcurrentIncrements: 경쟁 add 합산이 정확하다', async () => {
    const store = new FakeSpendStore();
    const total = await simulateConcurrentIncrements(store, 'k', 100, 0.01);
    expect(total).toBeCloseTo(1, 10);
  });
});
