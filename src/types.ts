/** 한 번의 LLM 호출이 쓴 토큰 수. 제공자가 응답의 usage로 알려준다. */
export interface Usage {
  input: number;
  output: number;
}

/** guard()에 넘기는 설정. */
export interface GuardOptions {
  /** 비용을 묶는 단위(예: 'agent-worker'). */
  project: string;
  /** 하루 하드 캡(USD). 초과하면 다음 호출을 막는다. */
  dailyCapUSD: number;
  /** 캡 초과 시 동작. 기본 'block'(throw) / 'warn'(경고만). */
  onCap?: 'block' | 'warn';
}
