import { beforeEach, describe, expect, it } from 'vitest';
import { cost } from '../src/cost';
import {
  __resetDefaultStore,
  guardAnthropic,
  guardGemini,
  guardOpenAI,
  spendReport,
} from '../src/guard';
import { MemoryStore } from '../src/store';

function fakeStreamClient(chunks: unknown[]) {
  const received: Array<Record<string, unknown>> = [];
  const client = {
    create: async (a: Record<string, unknown>) => {
      received.push(a);
      return (async function* () {
        for (const c of chunks) yield c;
      })();
    },
  };
  return { client, received };
}
const drain = async (s: AsyncIterable<unknown>) => {
  for await (const c of s) void c;
};

beforeEach(() => __resetDefaultStore());

describe('typed provider helpers', () => {
  it('guardAnthropic는 provider=anthropic로 스트리밍을 정산하고 stream_options를 주입하지 않는다', async () => {
    const chunks = [
      { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 1 } } },
      { type: 'message_delta', usage: { output_tokens: 120 } },
    ];
    const s = new MemoryStore();
    const { client, received } = fakeStreamClient(chunks);
    const ai = guardAnthropic(client, { project: 'a', dailyCapUSD: 99, store: s });
    await drain(await ai.create({ model: 'claude-sonnet-4-6', stream: true }, { feature: 'c' }));
    expect((await spendReport('a', undefined, s)).c).toBeCloseTo(
      cost('claude-sonnet-4-6', { input: 100, output: 120 }),
      10,
    );
    expect(received[0].stream_options).toBeUndefined(); // provider 자동설정 → 주입 안 함
  });

  it('guardGemini는 provider=gemini로 usageMetadata를 정산한다', async () => {
    const chunks = [{ usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 } }];
    const s = new MemoryStore();
    const { client, received } = fakeStreamClient(chunks);
    const ai = guardGemini(client, { project: 'g', dailyCapUSD: 99, store: s });
    await drain(await ai.create({ model: 'gemini-2.5-flash', stream: true }, { feature: 'c' }));
    expect((await spendReport('g', undefined, s)).c).toBeCloseTo(
      cost('gemini-2.5-flash', { input: 1000, output: 500 }),
      10,
    );
    expect(received[0].stream_options).toBeUndefined();
  });

  it('guardOpenAI는 기본 OpenAI 동작으로 비스트리밍 usage를 정산한다', async () => {
    const s = new MemoryStore();
    const client = {
      create: async () => ({ usage: { prompt_tokens: 1000, completion_tokens: 1000 } }),
    };
    const ai = guardOpenAI(client, { project: 'o', dailyCapUSD: 99, store: s });
    await ai.create({ model: 'gpt-4o' }, { feature: 'c' });
    expect((await spendReport('o', undefined, s)).c).toBeCloseTo(0.0125, 6);
  });
});
