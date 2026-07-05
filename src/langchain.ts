import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';
import { BudgetExceededError, guard, spentTotal } from './guard.js';
import type { GuardOptions, Usage } from './types.js';
import { UnknownUsageShapeError } from './usage.js';

/** BudgetGuardHandler 옵션. `model`을 주면 정산 가격이 확실해짐(안 주면 응답에서 추출 시도). */
export type BudgetGuardHandlerOptions = GuardOptions & { feature?: string; model?: string };

interface LcUsageMetadata {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { cache_read?: number };
  output_token_details?: { reasoning?: number };
}

/** usage_metadata(신형)를 우선, 없으면 llmOutput.tokenUsage(구형)로 폴백. 둘을 합치지 않는다. */
function extractUsage(output: LLMResult): Usage | null {
  const gen = output.generations?.[0]?.[0] as
    | { message?: { usage_metadata?: LcUsageMetadata } }
    | undefined;
  const um = gen?.message?.usage_metadata;
  if (um && (um.input_tokens != null || um.output_tokens != null)) {
    const usage: Usage = { input: um.input_tokens ?? 0, output: um.output_tokens ?? 0 };
    const cacheRead = um.input_token_details?.cache_read;
    if (typeof cacheRead === 'number') usage.cachedInput = cacheRead;
    const reasoning = um.output_token_details?.reasoning;
    if (typeof reasoning === 'number') usage.reasoning = reasoning;
    return usage;
  }
  const tu = output.llmOutput?.tokenUsage as
    | { promptTokens?: number; completionTokens?: number }
    | undefined;
  if (tu && (tu.promptTokens != null || tu.completionTokens != null)) {
    return { input: tu.promptTokens ?? 0, output: tu.completionTokens ?? 0 };
  }
  return null;
}

/** 응답 메타데이터에서 모델명 추출(provider마다 위치가 달라 여러 곳을 본다). */
function extractModel(output: LLMResult): string | undefined {
  const gen = output.generations?.[0]?.[0] as
    | { message?: { response_metadata?: Record<string, unknown> } }
    | undefined;
  const rm = gen?.message?.response_metadata ?? {};
  const out = (output.llmOutput ?? {}) as Record<string, unknown>;
  return (rm.model ?? rm.model_name ?? out.model_name ?? out.model) as string | undefined;
}

/**
 * LangChain.js 콜백 핸들러. 호출 전에 하드 캡을 강제(초과 시 throw)하고, 호출 후 usage로 정산한다.
 *
 *   const handler = new BudgetGuardHandler({ project: 'app', dailyCapUSD: 50, model: 'gpt-4o' });
 *   await model.invoke(input, { callbacks: [handler] });
 *
 * 정산은 guard()를 재사용한다(무한 캡 = 순수 계량; cost/키/onSpend 그대로).
 */
export class BudgetGuardHandler extends BaseCallbackHandler {
  name = 'budget_guard';
  // 콜백에서 throw한 캡 에러가 실제로 호출을 중단시키도록(기본값이면 삼켜짐).
  awaitHandlers = true;
  raiseError = true;

  constructor(private readonly opts: BudgetGuardHandlerOptions) {
    super();
  }

  private async enforceCap(): Promise<void> {
    const spent = await spentTotal(this.opts.project, this.opts.store);
    if (spent >= this.opts.dailyCapUSD) {
      this.opts.onExceeded?.({
        project: this.opts.project,
        spentUsd: spent,
        capUsd: this.opts.dailyCapUSD,
      });
      const err = new BudgetExceededError(this.opts.project, spent, this.opts.dailyCapUSD);
      if ((this.opts.onCap ?? 'block') === 'block') throw err;
      console.warn(err.message);
    }
  }

  async handleLLMStart(): Promise<void> {
    await this.enforceCap();
  }

  async handleChatModelStart(): Promise<void> {
    await this.enforceCap();
  }

  async handleLLMEnd(output: LLMResult): Promise<void> {
    const model = this.opts.model ?? extractModel(output);
    if (model == null) {
      console.warn(
        'budget-guard: could not determine the model at handleLLMEnd — pass { model } to BudgetGuardHandler to meter this call.',
      );
      return;
    }
    let usage = extractUsage(output);
    if (usage == null) {
      if ((this.opts.onMissingUsage ?? 'throw') === 'throw') {
        throw new UnknownUsageShapeError(output);
      }
      console.warn(
        `budget-guard: usage missing for "${model}" — billing $0 (onMissingUsage: 'zero')`,
      );
      usage = { input: 0, output: 0 };
    }
    // ponytail: 무한 캡 → guard가 차단 없이 순수 정산만. 캡은 start에서 이미 강제됨.
    const finalUsage = usage;
    const meter = guard(
      { create: async () => ({}) },
      {
        project: this.opts.project,
        dailyCapUSD: Number.POSITIVE_INFINITY,
        store: this.opts.store,
        onSpend: this.opts.onSpend,
      },
      { usageOf: () => finalUsage },
    );
    await meter.create({ model }, { feature: this.opts.feature });
  }
}

/** BudgetGuardHandler 생성 헬퍼. */
export function budgetGuardHandler(opts: BudgetGuardHandlerOptions): BudgetGuardHandler {
  return new BudgetGuardHandler(opts);
}
