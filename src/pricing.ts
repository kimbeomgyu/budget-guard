/**
 * 모델별 1K 토큰당 USD 단가. cachedIn = 캐시된 입력 토큰 요율(없으면 in 사용). retiresOn = 폐기일.
 * reasoningInOutput = 제공자가 reasoning 토큰을 output 카운트에 포함하는지(기본 true).
 * false인 제공자(xAI Grok: completion_tokens에서 제외 / Gemini: candidatesTokenCount에서 제외)는
 * cost()가 reasoning을 output 요율로 가산한다 — 안 하면 조용히 과소청구.
 * longContext = 입력(캐시 포함)이 above 토큰을 넘으면 그 요청 전체에 적용되는 상위 요율.
 */
export type Price = {
  in: number;
  out: number;
  cachedIn?: number;
  retiresOn?: string;
  reasoningInOutput?: boolean;
  longContext?: { above: number; in: number; out: number; cachedIn?: number };
};

// 인트로가·프로모가는 정식가(인상 후 가격)로 계상한다 — 캡 도구라 과대계상이 안전.
export const PRICES: Record<string, Price> = {
  // OpenAI — GPT-6 / 5.6 / 5.5 / 5.4 (2026-10-19 공식 가격표). 입력 272K 초과 시 longContext 요율.
  'gpt-6-astra': {
    in: 0.01,
    out: 0.05,
    cachedIn: 0.001,
    longContext: { above: 272_000, in: 0.02, out: 0.075, cachedIn: 0.002 },
  },
  'gpt-6.1-sol': {
    in: 0.002,
    out: 0.01,
    cachedIn: 0.0001,
    longContext: { above: 272_000, in: 0.004, out: 0.015, cachedIn: 0.0002 },
  },
  'gpt-6-sol': {
    in: 0.002,
    out: 0.01,
    cachedIn: 0.0002,
    longContext: { above: 272_000, in: 0.004, out: 0.015, cachedIn: 0.0004 },
  },
  'gpt-6-luna': {
    in: 0.0001,
    out: 0.0005,
    cachedIn: 0.00001,
    longContext: { above: 272_000, in: 0.0002, out: 0.00075, cachedIn: 0.00002 },
  },
  // gpt-5.6-sol은 최소 2026-11-21까지 프로모가($4/$20) — 정식가($5/$30)로 계상. 'gpt-5.6'은 sol 별칭.
  'gpt-5.6': {
    in: 0.005,
    out: 0.03,
    cachedIn: 0.0005,
    longContext: { above: 272_000, in: 0.01, out: 0.045, cachedIn: 0.001 },
  },
  'gpt-5.6-sol': {
    in: 0.005,
    out: 0.03,
    cachedIn: 0.0005,
    longContext: { above: 272_000, in: 0.01, out: 0.045, cachedIn: 0.001 },
  },
  'gpt-5.6-terra': {
    in: 0.002,
    out: 0.012,
    cachedIn: 0.0002,
    longContext: { above: 272_000, in: 0.004, out: 0.018, cachedIn: 0.0004 },
  },
  'gpt-5.6-luna': {
    in: 0.0002,
    out: 0.0012,
    cachedIn: 0.00002,
    longContext: { above: 272_000, in: 0.0004, out: 0.0018, cachedIn: 0.00004 },
  },
  'gpt-5.5': {
    in: 0.005,
    out: 0.03,
    cachedIn: 0.0005,
    longContext: { above: 272_000, in: 0.01, out: 0.045, cachedIn: 0.001 },
  },
  'gpt-5.4': {
    in: 0.0025,
    out: 0.015,
    cachedIn: 0.00025,
    longContext: { above: 272_000, in: 0.005, out: 0.0225, cachedIn: 0.0005 },
  },
  'gpt-5.4-pro': { in: 0.03, out: 0.18, longContext: { above: 272_000, in: 0.06, out: 0.27 } },
  'gpt-5.4-mini': { in: 0.00075, out: 0.0045, cachedIn: 0.000075 },
  'gpt-5.4-nano': { in: 0.0002, out: 0.00125, cachedIn: 0.00002 },
  // OpenAI 구세대 — 현역 명단에서 빠짐, 과거 로그 계상용으로 유지
  'gpt-4o': { in: 0.0025, out: 0.01, cachedIn: 0.00125 },
  'gpt-4o-mini': { in: 0.00015, out: 0.0006 },
  'gpt-4.1': { in: 0.002, out: 0.008, cachedIn: 0.0005 },
  o3: { in: 0.002, out: 0.008, cachedIn: 0.0005 },
  'o4-mini': { in: 0.0011, out: 0.0044, cachedIn: 0.000275 },
  // Anthropic — 키는 API 별칭 ID (응답 model 필드가 별칭인 현행 모델 기준)
  'claude-fable-5-1': { in: 0.01, out: 0.05, cachedIn: 0.00025 },
  'claude-mythos-5-1': { in: 0.01, out: 0.05, cachedIn: 0.00025 },
  'claude-fable-5': { in: 0.01, out: 0.05, cachedIn: 0.001 },
  'claude-mythos-5': { in: 0.01, out: 0.05, cachedIn: 0.001 },
  'claude-opus-5-5': { in: 0.004, out: 0.02, cachedIn: 0.0002 },
  'claude-opus-5': { in: 0.005, out: 0.025, cachedIn: 0.0005 },
  'claude-opus-4-8': { in: 0.005, out: 0.025, cachedIn: 0.0005 },
  'claude-opus-4-7': { in: 0.005, out: 0.025, cachedIn: 0.0005 },
  'claude-opus-4-6': { in: 0.005, out: 0.025, cachedIn: 0.0005 },
  'claude-opus-4-5': { in: 0.005, out: 0.025, cachedIn: 0.0005 },
  'claude-sonnet-5-5': { in: 0.002, out: 0.01, cachedIn: 0.0001 },
  // Sonnet 5 인트로가($2/$10)가 2026-09-01부터 정식가로 확정됨
  'claude-sonnet-5': { in: 0.002, out: 0.01, cachedIn: 0.0002 },
  'claude-sonnet-4-6': { in: 0.003, out: 0.015, cachedIn: 0.0003 },
  'claude-sonnet-4-5': { in: 0.003, out: 0.015, cachedIn: 0.0003 },
  // Haiku 5.5 — 프롬프트(캐시 읽기·쓰기 포함) 100K 초과 요청은 전체가 상위 요율
  'claude-haiku-5-5': {
    in: 0.0001,
    out: 0.0005,
    cachedIn: 0.00001,
    longContext: { above: 100_000, in: 0.0005, out: 0.0025, cachedIn: 0.00005 },
  },
  'claude-haiku-4-5': { in: 0.001, out: 0.005, cachedIn: 0.0001 },
  'claude-opus-4-0': { in: 0.015, out: 0.075, cachedIn: 0.0015 }, // 구 'claude-opus-4'는 무효 ID였음(별칭은 -0)
  // Google Gemini — thoughtsTokenCount는 candidatesTokenCount 밖 (출력 요율 가산 필요). 텍스트 요율 기준.
  // gemini-4-argon은 2026-12-01, 3.8/3.6-flash는 2027-01-01 인상 예정 — 인상가로 계상.
  'gemini-4-argon': { in: 0.004, out: 0.02, cachedIn: 0.0002, reasoningInOutput: false },
  'gemini-3.8-flash': { in: 0.0015, out: 0.0075, cachedIn: 0.00015, reasoningInOutput: false },
  'gemini-3.6-flash': { in: 0.0015, out: 0.0075, cachedIn: 0.00015, reasoningInOutput: false },
  'gemini-3.1-pro-preview': {
    in: 0.002,
    out: 0.012,
    cachedIn: 0.0002,
    reasoningInOutput: false,
    longContext: { above: 200_000, in: 0.004, out: 0.018, cachedIn: 0.0004 },
  },
  'gemini-3.1-pro-preview-customtools': {
    in: 0.002,
    out: 0.012,
    cachedIn: 0.0002,
    reasoningInOutput: false,
    longContext: { above: 200_000, in: 0.004, out: 0.018, cachedIn: 0.0004 },
  },
  'gemini-3-flash-preview': { in: 0.0005, out: 0.003, cachedIn: 0.00005, reasoningInOutput: false },
  'gemini-3.5-flash-lite': { in: 0.0003, out: 0.0025, cachedIn: 0.00003, reasoningInOutput: false },
  'gemini-3.1-flash-lite': {
    in: 0.00025,
    out: 0.0015,
    cachedIn: 0.000025,
    reasoningInOutput: false,
  },
  'gemini-2.5-pro': {
    in: 0.00125,
    out: 0.01,
    cachedIn: 0.000125,
    reasoningInOutput: false,
    longContext: { above: 200_000, in: 0.0025, out: 0.015, cachedIn: 0.00025 },
  },
  'gemini-2.5-flash': { in: 0.0003, out: 0.0025, cachedIn: 0.00003, reasoningInOutput: false },
  'gemini-2.5-flash-lite': { in: 0.0001, out: 0.0004, cachedIn: 0.00001, reasoningInOutput: false },
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
export function definePrice(model: string, price: Price): void {
  const bad = (p?: { in: number; out: number }) =>
    typeof p?.in !== 'number' || typeof p?.out !== 'number' || p.in < 0 || p.out < 0;
  if (bad(price) || (price.longContext !== undefined && bad(price.longContext))) {
    throw new Error(`definePrice("${model}"): in/out must be non-negative USD per 1K tokens`);
  }
  PRICES[model] = { ...price };
}
