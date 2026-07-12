import { enforceDailyCap, guard } from './guard.js';
import { streamUsageReader } from './stream.js';
import type { GuardOptions, Usage } from './types.js';
import { normalizeUsage } from './usage.js';

// LlamaIndex.TS LLM의 최소 형태(구조적 타이핑 — @llamaindex/core를 의존성으로 안 가짐).
interface LlamaChatResponse {
  raw: object | null; // 원본 제공자 응답(usage 포함) — normalizeUsage로 계량
  [k: string]: unknown;
}
interface LlamaLLM {
  metadata: { model: string; [k: string]: unknown };
  chat(params: { stream?: boolean; [k: string]: unknown }): Promise<unknown>;
  [k: string]: unknown;
}

/**
 * LlamaIndex.TS LLM을 감싸 호출 전 하드 캡 + 호출 후 정산을 붙인다.
 *   const llm = guardLlamaIndex(openai({ model: 'gpt-4o' }), { project: 'app', dailyCapUSD: 50 });
 *   Settings.llm = llm;  // 또는 llm.chat(...) 직접
 * 비스트리밍 chat은 guard()를 재사용(캡+계량, response.raw에서 usage).
 * 스트리밍 chat은 캡 검사 후 청크를 그대로 통과시키며, 각 청크의 raw를 3개 프로바이더
 * 리더(openai/anthropic/gemini)에 관찰시켜 스트림이 끝나면 잡힌 usage로 정산한다.
 * 프로바이더가 스트림에 usage를 안 실어주면(설정에 따라 OpenAI가 그럼) 경고만 찍고 넘어간다 —
 * 이미 소비된 스트림을 사후에 터뜨리는 게 더 나쁘므로. (계량 필요하면 프로바이더 SDK를 직접
 * guardOpenAI 등으로 감싸는 쪽이 정확하다.)
 */
export function guardLlamaIndex<T extends object>(
  llm: T,
  opts: GuardOptions & { feature?: string },
): T {
  const model = (llm as unknown as LlamaLLM).metadata.model;
  const tags = { feature: opts.feature };

  // 스트림 종료 시 정산 — guard()를 무한 캡으로 재사용해 적립/귀속/onSpend를 공짜로 얻는다
  // (LangChain 핸들러와 같은 패턴; 캡 검사는 이미 스트림 시작 전에 했음).
  const settle = async (usage: Usage) => {
    const rec = guard<{ usage: Usage }>(
      { create: async () => ({ usage }) },
      { ...opts, dailyCapUSD: Number.POSITIVE_INFINITY, estimateUsage: undefined },
    );
    await rec.create({ model }, tags);
  };

  async function* metered(stream: AsyncIterable<unknown>): AsyncGenerator<unknown> {
    // 어떤 프로바이더의 raw가 올지 모르므로 3개 리더에 전부 관찰시키고 잡히는 쪽을 쓴다.
    const readers = (['openai', 'anthropic', 'gemini'] as const).map(streamUsageReader);
    for await (const chunk of stream) {
      const raw = (chunk as { raw?: unknown } | null)?.raw;
      if (raw != null) for (const r of readers) r.observe(raw);
      yield chunk;
    }
    let usage: Usage | null = null;
    for (const r of readers) {
      try {
        usage = r.result();
      } catch {
        usage = null;
      }
      if (usage) break;
    }
    if (usage) await settle(usage);
    else
      console.warn(
        `budget-guard: no usage found in LlamaIndex stream for "${model}" — this stream was not metered`,
      );
  }

  const guardedChat = async (params: { stream?: boolean; [k: string]: unknown }) => {
    const call = () => (llm as unknown as LlamaLLM).chat(params);
    if (params?.stream) {
      await enforceDailyCap(opts);
      return metered((await call()) as AsyncIterable<unknown>);
    }
    const ai = guard<LlamaChatResponse>(
      { create: () => call() as Promise<LlamaChatResponse> },
      opts,
      {
        // raw는 제공자의 전체 응답 → usage는 그 안에 중첩(OpenAI/Anthropic: .usage, Gemini: .usageMetadata).
        usageOf: (r) => {
          const raw = r.raw as { usage?: unknown; usageMetadata?: unknown } | null;
          return normalizeUsage(raw?.usage ?? raw?.usageMetadata ?? raw);
        },
      },
    );
    return ai.create({ model }, tags);
  };

  return new Proxy(llm, {
    get(target, prop) {
      if (prop === 'chat') return guardedChat;
      // 나머지는 원본에 위임하되, 메서드는 원본에 바인딩(클래스 private 필드 보호 + getter this).
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
