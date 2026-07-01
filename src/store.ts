/**
 * 지출 누적 저장소. 기본은 프로세스 내 메모리(MemoryStore).
 * 여러 인스턴스가 캡을 공유하려면 redisStore 등 공유 저장소를 넘긴다.
 * 모든 메서드는 동기/비동기 둘 다 허용(guard가 await로 흡수).
 */
export interface SpendStore {
  /** key의 누적값에 amount(USD)를 더하고 새 누적값을 돌려준다. 공유 저장소면 원자적이어야 함. */
  add(key: string, amountUSD: number): number | Promise<number>;
  /** key의 현재 누적값(없으면 0). */
  get(key: string): number | Promise<number>;
  /** prefix로 시작하는 모든 [key, total] 쌍 (spendReport용). */
  entries(prefix: string): Array<[string, number]> | Promise<Array<[string, number]>>;
}

/** 기본 저장소: 프로세스 내 메모리. 단일 프로세스 앱/스크립트/에이전트에 적합. */
export class MemoryStore implements SpendStore {
  private m = new Map<string, number>();
  add(key: string, amountUSD: number): number {
    const n = (this.m.get(key) ?? 0) + amountUSD;
    this.m.set(key, n);
    return n;
  }
  get(key: string): number {
    return this.m.get(key) ?? 0;
  }
  entries(prefix: string): Array<[string, number]> {
    const out: Array<[string, number]> = [];
    for (const [k, v] of this.m) if (k.startsWith(prefix)) out.push([k, v]);
    return out;
  }
  /** 테스트/리셋용. */
  clear(): void {
    this.m.clear();
  }
}

/** redisStore가 기대하는 최소 redis 클라이언트 형태 (node-redis v4 호환). */
export interface RedisLike {
  incrByFloat(key: string, amount: number): Promise<string | number>;
  get(key: string): Promise<string | null>;
  expire(key: string, seconds: number): Promise<unknown>;
  scan(
    cursor: number,
    opts: { MATCH: string; COUNT: number },
  ): Promise<{ cursor: number | string; keys: string[] }>;
}

/**
 * 여러 인스턴스가 캡을 공유하는 Redis 백엔드 저장소. (BYO 클라이언트 — redis를 의존성으로 안 가짐)
 * node-redis v4 기준: `redisStore(createClient())`. 키는 ttlSeconds(기본 2일) 후 만료되어 자연 일일 리셋.
 */
export function redisStore(
  client: RedisLike,
  opts: { ttlSeconds?: number; keyPrefix?: string } = {},
): SpendStore {
  const ttl = opts.ttlSeconds ?? 172800; // 2일
  const pre = opts.keyPrefix ?? 'bg:';
  const num = (v: string | number | null): number =>
    v == null ? 0 : typeof v === 'number' ? v : parseFloat(v);
  return {
    async add(key, amountUSD) {
      const k = pre + key;
      const n = await client.incrByFloat(k, amountUSD);
      await client.expire(k, ttl);
      return num(n);
    },
    async get(key) {
      return num(await client.get(pre + key));
    },
    async entries(prefix) {
      const out: Array<[string, number]> = [];
      let cursor: number = 0;
      do {
        const res = await client.scan(cursor, { MATCH: `${pre + prefix}*`, COUNT: 200 });
        cursor = Number(res.cursor);
        for (const fullKey of res.keys) {
          const v = await client.get(fullKey);
          if (v != null) out.push([fullKey.slice(pre.length), num(v)]);
        }
      } while (cursor !== 0);
      return out;
    },
  };
}
