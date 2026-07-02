import type { SpendStore } from './store.js';

/** 한 번의 LLM 호출이 쓴 토큰 수. 제공자가 응답의 usage로 알려준다. */
export interface Usage {
  input: number;
  output: number;
  /** (선택) 입력 중 캐시된 토큰 수 — 보통 할인 요율로 과금됨. */
  cachedInput?: number;
  /** (선택) 추론(thinking) 토큰 수 — 보통 출력 요율로 과금됨. */
  reasoning?: number;
}

/** guard()에 넘기는 설정. */
export interface GuardOptions {
  /** 비용을 묶는 단위(예: 'agent-worker'). */
  project: string;
  /** 하루 하드 캡(USD). 초과하면 호출을 막는다. */
  dailyCapUSD: number;
  /** 캡 초과 시 동작. 기본 'block'(throw) / 'warn'(경고만). */
  onCap?: 'block' | 'warn';
  /**
   * 지출 저장소. 기본은 프로세스 공유 MemoryStore.
   * 여러 인스턴스가 캡을 공유하려면 redisStore 등을 넘긴다.
   */
  store?: SpendStore;
  /**
   * (선택) 호출 전 usage 추정기. 주면 "이 호출이 캡을 넘길지"를 호출 전에 판단해
   * 넘기는 호출 자체를 차단(overshoot 방지). 없으면 캡 초과 후 '다음' 호출을 차단.
   */
  estimateUsage?: (args: { model: string; [k: string]: unknown }) => Usage;
  /** (선택) 캡 초과가 감지될 때 호출되는 콜백. block/warn 동작 전에 실행됨. */
  onExceeded?: (info: { project: string; spentUsd: number; capUsd: number }) => void;
}
