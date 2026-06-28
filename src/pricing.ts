/** 모델별 1K 토큰당 USD 단가 [input, output]. 제공자 가격 변경 시 갱신. */
export const PRICES: Record<string, { in: number; out: number }> = {
  'gpt-4o':        { in: 0.0025,  out: 0.01   },
  'gpt-4o-mini':   { in: 0.00015, out: 0.0006 },
  'claude-opus-4': { in: 0.015,   out: 0.075  },
};
