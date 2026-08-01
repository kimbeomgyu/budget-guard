/**
 * 모델별 1K 토큰당 USD 단가. cachedIn = 캐시된 입력 토큰 요율(없으면 in 사용). retiresOn = 폐기일.
 * reasoningInOutput = 제공자가 reasoning 토큰을 output 카운트에 포함하는지(기본 true).
 * false인 제공자(xAI Grok: completion_tokens에서 제외 / Gemini: candidatesTokenCount에서 제외)는
 * cost()가 reasoning을 output 요율로 가산한다 — 안 하면 조용히 과소청구.
 */
export const PRICES: Record<
  string,
  { in: number; out: number; cachedIn?: number; retiresOn?: string; reasoningInOutput?: boolean }
> = {
  // OpenAI
  'gpt-4o': { in: 0.0025, out: 0.01, cachedIn: 0.00125 },
  'gpt-4o-mini': { in: 0.00015, out: 0.0006 },
  'gpt-4.1': { in: 0.002, out: 0.008, cachedIn: 0.0005 },
  o3: { in: 0.002, out: 0.008 },
  'o4-mini': { in: 0.0011, out: 0.0044 },
  // Anthropic — 키는 API 별칭 ID (응답 model 필드가 별칭인 현행 모델 기준)
  'claude-fable-5': { in: 0.01, out: 0.05, cachedIn: 0.001 },
  'claude-opus-5': { in: 0.005, out: 0.025, cachedIn: 0.0005 },
  'claude-opus-4-8': { in: 0.005, out: 0.025, cachedIn: 0.0005 },
  'claude-opus-4-7': { in: 0.005, out: 0.025, cachedIn: 0.0005 },
  'claude-opus-4-6': { in: 0.005, out: 0.025, cachedIn: 0.0005 },
  // Sonnet 5는 2026-08-31까지 인트로가($2/$10) — 정식가로 계상(캡 도구라 과대계상이 안전)
  'claude-sonnet-5': { in: 0.003, out: 0.015, cachedIn: 0.0003 },
  'claude-sonnet-4-6': { in: 0.003, out: 0.015, cachedIn: 0.0003 },
  'claude-haiku-4-5': { in: 0.001, out: 0.005, cachedIn: 0.0001 },
  'claude-opus-4-0': { in: 0.015, out: 0.075 }, // 구 'claude-opus-4'는 무효 ID였음(별칭은 -0)
  // Google Gemini — thoughtsTokenCount는 candidatesTokenCount 밖 (출력 요율 가산 필요)
  'gemini-2.5-pro': { in: 0.00125, out: 0.01, cachedIn: 0.000125, reasoningInOutput: false },
  'gemini-2.5-flash': { in: 0.0003, out: 0.0025, cachedIn: 0.00003, reasoningInOutput: false },
  'gemini-2.0-flash': { in: 0.0001, out: 0.0004, retiresOn: '2026-06-01' },
  // DeepSeek / xAI — Grok은 reasoning이 completion_tokens에서 제외됨
  'deepseek-v4-flash': { in: 0.00014, out: 0.00028, cachedIn: 0.0000028 },
  'grok-4.3': { in: 0.00125, out: 0.0025, cachedIn: 0.0002, reasoningInOutput: false },
  // AWS Bedrock (region prefixes like `us.`/`eu.` are stripped during lookup)
  'anthropic.claude-sonnet-4': { in: 0.003, out: 0.015 },
};

/**
 * 가격표에 없는(또는 갱신할) 모델 단가를 앱에서 등록한다. 1K 토큰당 USD.
 * 새 모델이 PRICES에 실리기 전에도 정확한 계량을 유지하는 공식 통로.
 */
export function definePrice(
  model: string,
  price: {
    in: number;
    out: number;
    cachedIn?: number;
    reasoningInOutput?: boolean;
    retiresOn?: string;
  },
): void {
  if (
    typeof price?.in !== 'number' ||
    typeof price?.out !== 'number' ||
    price.in < 0 ||
    price.out < 0
  ) {
    throw new Error(`definePrice("${model}"): in/out must be non-negative USD per 1K tokens`);
  }
  PRICES[model] = { ...price };
}
