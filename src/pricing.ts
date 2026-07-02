/** 모델별 1K 토큰당 USD 단가 [input, output]. 제공자 가격 변경 시 갱신. */
export const PRICES: Record<string, { in: number; out: number }> = {
  'gpt-4o': { in: 0.0025, out: 0.01 },
  'gpt-4o-mini': { in: 0.00015, out: 0.0006 },
  'claude-opus-4': { in: 0.015, out: 0.075 },
  // Google Gemini
  'gemini-2.5-pro': { in: 0.00125, out: 0.01 },
  'gemini-2.5-flash': { in: 0.0003, out: 0.0025 },
  // AWS Bedrock (region prefixes like `us.`/`eu.` are stripped during lookup)
  'anthropic.claude-sonnet-4': { in: 0.003, out: 0.015 },
};
