import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cost } from '../src/cost';
import { __resetDefaultStore, BudgetExceededError, spendReport } from '../src/guard';
import { MemoryStore } from '../src/store';
import { budgetGuardMiddleware } from '../src/vercel';

beforeEach(() => __resetDefaultStore());

const model = { modelId: 'gpt-4o' };
// v5 usage: 1000 in / 1000 out = $0.0125
const okGen = () =>
  Promise.resolve({ content: [], usage: { inputTokens: 1000, outputTokens: 1000 } });

describe('budgetGuardMiddleware (Vercel AI SDK v5)', () => {
  it('doGenerate 후 usage로 비용을 정산한다', async () => {
    const s = new MemoryStore();
    const mw = budgetGuardMiddleware({ project: 'v', dailyCapUSD: 99, store: s, feature: 'chat' });
    await mw.wrapGenerate({ doGenerate: okGen, model });
    const rep = await spendReport('v', undefined, s);
    expect(rep.chat).toBeCloseTo(0.0125, 6);
  });

  it('캡을 넘으면 doGenerate 실행 전에 throw한다', async () => {
    const s = new MemoryStore();
    const mw = budgetGuardMiddleware({ project: 'cap', dailyCapUSD: 0.01, store: s });
    await mw.wrapGenerate({ doGenerate: okGen, model }); // 0.0125 → 캡 초과
    const spy = vi.fn(okGen);
    await expect(mw.wrapGenerate({ doGenerate: spy, model })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(spy).not.toHaveBeenCalled(); // 호출 전에 막힘
  });

  it('cachedInputTokens / reasoningTokens를 매핑한다', async () => {
    const s = new MemoryStore();
    const mw = budgetGuardMiddleware({ project: 'map', dailyCapUSD: 99, store: s, feature: 'f' });
    const gen = () =>
      Promise.resolve({
        usage: {
          inputTokens: 1000,
          outputTokens: 500,
          cachedInputTokens: 800,
          reasoningTokens: 100,
        },
      });
    await mw.wrapGenerate({ doGenerate: gen, model });
    const rep = await spendReport('map', undefined, s);
    expect(rep.f).toBeCloseTo(
      cost('gpt-4o', { input: 1000, output: 500, cachedInput: 800, reasoning: 100 }),
      10,
    );
  });
});
