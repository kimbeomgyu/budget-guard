import { beforeEach, describe, expect, it } from 'vitest';
import { __resetDefaultStore, BudgetExceededError, spendReport } from '../src/guard';
import { guardLlamaIndex } from '../src/llamaindex';
import { MemoryStore } from '../src/store';

// 확인된 LlamaIndex.TS LLM 형태의 가짜 구현: metadata.model + chat(){ message, raw }.
function fakeLLM(raw: object) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    metadata: { model: 'gpt-4o', temperature: 0, topP: 1, contextWindow: 128000 },
    async chat(params: { stream?: boolean; [k: string]: unknown }) {
      calls.push(params);
      if (params?.stream) {
        return (async function* () {
          yield { delta: 'hi', raw: {} };
        })();
      }
      return { message: { role: 'assistant', content: 'hi' }, raw };
    },
    async complete() {
      return { text: 'done', raw: {} };
    },
  };
}

const openaiRaw = { usage: { prompt_tokens: 1000, completion_tokens: 1000 } }; // gpt-4o → $0.0125

beforeEach(() => __resetDefaultStore());

describe('guardLlamaIndex (LlamaIndex.TS)', () => {
  it('비스트리밍 chat: response.raw의 usage로 정산한다', async () => {
    const s = new MemoryStore();
    const g = guardLlamaIndex(fakeLLM(openaiRaw), {
      project: 'li',
      dailyCapUSD: 99,
      store: s,
      feature: 'c',
    });
    const res = (await g.chat({ messages: [] })) as { message: { content: string } };
    expect(res.message.content).toBe('hi');
    expect((await spendReport('li', undefined, s)).c).toBeCloseTo(0.0125, 6);
  });

  it('캡을 넘으면 chat이 하위 호출 전에 throw한다', async () => {
    const s = new MemoryStore();
    const llm = fakeLLM(openaiRaw);
    const g = guardLlamaIndex(llm, { project: 'cap', dailyCapUSD: 0.01, store: s });
    await g.chat({ messages: [] }); // 0.0125 → 캡 초과
    const before = llm.calls.length;
    await expect(g.chat({ messages: [] })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(llm.calls.length).toBe(before); // 하위 chat 미호출
  });

  it('스트리밍: 캡만 검사하고 통과한다(계량 안 함)', async () => {
    const s = new MemoryStore();
    const g = guardLlamaIndex(fakeLLM(openaiRaw), { project: 'st', dailyCapUSD: 99, store: s });
    const stream = (await g.chat({ messages: [], stream: true })) as AsyncIterable<unknown>;
    const chunks: unknown[] = [];
    for await (const c of stream) chunks.push(c);
    expect(chunks.length).toBeGreaterThan(0);
    expect(await spendReport('st', undefined, s)).toEqual({}); // 계량 안 함
  });

  it('스트리밍: 캡을 넘으면 throw한다', async () => {
    const s = new MemoryStore();
    const g = guardLlamaIndex(fakeLLM(openaiRaw), { project: 'stc', dailyCapUSD: 0.01, store: s });
    await g.chat({ messages: [] }); // 0.0125 → 캡 초과
    await expect(g.chat({ messages: [], stream: true })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it('다른 메서드/속성은 원본에 위임한다', async () => {
    const g = guardLlamaIndex(fakeLLM(openaiRaw), { project: 'd', dailyCapUSD: 99 });
    expect(g.metadata.model).toBe('gpt-4o');
    const c = (await g.complete()) as { text: string };
    expect(c.text).toBe('done');
  });
});
