import { describe, expect, it } from 'vitest';
import { BudgetExceededError, guard } from '../src/guard';
import { MemoryStore, type RedisLike, redisStore } from '../src/store';
import type { Usage } from '../src/types';

// gpt-4o out $0.01/1K → 10000 out tokens = $0.10
const TEN_CENTS: Usage = { input: 0, output: 10000 };

describe('MemoryStore.addIfUnder', () => {
  it('캡 아래면 더하고 새 누적값을 돌려준다', () => {
    const s = new MemoryStore();
    expect(s.addIfUnder('k', 2, 5)).toBe(2);
    expect(s.addIfUnder('k', 3, 5)).toBe(5); // 정확히 캡까지는 허용
  });

  it('캡을 넘기면 -1, 값은 그대로', () => {
    const s = new MemoryStore();
    s.add('k', 4.95);
    expect(s.addIfUnder('k', 0.1, 5)).toBe(-1);
    expect(s.get('k')).toBeCloseTo(4.95, 10);
  });
});

describe('guard 예약 경로 (TOCTOU 제거)', () => {
  const slowClient = (usage: Usage = TEN_CENTS) => ({
    calls: 0,
    async create(_args: { model: string }) {
      this.calls++;
      await new Promise((r) => setTimeout(r, 1)); // 체크와 정산 사이를 벌려 레이스 유발
      return { usage };
    },
  });

  it('100개 동시 $0.10 호출 vs $5 캡 → 정확히 50개 성공, 합계 ≤ $5.00', async () => {
    const store = new MemoryStore();
    const client = slowClient();
    const ai = guard(client, {
      project: 'fleet',
      dailyCapUSD: 5,
      store,
      estimateUsage: () => TEN_CENTS,
    });
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () => ai.create({ model: 'gpt-4o' })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const blocked = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof BudgetExceededError,
    ).length;
    expect(ok).toBe(50);
    expect(blocked).toBe(50);
    expect(client.calls).toBe(50); // 차단된 호출은 제공자로 안 나감
    const total = await store.get('fleet|__total__|' + new Date().toISOString().slice(0, 10));
    expect(total).toBeLessThanOrEqual(5.000000001);
    expect(total).toBeCloseTo(5, 6);
  });

  it('호출이 실패하면 예약을 되돌린다', async () => {
    const store = new MemoryStore();
    const ai = guard(
      {
        create: async (): Promise<{ usage: Usage }> => {
          throw new Error('provider down');
        },
      },
      { project: 'rb', dailyCapUSD: 5, store, estimateUsage: () => TEN_CENTS },
    );
    await expect(ai.create({ model: 'gpt-4o' })).rejects.toThrow('provider down');
    const total = await store.get('rb|__total__|' + new Date().toISOString().slice(0, 10));
    expect(total).toBe(0);
  });

  it('정산은 차액만: 추정 $0.10, 실비 $0.05면 합계는 $0.05', async () => {
    const store = new MemoryStore();
    const ai = guard(
      { create: async () => ({ usage: { input: 0, output: 5000 } as Usage }) }, // $0.05
      { project: 'settle', dailyCapUSD: 5, store, estimateUsage: () => TEN_CENTS },
    );
    await ai.create({ model: 'gpt-4o' });
    const total = await store.get('settle|__total__|' + new Date().toISOString().slice(0, 10));
    expect(total).toBeCloseTo(0.05, 10);
  });

  it("onCap 'warn'이면 예약 없이 기존 경로(경고 후 통과)", async () => {
    const store = new MemoryStore();
    store.add('warn|__total__|' + new Date().toISOString().slice(0, 10), 10); // 이미 초과
    const client = slowClient({ input: 0, output: 1000 });
    const ai = guard(client, {
      project: 'warn',
      dailyCapUSD: 5,
      store,
      onCap: 'warn',
      estimateUsage: () => TEN_CENTS,
    });
    await ai.create({ model: 'gpt-4o' }); // throw 없이 통과
    expect(client.calls).toBe(1);
  });
});

// Lua 실행 의미론(GET→비교→INCRBYFLOAT→EXPIRE)을 JS로 흉내내는 가짜 redis.
// 실제 Lua는 Redis 서버가 실행하므로 여기서 검증하는 건 우리 쪽 배선(EVALSHA→NOSCRIPT→EVAL 폴백)이다.
function fakeRedis(failFirstEvalSha = false): RedisLike & { m: Map<string, string> } {
  const m = new Map<string, string>();
  let failed = !failFirstEvalSha;
  const run = (keys: string[], args: string[]): string => {
    const cur = Number.parseFloat(m.get(keys[0]) ?? '0');
    const amt = Number.parseFloat(args[0]);
    if (cur + amt > Number.parseFloat(args[1])) return '-1';
    const n = cur + amt;
    m.set(keys[0], String(n));
    return String(n);
  };
  return {
    m,
    async incrByFloat(key, amount) {
      const n = Number.parseFloat(m.get(key) ?? '0') + amount;
      m.set(key, String(n));
      return String(n);
    },
    async get(key) {
      return m.get(key) ?? null;
    },
    async expire() {},
    async scan() {
      return { cursor: 0, keys: [...m.keys()] };
    },
    async scriptLoad() {
      return 'sha-add-if-under';
    },
    async evalSha(_sha, { keys, arguments: args }) {
      if (!failed) {
        failed = true;
        throw new Error('NOSCRIPT No matching script');
      }
      return run(keys, args);
    },
    async eval(_script, { keys, arguments: args }) {
      return run(keys, args);
    },
  };
}

describe('redisStore.addIfUnder (Lua 배선)', () => {
  it('캡 아래면 증가, 넘으면 -1 무변경', async () => {
    const r = fakeRedis();
    const s = redisStore(r);
    expect(await s.addIfUnder?.('k', 2, 5)).toBe(2);
    expect(await s.addIfUnder?.('k', 4, 5)).toBe(-1);
    expect(await s.get('k')).toBe(2);
  });

  it('EVALSHA가 NOSCRIPT면 EVAL로 폴백해 성공한다', async () => {
    const r = fakeRedis(true); // 첫 evalSha가 NOSCRIPT
    const s = redisStore(r);
    expect(await s.addIfUnder?.('k', 1, 5)).toBe(1); // 폴백 경로
    expect(await s.addIfUnder?.('k', 1, 5)).toBe(2); // 재적재 후 evalSha 경로
  });

  it('eval 미지원 클라이언트면 addIfUnder가 없다 (guard는 기존 경로 폴백)', () => {
    const { eval: _e, evalSha: _es, scriptLoad: _sl, ...legacy } = fakeRedis();
    const s = redisStore(legacy as RedisLike);
    expect(s.addIfUnder).toBeUndefined();
  });
});
