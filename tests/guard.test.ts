import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetDefaultStore, BudgetExceededError, guard, spendReport } from '../src/guard';
import { MemoryStore } from '../src/store';
import { UnknownUsageShapeError } from '../src/usage';

const fixedNow = () => new Date('2026-06-28T10:00:00Z');

// gpt-4o, 1000 in / 1000 out = 0.0025 + 0.01 = 0.0125 USD per call
function fakeClient(usage = { input: 1000, output: 1000 }) {
  return { create: async () => ({ usage }) };
}

beforeEach(() => __resetDefaultStore());

describe('guard()', () => {
  it('정상 호출은 통과시키고 응답을 그대로 돌려준다', async () => {
    const ai = guard(fakeClient(), { project: 'p', dailyCapUSD: 1 }, { now: fixedNow });
    const res = await ai.create({ model: 'gpt-4o' });
    expect(res.usage.input).toBe(1000);
  });

  it('하루 캡을 넘으면 다음 호출을 차단한다 (block)', async () => {
    const ai = guard(fakeClient(), { project: 'p', dailyCapUSD: 0.02 }, { now: fixedNow });
    await ai.create({ model: 'gpt-4o' }); // spent 0 → ok, now 0.0125
    await ai.create({ model: 'gpt-4o' }); // spent 0.0125 < 0.02 → ok, now 0.025
    await expect(ai.create({ model: 'gpt-4o' })).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("onCap:'warn'이면 차단하지 않는다", async () => {
    const ai = guard(
      fakeClient(),
      { project: 'p', dailyCapUSD: 0, onCap: 'warn' },
      { now: fixedNow },
    );
    await expect(ai.create({ model: 'gpt-4o' })).resolves.toBeTruthy();
  });

  it('기능(feature)별로 비용을 귀속한다', async () => {
    const ai = guard(fakeClient(), { project: 'p', dailyCapUSD: 99 }, { now: fixedNow });
    await ai.create({ model: 'gpt-4o' }, { feature: 'summarize' });
    await ai.create({ model: 'gpt-4o' }, { feature: 'summarize' });
    await ai.create({ model: 'gpt-4o' }, { feature: 'embed' });
    const rep = await spendReport('p', '2026-06-28');
    expect(rep.summarize).toBeCloseTo(0.025, 6);
    expect(rep.embed).toBeCloseTo(0.0125, 6);
  });

  it('estimateUsage가 있으면 넘길 호출을 그 호출에서 차단한다 (overshoot 방지)', async () => {
    // 호출당 추정 0.0125, 캡 0.02. 1번째 ok(→0.0125). 2번째: 0.0125+0.0125=0.025 > 0.02 → 차단.
    const est = () => ({ input: 1000, output: 1000 });
    const ai = guard(
      fakeClient(),
      { project: 'est', dailyCapUSD: 0.02, estimateUsage: est },
      { now: fixedNow },
    );
    await ai.create({ model: 'gpt-4o' });
    await expect(ai.create({ model: 'gpt-4o' })).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('넘긴 store로 격리된다 (기본 전역과 분리)', async () => {
    const s = new MemoryStore();
    const ai = guard(
      fakeClient(),
      { project: 'iso', dailyCapUSD: 99, store: s },
      { now: fixedNow },
    );
    await ai.create({ model: 'gpt-4o' }, { feature: 'x' });
    expect(await spendReport('iso', '2026-06-28', s)).toHaveProperty('x');
    expect(await spendReport('iso', '2026-06-28')).toEqual({}); // 기본 전역엔 없음
  });

  it('onSpend 콜백을 성공 호출마다 비용 이벤트와 함께 호출한다 (누적 반영)', async () => {
    const events: Array<{
      project: string;
      feature: string;
      model: string;
      usd: number;
      dayTotalUsd: number;
    }> = [];
    const ai = guard(
      fakeClient(),
      { project: 'obs', dailyCapUSD: 99, onSpend: (e) => events.push(e) },
      { now: fixedNow },
    );
    await ai.create({ model: 'gpt-4o' }, { feature: 'summarize' });
    await ai.create({ model: 'gpt-4o' }, { feature: 'embed' });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ project: 'obs', feature: 'summarize', model: 'gpt-4o' });
    expect(events[0].usd).toBeCloseTo(0.0125, 6);
    expect(events[0].dayTotalUsd).toBeCloseTo(0.0125, 6);
    // dayTotalUsd는 project 누적 — 두 번째 이벤트는 두 호출 합계.
    expect(events[1].feature).toBe('embed');
    expect(events[1].dayTotalUsd).toBeCloseTo(0.025, 6);
  });

  it('onExceeded 콜백을 캡 초과 시 컨텍스트와 함께 호출한다', async () => {
    const calls: Array<{ project: string; spentUsd: number; capUsd: number }> = [];
    const ai = guard(
      fakeClient(),
      { project: 'cb', dailyCapUSD: 0, onExceeded: (info) => calls.push(info) },
      { now: fixedNow },
    );
    await expect(ai.create({ model: 'gpt-4o' })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls).toEqual([{ project: 'cb', spentUsd: 0, capUsd: 0 }]);
  });

  describe('onMissingUsage', () => {
    // usage 없는 응답을 주는 클라이언트
    const noUsageClient = { create: async () => ({ id: 'x', choices: [] }) };

    afterEach(() => vi.restoreAllMocks());

    it('기본값은 usage 누락 시 UnknownUsageShapeError를 던진다', async () => {
      const ai = guard(noUsageClient, { project: 'mu', dailyCapUSD: 99 }, { now: fixedNow });
      await expect(ai.create({ model: 'gpt-4o' })).rejects.toBeInstanceOf(UnknownUsageShapeError);
    });

    it("'zero'면 던지지 않고 $0로 청구하며 경고를 남긴다", async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const s = new MemoryStore();
      const ai = guard(
        noUsageClient,
        { project: 'mu', dailyCapUSD: 99, store: s, onMissingUsage: 'zero' },
        { now: fixedNow },
      );
      await expect(ai.create({ model: 'gpt-4o' }, { feature: 'f' })).resolves.toBeTruthy();
      const rep = await spendReport('mu', '2026-06-28', s);
      expect(rep.f).toBe(0); // $0로 적립
      expect(warn).toHaveBeenCalledOnce();
    });

    it("'zero'는 캡을 넘기지 않으므로 이후 호출을 막지 않는다", async () => {
      const s = new MemoryStore();
      const ai = guard(
        noUsageClient,
        { project: 'mu', dailyCapUSD: 0.01, store: s, onMissingUsage: 'zero' },
        { now: fixedNow },
      );
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await ai.create({ model: 'gpt-4o' });
      await expect(ai.create({ model: 'gpt-4o' })).resolves.toBeTruthy(); // 여전히 0 → 안 막힘
    });
  });
});
