import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetDefaultStore, BudgetExceededError, spendReport } from '../src/guard';
import { BudgetGuardHandler } from '../src/langchain';
import { MemoryStore } from '../src/store';
import { UnknownUsageShapeError } from '../src/usage';

beforeEach(() => __resetDefaultStore());

// LangChain LLMResult 형태들 (gpt-4o 1000/1000 = $0.0125)
const umResult = {
  generations: [
    [{ text: 'hi', message: { usage_metadata: { input_tokens: 1000, output_tokens: 1000 } } }],
  ],
  llmOutput: {},
};
const tuResult = {
  generations: [[{ text: 'hi' }]],
  llmOutput: { tokenUsage: { promptTokens: 1000, completionTokens: 1000 } },
};
const bothResult = {
  generations: [
    [{ text: 'hi', message: { usage_metadata: { input_tokens: 1000, output_tokens: 1000 } } }],
  ],
  llmOutput: { tokenUsage: { promptTokens: 5, completionTokens: 5 } },
};
const noUsage = { generations: [[{ text: 'x' }]], llmOutput: {} };

describe('BudgetGuardHandler (LangChain.js)', () => {
  it('handleLLMEnd: usage_metadata로 정산한다', async () => {
    const s = new MemoryStore();
    const h = new BudgetGuardHandler({
      project: 'lc',
      dailyCapUSD: 99,
      store: s,
      model: 'gpt-4o',
      feature: 'c',
    });
    await h.handleLLMEnd(umResult);
    expect((await spendReport('lc', undefined, s)).c).toBeCloseTo(0.0125, 6);
  });

  it('handleLLMEnd: usage_metadata 없으면 llmOutput.tokenUsage로 폴백', async () => {
    const s = new MemoryStore();
    const h = new BudgetGuardHandler({
      project: 'lc',
      dailyCapUSD: 99,
      store: s,
      model: 'gpt-4o',
      feature: 'c',
    });
    await h.handleLLMEnd(tuResult);
    expect((await spendReport('lc', undefined, s)).c).toBeCloseTo(0.0125, 6);
  });

  it('handleLLMEnd: 둘 다 있으면 usage_metadata만 쓰고 합치지 않는다', async () => {
    const s = new MemoryStore();
    const h = new BudgetGuardHandler({
      project: 'lc',
      dailyCapUSD: 99,
      store: s,
      model: 'gpt-4o',
      feature: 'c',
    });
    await h.handleLLMEnd(bothResult);
    expect((await spendReport('lc', undefined, s)).c).toBeCloseTo(0.0125, 6); // 1005/1005 아님
  });

  it('handleLLMEnd: model 미지정이면 response_metadata.model에서 추출', async () => {
    const s = new MemoryStore();
    const h = new BudgetGuardHandler({ project: 'm', dailyCapUSD: 99, store: s, feature: 'c' });
    await h.handleLLMEnd({
      generations: [
        [
          {
            text: 'hi',
            message: {
              usage_metadata: { input_tokens: 1000, output_tokens: 1000 },
              response_metadata: { model: 'gpt-4o' },
            },
          },
        ],
      ],
      llmOutput: {},
    });
    expect((await spendReport('m', undefined, s)).c).toBeCloseTo(0.0125, 6);
  });

  it('handleChatModelStart: 캡을 넘으면 throw한다', async () => {
    const s = new MemoryStore();
    const h = new BudgetGuardHandler({
      project: 'cap',
      dailyCapUSD: 0.01,
      store: s,
      model: 'gpt-4o',
    });
    await h.handleLLMEnd(umResult); // 0.0125 → 캡 초과
    await expect(h.handleChatModelStart()).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('handleLLMEnd: usage 없고 기본이면 UnknownUsageShapeError', async () => {
    const s = new MemoryStore();
    const h = new BudgetGuardHandler({ project: 'lc', dailyCapUSD: 99, store: s, model: 'gpt-4o' });
    await expect(h.handleLLMEnd(noUsage)).rejects.toBeInstanceOf(UnknownUsageShapeError);
  });

  it("handleLLMEnd: onMissingUsage='zero'면 경고 후 $0로 넘어간다", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new MemoryStore();
    const h = new BudgetGuardHandler({
      project: 'z',
      dailyCapUSD: 99,
      store: s,
      model: 'gpt-4o',
      feature: 'c',
      onMissingUsage: 'zero',
    });
    await h.handleLLMEnd(noUsage);
    expect((await spendReport('z', undefined, s)).c).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
