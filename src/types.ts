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

/**
 * 성공한 호출 한 건마다 방출되는 비용 이벤트.
 * `onSpend`로 받아 로깅·트레이싱·대시보드로 흘려보낼 수 있다
 * (하드 캡이 "차단"이라면 이건 "관측"쪽 절반).
 */
export interface SpendEvent {
  /** 비용을 묶는 단위(=GuardOptions.project). */
  project: string;
  /** 이 호출의 기능 태그(create 두 번째 인자). 기본 'default'. */
  feature: string;
  /** 호출에 쓰인 모델 id. */
  model: string;
  /** 이 호출 하나의 비용(USD). */
  usd: number;
  /** 이 project의 그날 누적 비용(USD, 이 호출 반영 후). */
  dayTotalUsd: number;
}

/** guard()에 넘기는 설정. */
export interface GuardOptions {
  /** 비용을 묶는 단위(예: 'agent-worker'). */
  project: string;
  /** 하드 캡(USD). 초과하면 호출을 막는다. (period='monthly'면 월간 한도.) */
  dailyCapUSD: number;
  /** 캡 리셋 주기. 기본 'daily'(매일) / 'monthly'(매월). */
  period?: 'daily' | 'monthly';
  /**
   * (선택) 캡 리셋 기준 IANA 타임존(예: 'America/New_York'). 기본 UTC.
   * 잘못된 값이면 guard() 생성 시 RangeError. (redisStore + monthly면 ttlSeconds를 한 달 이상으로.)
   */
  timezone?: string;
  /** 캡 초과 시 동작. 기본 'block'(throw) / 'warn'(경고만). */
  onCap?: 'block' | 'warn';
  /**
   * (선택) 응답/스트림에 usage가 없거나 인식 불가일 때 동작.
   * - 'throw'(기본): UnknownUsageShapeError를 던진다(모르는 걸 0으로 세지 않음 — 예산 정확도 안전).
   * - 'zero': 경고를 찍고 $0로 청구해 호출 흐름을 유지한다(정확도보다 앱 복원력 우선).
   */
  onMissingUsage?: 'throw' | 'zero';
  /**
   * (선택) 스트리밍 호출에서 provider를 명시. 프로바이더마다 usage 전달 방식이 달라서 필요.
   * - 'openai' | 미지정: 최종 청크의 usage를 읽고 `stream_options.include_usage`를 자동 주입.
   * - 'anthropic': message_start(input/캐시)+message_delta(누적 output)에서 usage를 조립. stream_options 주입 안 함.
   * - 'gemini': 스트림 청크의 `usageMetadata`(마지막 누적본)로 정산. stream_options 주입 안 함.
   * 비스트리밍 호출에는 영향 없음(응답 모양으로 자동 인식).
   */
  provider?: 'openai' | 'anthropic' | 'gemini';
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
  /**
   * (선택) 성공한 호출마다 비용 이벤트를 방출하는 콜백.
   * 하드 캡과 짝을 이루는 "관측" 훅 — 호출별 비용을 로그/트레이스/대시보드로 흘려보낸다.
   * 응답을 돌려주기 직전에 동기로 실행되므로 가볍게 유지할 것(무거운 작업은 큐에).
   */
  onSpend?: (event: SpendEvent) => void;
}
