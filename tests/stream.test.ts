import { beforeEach, describe, expect, it } from 'vitest';
import { cost } from '../src/cost';
import { __resetDefaultStore, BudgetExceededError, guard, spendReport } from '../src/guard';
import { MemoryStore } from '../src/store';

const fixedNow = () => new Date('2026-06-28T10:00:00Z');

// 스트리밍 클라이언트 페이크: chunks를 순서대로 yield하고, 받은 args를 기록한다.
function fakeStreamClient(chunks: unknown[]) {
  const received: Array<Record<string, unknown>> = [];
  const client = {
    create: async (args: Record<string, unknown>) => {
      received.push(args);
      return (async function* () {
        for (const c of chunks) yield c;
      })();
    },
  };
  return { client, received };
}

async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

// gpt-4o, 1000 in / 1000 out = $0.0125
const finalUsageChunk = { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 1000 } };
const contentChunk = (i: number) => ({ choices: [{ delta: { content: `t${i}` } }], usage: null });

beforeEach(() => __resetDefaultStore());

describe('guard() streaming', () => {
  it('중간 null-usage 청크는 무시하고 최종 청크 usage로 1회만 정산한다', async () => {
    const chunks = [1, 2, 3, 4, 5].map(contentChunk).concat([finalUsageChunk as never]);
    const s = new MemoryStore();
    const { client } = fakeStreamClient(chunks);
    const ai = guard(client, { project: 'st', dailyCapUSD: 99, store: s }, { now: fixedNow });
    const stream = await ai.create({ model: 'gpt-4o', stream: true }, { feature: 'chat' });
    const seen = await drain(stream as AsyncIterable<unknown>);
    expect(seen).toHaveLength(6); // 모든 청크 그대로 통과
    const rep = await spendReport('st', '2026-06-28', s);
    expect(rep.chat).toBeCloseTo(0.0125, 6); // 1회만 정산
  });

  it('stream:true면 stream_options.include_usage를 주입한다', async () => {
    const { client, received } = fakeStreamClient([finalUsageChunk]);
    const ai = guard(client, { project: 'st', dailyCapUSD: 99 }, { now: fixedNow });
    const stream = await ai.create({ model: 'gpt-4o', stream: true });
    await drain(stream as AsyncIterable<unknown>);
    expect(received[0].stream).toBe(true);
    expect(received[0].stream_options).toEqual({ include_usage: true });
  });

  it('기존 stream_options는 보존하며 include_usage만 켠다', async () => {
    const { client, received } = fakeStreamClient([finalUsageChunk]);
    const ai = guard(client, { project: 'st', dailyCapUSD: 99 }, { now: fixedNow });
    const stream = await ai.create({ model: 'gpt-4o', stream: true, stream_options: { foo: 1 } });
    await drain(stream as AsyncIterable<unknown>);
    expect(received[0].stream_options).toEqual({ foo: 1, include_usage: true });
  });

  it('onSpend는 스트림을 다 소비한 뒤 1회 발생한다', async () => {
    const events: Array<{ feature: string; usd: number }> = [];
    const { client } = fakeStreamClient([contentChunk(1), finalUsageChunk]);
    const ai = guard(
      client,
      { project: 'st', dailyCapUSD: 99, onSpend: (e) => events.push(e) },
      { now: fixedNow },
    );
    const stream = await ai.create({ model: 'gpt-4o', stream: true }, { feature: 'chat' });
    expect(events).toHaveLength(0); // 아직 소비 전이면 정산 안 됨
    await drain(stream as AsyncIterable<unknown>);
    expect(events).toHaveLength(1);
    expect(events[0].feature).toBe('chat');
    expect(events[0].usd).toBeCloseTo(0.0125, 6);
  });

  it('Anthropic 스트리밍: message_start(input)+message_delta(누적 output)로 정산하고 output은 교체한다', async () => {
    const chunks = [
      { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 1 } } },
      { type: 'content_block_delta', delta: { text: '안녕' } },
      { type: 'message_delta', usage: { output_tokens: 120 } }, // 누적값
      { type: 'message_stop' },
    ];
    const s = new MemoryStore();
    const { client } = fakeStreamClient(chunks);
    const ai = guard(
      client,
      { project: 'ant', dailyCapUSD: 99, store: s, provider: 'anthropic' },
      { now: fixedNow },
    );
    const stream = await ai.create(
      { model: 'claude-sonnet-4-6', stream: true, max_tokens: 200 },
      { feature: 'chat' },
    );
    await drain(stream as AsyncIterable<unknown>);
    const rep = await spendReport('ant', '2026-06-28', s);
    // input 100 / output 120 로 청구 (1+120=121이 아님)
    expect(rep.chat).toBeCloseTo(cost('claude-sonnet-4-6', { input: 100, output: 120 }), 10);
    expect(rep.chat).not.toBeCloseTo(cost('claude-sonnet-4-6', { input: 100, output: 121 }), 10);
  });

  it('Anthropic 스트리밍의 캐시 읽기 토큰도 잡는다', async () => {
    const chunks = [
      {
        type: 'message_start',
        message: { usage: { input_tokens: 50, cache_read_input_tokens: 200, output_tokens: 1 } },
      },
      { type: 'message_delta', usage: { output_tokens: 30 } },
    ];
    const s = new MemoryStore();
    const { client } = fakeStreamClient(chunks);
    const ai = guard(
      client,
      { project: 'ant', dailyCapUSD: 99, store: s, provider: 'anthropic' },
      { now: fixedNow },
    );
    const stream = await ai.create({ model: 'claude-sonnet-4-6', stream: true }, { feature: 'c' });
    await drain(stream as AsyncIterable<unknown>);
    const rep = await spendReport('ant', '2026-06-28', s);
    expect(rep.c).toBeCloseTo(
      cost('claude-sonnet-4-6', { input: 50, output: 30, cachedInput: 200 }),
      10,
    );
  });

  it('Gemini 스트리밍: 마지막 usageMetadata(누적 총합)로 1회 정산한다', async () => {
    const chunks = [
      { candidates: [{ content: { parts: [{ text: '안' }] } }] }, // usageMetadata 없음
      {
        candidates: [{ content: { parts: [{ text: '녕' }] } }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 },
      }, // 중간 부분합
      {
        candidates: [{ content: { parts: [{ text: '!' }] } }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 },
      }, // 최종 총합
    ];
    const s = new MemoryStore();
    const { client, received } = fakeStreamClient(chunks);
    const ai = guard(
      client,
      { project: 'gem', dailyCapUSD: 99, store: s, provider: 'gemini' },
      { now: fixedNow },
    );
    const stream = await ai.create(
      { model: 'gemini-2.5-flash', stream: true },
      { feature: 'chat' },
    );
    await drain(stream as AsyncIterable<unknown>);
    const rep = await spendReport('gem', '2026-06-28', s);
    expect(rep.chat).toBeCloseTo(cost('gemini-2.5-flash', { input: 1000, output: 500 }), 10);
    expect(received[0].stream_options).toBeUndefined(); // Gemini에도 주입 금지
  });

  it("provider가 'anthropic'이면 stream_options를 주입하지 않는다", async () => {
    const { client, received } = fakeStreamClient([
      { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } },
      { type: 'message_delta', usage: { output_tokens: 5 } },
    ]);
    const ai = guard(
      client,
      { project: 'ant', dailyCapUSD: 99, provider: 'anthropic' },
      { now: fixedNow },
    );
    const stream = await ai.create({ model: 'claude-sonnet-4-6', stream: true, max_tokens: 50 });
    await drain(stream as AsyncIterable<unknown>);
    expect(received[0].stream).toBe(true);
    expect(received[0].stream_options).toBeUndefined(); // Anthropic에는 주입 금지
  });

  it('캡을 넘으면 스트리밍 호출도 호출 전에 차단한다', async () => {
    const s = new MemoryStore();
    const { client } = fakeStreamClient([finalUsageChunk]);
    const ai = guard(client, { project: 'cap', dailyCapUSD: 0.01, store: s }, { now: fixedNow });
    const first = await ai.create({ model: 'gpt-4o', stream: true });
    await drain(first as AsyncIterable<unknown>); // 0.0125 정산 → 캡 0.01 초과
    await expect(ai.create({ model: 'gpt-4o', stream: true })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });
});
