import { cost } from './cost.js';
import { normalizeUsage } from './usage.js';
import type { GuardOptions, Usage } from './types.js';

/** 호출별 비용 이벤트 (대시보드/로그용). */
export interface SpendEvent {
  project: string;
  feature: string;
  model: string;
  usd: number;
  dayTotalUsd: number;
}

interface GuardInternals<R> {
  /** 테스트용 주입 시계. 기본 실제 시각. */
  now?: () => Date;
  /** 비용 발생 시 콜백 (로깅/대시보드 전송). */
  onSpend?: (e: SpendEvent) => void;
  /** 제공자 응답에서 토큰 usage를 직접 뽑는 추출기 (자동 인식 안 될 때). */
  usageOf?: (res: R) => Usage;
}

/** 캡 초과로 호출이 차단될 때 던지는 에러. */
export class BudgetExceededError extends Error {
  constructor(
    public project: string,
    public spentUsd: number,
    public capUsd: number,
  ) {
    super(
      `🛡 Budget cap hit for "${project}": $${spentUsd.toFixed(2)} / $${capUsd} — call blocked`,
    );
    this.name = 'BudgetExceededError';
  }
}

// 앱 전역 장부: "project|feature|YYYY-MM-DD" -> 누적 USD.
// (한 프로젝트의 캡은 호출 위치와 무관하게 합산되어야 하므로 모듈 전역)
const ledger: Record<string, number> = {};
const SEP = '|';
const TOTAL = '__total__';

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type CreateArgs = { model: string; [k: string]: unknown };

/**
 * LLM 클라이언트를 감싸 (1) 하루 하드 캡으로 폭주를 차단하고
 * (2) project/feature별로 비용을 귀속한다. 실제 호출은 제공자로 그대로 나간다.
 *
 * @example
 *   const ai = guard(openai.chat.completions, { project: 'app', dailyCapUSD: 50 });
 *   await ai.create({ model: 'gpt-4o', messages }, { feature: 'summarize' });
 */
export function guard<R extends object>(
  client: { create(args: CreateArgs): Promise<R> },
  opts: GuardOptions,
  internals: GuardInternals<R> = {},
): { create(args: CreateArgs, tags?: { feature?: string }): Promise<R> } {
  const now = internals.now ?? (() => new Date());
  const onCap = opts.onCap ?? 'block';
  const extract = internals.usageOf ?? ((res: R) => normalizeUsage((res as { usage?: unknown }).usage));

  return {
    async create(args: CreateArgs, tags: { feature?: string } = {}): Promise<R> {
      const day = dayKey(now());
      const feature = tags.feature ?? 'default';
      const totalKey = `${opts.project}${SEP}${TOTAL}${SEP}${day}`;
      const spentToday = ledger[totalKey] ?? 0;

      // --- 하드 캡: 돈 나가는 호출 "전에" 차단 ---
      if (spentToday >= opts.dailyCapUSD) {
        const err = new BudgetExceededError(opts.project, spentToday, opts.dailyCapUSD);
        if (onCap === 'block') throw err;
        console.warn(err.message);
      }

      // --- 진짜 호출은 제공자에게 그대로 ---
      const res = await client.create(args);

      // --- 비용 적립 + 기능별 귀속 ---
      const usd = cost(args.model, extract(res));
      ledger[totalKey] = spentToday + usd;
      const featKey = `${opts.project}${SEP}${feature}${SEP}${day}`;
      ledger[featKey] = (ledger[featKey] ?? 0) + usd;

      internals.onSpend?.({
        project: opts.project,
        feature,
        model: args.model,
        usd,
        dayTotalUsd: ledger[totalKey],
      });

      return res;
    },
  };
}

/** 특정 프로젝트의 그날 기능별 비용 내역을 돌려준다. */
export function spendReport(
  project: string,
  day: string = dayKey(new Date()),
): Record<string, number> {
  const prefix = `${project}${SEP}`;
  const suffix = `${SEP}${day}`;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(ledger)) {
    if (k.startsWith(prefix) && k.endsWith(suffix)) {
      const feature = k.slice(prefix.length, k.length - suffix.length);
      if (feature !== TOTAL) out[feature] = v;
    }
  }
  return out;
}

/** 테스트 전용: 장부 초기화. */
export function _resetLedger(): void {
  for (const k of Object.keys(ledger)) delete ledger[k];
}
