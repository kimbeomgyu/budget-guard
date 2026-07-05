import { enforceDailyCap, guard } from './guard.js';
import type { GuardOptions } from './types.js';
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
 * 비스트리밍 chat은 guard()를 재사용(캡+계량, response.raw에서 usage). 스트리밍은 캡만 검사하고 통과.
 */
export function guardLlamaIndex<T extends object>(
  llm: T,
  opts: GuardOptions & { feature?: string },
): T {
  const model = (llm as unknown as LlamaLLM).metadata.model;
  const tags = { feature: opts.feature };

  const guardedChat = async (params: { stream?: boolean; [k: string]: unknown }) => {
    const call = () => (llm as unknown as LlamaLLM).chat(params);
    if (params?.stream) {
      // 스트리밍은 usage가 응답에 즉시 없으므로 지금은 캡만 강제하고 통과(계량은 다음 항목).
      await enforceDailyCap(opts);
      return call();
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
