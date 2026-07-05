import { guard } from './guard.js';
import type { GuardOptions, Usage } from './types.js';
import { UnknownUsageShapeError } from './usage.js';

// Vercel AI SDK v5 LanguageModelV2의 usage(평평한 토큰 필드). 'ai'를 의존성으로 안 가지려고 구조만 정의.
interface V2Usage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}
interface GenerateResult {
  usage?: V2Usage;
  [k: string]: unknown;
}

function toUsage(u: V2Usage | undefined): Usage {
  if (!u || (u.inputTokens == null && u.outputTokens == null)) throw new UnknownUsageShapeError(u);
  const usage: Usage = { input: u.inputTokens ?? 0, output: u.outputTokens ?? 0 };
  if (u.cachedInputTokens != null) usage.cachedInput = u.cachedInputTokens;
  if (u.reasoningTokens != null) usage.reasoning = u.reasoningTokens;
  return usage;
}

/**
 * Vercel AI SDK v5 미들웨어. `wrapLanguageModel({ model, middleware: budgetGuardMiddleware(opts) })`로 끼운다.
 * 캡·비용 로직은 전부 guard()를 재사용 — 호출 전 하드 캡(초과 시 throw), 호출 후 usage 정산.
 * ponytail: generateText(비스트리밍)만 계량한다. streamText용 wrapStream은 다음 항목(v7).
 */
export function budgetGuardMiddleware(opts: GuardOptions & { feature?: string }) {
  return {
    // 호출마다 새 guard: doGenerate가 매 호출 다르고, 동시 호출도 각자 격리돼야 하므로.
    wrapGenerate: async ({
      doGenerate,
      model,
    }: {
      doGenerate: () => Promise<GenerateResult>;
      model: { modelId: string };
    }): Promise<GenerateResult> => {
      const ai = guard<GenerateResult>({ create: () => doGenerate() }, opts, {
        usageOf: (r) => toUsage(r.usage),
      });
      return ai.create({ model: model.modelId }, { feature: opts.feature });
    },
  };
}
