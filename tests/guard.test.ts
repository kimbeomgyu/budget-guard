import { describe, it, expect, beforeEach } from 'vitest';
import { guard, spendReport, BudgetExceededError, _resetLedger } from '../src/guard';

const fixedNow = () => new Date('2026-06-28T10:00:00Z');

// gpt-4o, 1000 in / 1000 out = 0.0025 + 0.01 = 0.0125 USD per call
function fakeClient(usage = { input: 1000, output: 1000 }) {
  return { create: async () => ({ usage }) };
}

beforeEach(() => _resetLedger());

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
    const ai = guard(fakeClient(), { project: 'p', dailyCapUSD: 0, onCap: 'warn' }, { now: fixedNow });
    await expect(ai.create({ model: 'gpt-4o' })).resolves.toBeTruthy();
  });

  it('기능(feature)별로 비용을 귀속한다', async () => {
    const ai = guard(fakeClient(), { project: 'p', dailyCapUSD: 99 }, { now: fixedNow });
    await ai.create({ model: 'gpt-4o' }, { feature: 'summarize' });
    await ai.create({ model: 'gpt-4o' }, { feature: 'summarize' });
    await ai.create({ model: 'gpt-4o' }, { feature: 'embed' });
    const rep = spendReport('p', '2026-06-28');
    expect(rep.summarize).toBeCloseTo(0.025, 6);
    expect(rep.embed).toBeCloseTo(0.0125, 6);
  });
});
