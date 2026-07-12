import { guard } from './guard.js';
import type { StreamUsageReader } from './stream.js';
import type { GuardOptions, Usage } from './types.js';
import { UnknownUsageShapeError } from './usage.js';

// Vercel AI SDK usage. 'ai'를 의존성으로 안 가지려고 구조만 정의. 버전에 따라 두 형태:
// - v5 (LanguageModelV2): 평면 숫자 필드 (inputTokens: number, ...)
// - v7 (LanguageModelV4): 중첩 객체 (inputTokens: {total, noCache, cacheRead, cacheWrite},
//   outputTokens: {total, text, reasoning} — total은 reasoning을 이미 포함)
interface SdkUsage {
  inputTokens?: number | { total?: number; cacheRead?: number };
  outputTokens?: number | { total?: number; reasoning?: number };
  cachedInputTokens?: number;
  reasoningTokens?: number;
}
interface GenerateResult {
  usage?: SdkUsage;
  [k: string]: unknown;
}

function toUsage(u: SdkUsage | undefined): Usage {
  if (!u || (u.inputTokens == null && u.outputTokens == null)) throw new UnknownUsageShapeError(u);
  // v7 중첩 형태: total이 reasoning/cache를 이미 포함한 총계 → reasoning은 따로 싣지 않는다
  // (실어버리면 reasoningInOutput=false 모델에서 이중과금).
  if (typeof u.inputTokens === 'object' || typeof u.outputTokens === 'object') {
    const inp = typeof u.inputTokens === 'object' ? u.inputTokens : { total: u.inputTokens };
    const out = typeof u.outputTokens === 'object' ? u.outputTokens : { total: u.outputTokens };
    const usage: Usage = { input: inp?.total ?? 0, output: out?.total ?? 0 };
    if (inp?.cacheRead != null) usage.cachedInput = inp.cacheRead;
    return usage;
  }
  // v5 평면 형태 (기존 동작 그대로)
  const usage: Usage = { input: u.inputTokens ?? 0, output: u.outputTokens ?? 0 };
  if (u.cachedInputTokens != null) usage.cachedInput = u.cachedInputTokens;
  if (u.reasoningTokens != null) usage.reasoning = u.reasoningTokens;
  return usage;
}

// 스트림의 'finish' 파트에 실린 usage를 읽는 리더 (guard 스트리밍 경로에 주입).
// v5/v7 모두 finish 파트의 필드명은 'usage' — 형태 차이는 toUsage가 흡수.
function vercelStreamReader(): StreamUsageReader {
  let raw: SdkUsage | undefined;
  return {
    observe(part) {
      const p = part as { type?: string; usage?: SdkUsage } | null;
      if (p?.type === 'finish' && p.usage) raw = p.usage;
    },
    result: () => (raw == null ? null : toUsage(raw)),
  };
}

interface StreamResult {
  stream: ReadableStream<unknown>;
  [k: string]: unknown;
}

// async-iterable → ReadableStream (표준. ReadableStream.from은 타입에 없어 직접 변환.
// 소비자가 중간에 멈추면 하위 이터레이터도 정리.)
function toReadable(iter: AsyncIterable<unknown>): ReadableStream<unknown> {
  const it = iter[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await it.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel: (reason) => void it.return?.(reason),
  });
}

/**
 * Vercel AI SDK 미들웨어 (v5·v7 겸용, 한 진입점).
 * `wrapLanguageModel({ model, middleware: budgetGuardMiddleware(opts) })`로 끼운다.
 * 캡·비용 로직은 전부 guard()를 재사용 — 호출 전 하드 캡(초과 시 throw), 호출 후 usage 정산.
 * generateText(wrapGenerate) + streamText(wrapStream) 모두 계량한다.
 * usage 형태는 호출별 자동 감지: v5 평면(inputTokens: number) / v7 중첩(inputTokens.total).
 * (v7 미들웨어의 specificationVersion 필드는 선택이라 버전 필드 없이 양쪽에서 동작.)
 */
export function budgetGuardMiddleware(opts: GuardOptions & { feature?: string }) {
  const tags = { feature: opts.feature };
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
      return ai.create({ model: model.modelId }, tags);
    },

    wrapStream: async ({
      doStream,
      model,
    }: {
      doStream: () => Promise<StreamResult>;
      model: { modelId: string };
    }): Promise<StreamResult> => {
      let rest: StreamResult | undefined;
      // guard 스트리밍 경로 재사용: 캡은 doStream 전에 검사되고, 'finish' 파트에서 usage를 읽어 정산.
      const ai = guard<AsyncIterable<unknown>>(
        {
          create: async () => {
            rest = await doStream();
            return rest.stream as AsyncIterable<unknown>;
          },
        },
        opts,
        { streamReader: vercelStreamReader() },
      );
      const metered = await ai.create({ model: model.modelId, stream: true }, tags);
      return { ...(rest as StreamResult), stream: toReadable(metered) };
    },
  };
}
