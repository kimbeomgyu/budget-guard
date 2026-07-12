import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  // 스트리밍용 가짜: 지정한 raw 시퀀스를 청크로 흘린다
  function fakeStreamLLM(raws: Array<object | null>) {
    return {
      metadata: { model: 'gpt-4o' },
      async chat(_params: { stream?: boolean }) {
        return (async function* () {
          for (const raw of raws) yield { delta: 'x', raw };
        })();
      },
    };
  }

  it('스트리밍(OpenAI raw): 최종 청크 usage로 1회 정산, 청크는 그대로 통과', async () => {
    const s = new MemoryStore();
    const g = guardLlamaIndex(fakeStreamLLM([{ usage: null }, { usage: null }, openaiRaw]), {
      project: 'sto',
      dailyCapUSD: 99,
      store: s,
      feature: 'c',
    });
    const stream = (await g.chat({ messages: [], stream: true })) as AsyncIterable<unknown>;
    const chunks: unknown[] = [];
    for await (const c of stream) chunks.push(c);
    expect(chunks).toHaveLength(3);
    expect((await spendReport('sto', undefined, s)).c).toBeCloseTo(0.0125, 6);
  });

  it('스트리밍(Anthropic raw 이벤트): start+delta 조립, 누적 output은 교체', async () => {
    const s = new MemoryStore();
    const g = guardLlamaIndex(
      fakeStreamLLM([
        { type: 'message_start', message: { usage: { input_tokens: 1000, output_tokens: 1 } } },
        { type: 'message_delta', usage: { output_tokens: 1000 } },
      ]),
      { project: 'sta', dailyCapUSD: 99, store: s, feature: 'c' },
    );
    for await (const _c of (await g.chat({ stream: true })) as AsyncIterable<unknown>) void _c;
    // 1000 in + 1000 out (1+1000 아님) = $0.0125
    expect((await spendReport('sta', undefined, s)).c).toBeCloseTo(0.0125, 6);
  });

  it('스트리밍(Gemini raw): 마지막 usageMetadata 누적본으로 정산', async () => {
    const s = new MemoryStore();
    const g = guardLlamaIndex(
      fakeStreamLLM([
        { usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 10 } },
        { usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 1000 } },
      ]),
      { project: 'stg', dailyCapUSD: 99, store: s, feature: 'c' },
    );
    for await (const _c of (await g.chat({ stream: true })) as AsyncIterable<unknown>) void _c;
    expect((await spendReport('stg', undefined, s)).c).toBeCloseTo(0.0125, 6);
  });

  it('스트리밍: usage가 어디에도 없으면 경고만 찍고 계량 없이 통과한다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new MemoryStore();
    const g = guardLlamaIndex(fakeStreamLLM([{}, null]), {
      project: 'stn',
      dailyCapUSD: 99,
      store: s,
    });
    const chunks: unknown[] = [];
    for await (const c of (await g.chat({ stream: true })) as AsyncIterable<unknown>)
      chunks.push(c);
    expect(chunks).toHaveLength(2); // 통과는 그대로
    expect(await spendReport('stn', undefined, s)).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
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
