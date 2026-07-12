import type { Usage } from './types.js';

/**
 * Claude의 신형 토크나이저 세대(Opus 4.7+, Sonnet 5+, Haiku 5+, Fable, Mythos)는
 * 같은 텍스트를 구세대보다 ~30% 많은 토큰으로 센다. 추정에 1.3×를 적용.
 */
export const NEW_TOKENIZER_MULTIPLIER = 1.3;

const NEW_TOKENIZER = /^claude-(fable|mythos|sonnet-[5-9]|haiku-[5-9]|opus-([5-9]|4-[7-9]))/;
// 토크나이저 세대를 아는 모델 계열 — 보정 불필요(1×).
const KNOWN_FAMILY = /^(gpt-|o[0-9]|chatgpt-|claude-|gemini-|grok-|deepseek-|mistral)/;

// 툴을 켰을 때 제공자가 프롬프트에 얹는 고정 오버헤드(토큰). 스키마 자체 토큰은 별도 가산.
// Anthropic은 tool_choice:auto 기준 ~294가 문서화된 값; 나머지는 스키마 토큰이 지배적이라 0.
const TOOL_BASE: Record<string, number> = {
  anthropic: 294,
  openai: 0,
  gemini: 0,
  xai: 0,
  deepseek: 0,
  mistral: 0,
};

function familyOf(model: string): string | null {
  if (/^claude-/.test(model)) return 'anthropic';
  if (/^(gpt-|o[0-9]|chatgpt-)/.test(model)) return 'openai';
  if (/^gemini-/.test(model)) return 'gemini';
  if (/^grok-/.test(model)) return 'xai';
  if (/^deepseek-/.test(model)) return 'deepseek';
  if (/^mistral/.test(model)) return 'mistral';
  return null;
}

export interface EstimatorOptions {
  /**
   * (선택) 정밀 토크나이저 주입 — 예: `gpt-tokenizer`의 `countTokens`.
   * 안 주면 chars/4 휴리스틱(영어 근사, 호출-전 차단용으로 충분).
   * 토크나이저를 의존성으로 강제하지 않기 위한 BYO 설계.
   */
  countTokens?: (text: string) => number;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

// 흔한 호출 인자 형태(prompt 문자열 / system / OpenAI·Anthropic messages)에서 입력 텍스트 수집.
function textOf(args: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof args.prompt === 'string') parts.push(args.prompt);
  if (typeof args.system === 'string') parts.push(args.system);
  if (Array.isArray(args.messages)) {
    for (const m of args.messages) {
      const c = (m as { content?: unknown } | null)?.content;
      if (typeof c === 'string') parts.push(c);
      else if (Array.isArray(c))
        for (const p of c) {
          const t = (p as { text?: unknown } | null)?.text;
          if (typeof t === 'string') parts.push(t);
        }
    }
  }
  return parts.join('\n');
}

/** 모델별 토크나이저 세대 보정 계수. 모르는 계열은 보수적으로 1.3× + 경고. */
export function tokenizerMultiplier(model: string): number {
  if (NEW_TOKENIZER.test(model)) return NEW_TOKENIZER_MULTIPLIER;
  if (KNOWN_FAMILY.test(model)) return 1;
  console.warn(
    `budget-guard: unknown model family "${model}" — applying conservative ${NEW_TOKENIZER_MULTIPLIER}x token estimate`,
  );
  return NEW_TOKENIZER_MULTIPLIER;
}

/**
 * `GuardOptions.estimateUsage`에 바로 꽂는 호출-전 usage 추정기를 만든다.
 * 입력 = 프롬프트/메시지 텍스트 토큰 × 토크나이저 세대 보정,
 * 출력 = 선언된 상한(max_tokens | maxOutputTokens | max_completion_tokens, 없으면 0).
 *
 * @example
 *   const ai = guard(client, { project: 'app', dailyCapUSD: 50, estimateUsage: estimator() });
 */
export function estimator(opts: EstimatorOptions = {}) {
  // ponytail: chars/4는 영어 근사 — 정밀도가 필요하면 countTokens로 실제 토크나이저 주입.
  const count = opts.countTokens ?? ((text: string) => Math.ceil(text.length / 4));
  return (args: { model: string; [k: string]: unknown }): Usage => {
    const mult = tokenizerMultiplier(args.model);
    let input = Math.ceil(count(textOf(args)) * mult);
    // 툴 정의는 프롬프트로 직렬화돼 입력 토큰을 먹는다: 스키마 토큰 + 제공자 고정 오버헤드.
    if (Array.isArray(args.tools) && args.tools.length > 0) {
      const fam = familyOf(args.model);
      if (fam == null)
        throw new Error(
          `budget-guard estimator: cannot estimate tool overhead for unknown model "${args.model}" — provide your own estimateUsage`,
        );
      input += Math.ceil(count(JSON.stringify(args.tools)) * mult) + TOOL_BASE[fam];
    }
    const output =
      num(args.max_tokens) ?? num(args.maxOutputTokens) ?? num(args.max_completion_tokens) ?? 0;
    return { input, output };
  };
}
