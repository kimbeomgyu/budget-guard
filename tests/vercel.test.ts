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

  const streamParts = [
    { type: 'text-delta', delta: 'hi' },
    { type: 'finish', usage: { inputTokens: 1000, outputTokens: 1000 } }, // $0.0125
  ];
  const drain = async (s: AsyncIterable<unknown>) => {
    for await (const _p of s) void _p;
  };

  it('wrapStream: finish 파트의 usage로 정산하고 파트/rest는 그대로 통과한다', async () => {
    const s = new MemoryStore();
    const mw = budgetGuardMiddleware({ project: 'vs', dailyCapUSD: 99, store: s, feature: 'chat' });
    const doStream = async () => ({ stream: ReadableStream.from(streamParts), request: { x: 1 } });
    const out = await mw.wrapStream({ doStream, model });
    expect(out.request).toEqual({ x: 1 }); // ...rest 보존
    const seen: unknown[] = [];
    for await (const p of out.stream) seen.push(p);
    expect(seen).toHaveLength(2); // 파트 그대로 통과
    const rep = await spendReport('vs', undefined, s);
    expect(rep.chat).toBeCloseTo(0.0125, 6); // finish usage로 1회 정산
  });

  it('wrapStream: 캡을 넘으면 doStream 실행 전에 throw한다', async () => {
    const s = new MemoryStore();
    const mw = budgetGuardMiddleware({ project: 'vscap', dailyCapUSD: 0.01, store: s });
    const first = await mw.wrapStream({
      doStream: async () => ({ stream: ReadableStream.from(streamParts) }),
      model,
    });
    await drain(first.stream); // 0.0125 정산 → 캡 초과
    let called = 0;
    const spyStream = async () => {
      called++;
      return { stream: ReadableStream.from(streamParts) };
    };
    await expect(mw.wrapStream({ doStream: spyStream, model })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(called).toBe(0); // doStream 미실행
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

describe('budgetGuardMiddleware (Vercel AI SDK v7 — 중첩 usage 자동 감지)', () => {
  // v7 usage: inputTokens/outputTokens가 객체. output.total은 reasoning 포함 총계.
  const v7Usage = {
    inputTokens: { total: 1000, noCache: 200, cacheRead: 800, cacheWrite: 0 },
    outputTokens: { total: 500, text: 400, reasoning: 100 },
  };

  it('v7 중첩 usage → v5 평면과 같은 USD로 정산한다', async () => {
    const s = new MemoryStore();
    const mw = budgetGuardMiddleware({ project: 'v7', dailyCapUSD: 99, store: s, feature: 'f' });
    await mw.wrapGenerate({ doGenerate: async () => ({ usage: v7Usage }), model });
    const rep = await spendReport('v7', undefined, s);
    // input 1000(캐시 800) / output 500 — reasoning은 total에 이미 포함이므로 별도 가산 없음
    expect(rep.f).toBeCloseTo(cost('gpt-4o', { input: 1000, output: 500, cachedInput: 800 }), 10);
  });

  it('v7 wrapStream: finish 파트의 중첩 usage로 1회 정산한다', async () => {
    const s = new MemoryStore();
    const mw = budgetGuardMiddleware({ project: 'v7s', dailyCapUSD: 99, store: s, feature: 'f' });
    const parts = [
      { type: 'text-delta', delta: 'hi' },
      { type: 'finish', usage: v7Usage },
    ];
    const out = await mw.wrapStream({
      doStream: async () => ({ stream: ReadableStream.from(parts) }),
      model,
    });
    for await (const _p of out.stream) void _p;
    const rep = await spendReport('v7s', undefined, s);
    expect(rep.f).toBeCloseTo(cost('gpt-4o', { input: 1000, output: 500, cachedInput: 800 }), 10);
  });

  it('v7: total이 undefined인 중첩 usage는 0으로 계산한다 (제공자 미보고)', async () => {
    const s = new MemoryStore();
    const mw = budgetGuardMiddleware({ project: 'v7u', dailyCapUSD: 99, store: s, feature: 'f' });
    await mw.wrapGenerate({
      doGenerate: async () => ({
        usage: { inputTokens: { total: undefined }, outputTokens: { total: undefined } },
      }),
      model,
    });
    const rep = await spendReport('v7u', undefined, s);
    expect(rep.f).toBe(0);
  });
});
