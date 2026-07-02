import { cost } from './cost.js';
import type { SpendStore } from './store.js';
import { MemoryStore } from './store.js';
import type { GuardOptions, SpendEvent, Usage } from './types.js';
import { normalizeUsage } from './usage.js';

// SpendEvent는 types.ts로 이동(공개 GuardOptions.onSpend가 참조). 하위호환 위해 여기서도 재노출.
export type { SpendEvent } from './types.js';

interface GuardInternals<R> {
  /** 테스트용 주입 시계. 기본 실제 시각. */
  now?: () => Date;
  /** (레거시/테스트용) 비용 콜백. 공개 API는 GuardOptions.onSpend. 둘 다 주면 opts 우선. */
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
    super(`🛡 Budget cap hit for "${project}": $${spentUsd.toFixed(2)} / $${capUsd} — call blocked`);
    this.name = 'BudgetExceededError';
  }
}

const SEP = '|';
const TOTAL = '__total__';

// 기본 저장소: 프로세스 전역 단일 인스턴스 → 같은 프로세스 안에서는 project별 캡이 공유된다.
const defaultStore = new MemoryStore();
/** 테스트 전용: 기본 메모리 저장소 초기화. */
export function __resetDefaultStore(): void {
  defaultStore.clear();
}

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
  const store: SpendStore = opts.store ?? defaultStore;
  const onSpend = opts.onSpend ?? internals.onSpend;
  const extract =
    internals.usageOf ?? ((res: R) => normalizeUsage((res as { usage?: unknown }).usage));

  return {
    async create(args: CreateArgs, tags: { feature?: string } = {}): Promise<R> {
      const day = dayKey(now());
      const feature = tags.feature ?? 'default';
      const totalKey = `${opts.project}${SEP}${TOTAL}${SEP}${day}`;
      const spentToday = await store.get(totalKey);

      // --- 하드 캡 (호출 전) ---
      // estimateUsage가 있으면 "이 호출이 넘길지"를 미리 보고 그 호출을 차단(overshoot 방지).
      // 없으면 이미 캡을 넘긴 경우 다음 호출을 차단.
      const projected = opts.estimateUsage
        ? spentToday + cost(args.model, opts.estimateUsage(args))
        : spentToday;
      const over = opts.estimateUsage
        ? projected > opts.dailyCapUSD
        : spentToday >= opts.dailyCapUSD;
      if (over) {
        opts.onExceeded?.({
          project: opts.project,
          spentUsd: spentToday,
          capUsd: opts.dailyCapUSD,
        });
        const err = new BudgetExceededError(opts.project, spentToday, opts.dailyCapUSD);
        if (onCap === 'block') throw err;
        console.warn(err.message);
      }

      // --- 비용 적립 + 기능별 귀속 (스트리밍/비스트리밍 공유) ---
      const recordCost = async (usage: Usage): Promise<void> => {
        const usd = cost(args.model, usage);
        const dayTotalUsd = await store.add(totalKey, usd);
        await store.add(`${opts.project}${SEP}${feature}${SEP}${day}`, usd);
        onSpend?.({ project: opts.project, feature, model: args.model, usd, dayTotalUsd });
      };

      // --- 스트리밍: 청크를 그대로 흘려보내며, 최종 청크의 usage로 정산 ---
      // OpenAI는 stream_options.include_usage를 켜야 마지막 청크에 usage가 실린다.
      if (args.stream === true) {
        const streamArgs = {
          ...args,
          stream_options: {
            ...((args.stream_options as Record<string, unknown>) ?? {}),
            include_usage: true,
          },
        };
        const stream = (await client.create(streamArgs)) as AsyncIterable<{ usage?: unknown }>;
        async function* metered(): AsyncGenerator<unknown> {
          let raw: unknown;
          for await (const chunk of stream) {
            if (chunk.usage != null) raw = chunk.usage; // usage는 최종 청크에만 실림
            yield chunk;
          }
          if (raw != null) await recordCost(normalizeUsage(raw));
        }
        return metered() as unknown as R;
      }

      // --- 비스트리밍: 응답을 그대로 돌려주고 usage로 정산 ---
      const res = await client.create(args);
      await recordCost(extract(res));
      return res;
    },
  };
}

/** 특정 프로젝트의 그날 기능별 비용 내역을 돌려준다. (기본 저장소 또는 넘긴 store 기준) */
export async function spendReport(
  project: string,
  day: string = dayKey(new Date()),
  store: SpendStore = defaultStore,
): Promise<Record<string, number>> {
  const prefix = `${project}${SEP}`;
  const suffix = `${SEP}${day}`;
  const out: Record<string, number> = {};
  for (const [k, v] of await store.entries(prefix)) {
    if (k.startsWith(prefix) && k.endsWith(suffix)) {
      const feature = k.slice(prefix.length, k.length - suffix.length);
      if (feature !== TOTAL) out[feature] = v;
    }
  }
  return out;
}
