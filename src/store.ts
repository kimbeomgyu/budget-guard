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
  /**
   * (선택) 원자적 check-and-increment: 현재값 + amount가 cap을 넘으면 아무것도 바꾸지 않고
   * -1을, 아니면 더한 뒤 새 누적값을 돌려준다. 있으면 guard가 estimateUsage와 함께
   * "예약 → 정산" 흐름으로 써서 동시 호출 TOCTOU 오버슛을 제거한다.
   */
  addIfUnder?(key: string, amountUSD: number, capUSD: number): number | Promise<number>;
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
  // 동기 실행이라 JS 이벤트 루프 안에서 그 자체로 원자적.
  addIfUnder(key: string, amountUSD: number, capUSD: number): number {
    const cur = this.m.get(key) ?? 0;
    if (cur + amountUSD > capUSD) return -1;
    const n = cur + amountUSD;
    this.m.set(key, n);
    return n;
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
  /** (선택) Lua 스크립트 지원 — 있으면 addIfUnder(원자적 캡 예약)가 켜진다. */
  scriptLoad?(script: string): Promise<string>;
  evalSha?(
    sha: string,
    opts: { keys: string[]; arguments: string[] },
  ): Promise<string | number | null>;
  eval?(
    script: string,
    opts: { keys: string[]; arguments: string[] },
  ): Promise<string | number | null>;
}

/**
 * 원자적 check-and-increment. GET→비교→INCRBYFLOAT가 한 스크립트로 서버에서 실행되므로
 * 여러 워커가 동시에 예약해도 캡을 넘는 예약은 정확히 거부된다(-1, 무변경).
 * INCRBYFLOAT 후 EXPIRE(add()와 동일한 자연 만료).
 */
const ADD_IF_UNDER_LUA = `local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
local amt = tonumber(ARGV[1])
if cur + amt > tonumber(ARGV[2]) then return '-1' end
local n = redis.call('INCRBYFLOAT', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return n`;

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

  // Lua 지원 클라이언트에만 addIfUnder 노출. SCRIPT LOAD 1회 → EVALSHA,
  // NOSCRIPT(재시작 등으로 스크립트 캐시 유실) 시 EVAL로 폴백 후 sha 재적재.
  let sha: string | undefined;
  const addIfUnder =
    client.eval || client.evalSha
      ? async (key: string, amountUSD: number, capUSD: number): Promise<number> => {
          const call = {
            keys: [pre + key],
            arguments: [String(amountUSD), String(capUSD), String(ttl)],
          };
          if (client.evalSha && client.scriptLoad) {
            sha = sha ?? (await client.scriptLoad(ADD_IF_UNDER_LUA));
            try {
              return num(await client.evalSha(sha, call));
            } catch (e) {
              if (!/NOSCRIPT/i.test(String(e)) || !client.eval) throw e;
              sha = undefined; // 다음 호출에서 재적재
            }
          }
          if (!client.eval) throw new Error('redis client lacks eval support');
          return num(await client.eval(ADD_IF_UNDER_LUA, call));
        }
      : undefined;

  return {
    ...(addIfUnder ? { addIfUnder } : {}),
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
