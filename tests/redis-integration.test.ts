/**
 * 실제 Redis 통합 테스트 — REDIS_URL이 있을 때만 실행 (CI 서비스 컨테이너 / 로컬 redis).
 * 없으면 통째로 skip: 유닛 스위트는 여전히 어디서나 돈다.
 * 검증 대상: redisStore의 Lua addIfUnder가 "진짜 서버"에서 원자적인가 (가짜 클라이언트 검증의 보완).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BudgetExceededError, guard } from '../src/guard';
import { redisStore } from '../src/store';
import type { Usage } from '../src/types';

const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)('redisStore + 실제 Redis', () => {
  // 동적 import: redis devDep이 없어도(소비자 환경) 이 파일이 로드 에러를 내지 않게.
  let client: import('redis').RedisClientType;
  const pre = `bg-it-${process.pid}:`;

  beforeAll(async () => {
    const { createClient } = await import('redis');
    client = createClient({ url: REDIS_URL }) as typeof client;
    await client.connect();
  });

  afterAll(async () => {
    // 이 런의 키만 청소
    for await (const key of client.scanIterator({ MATCH: `${pre}*`, COUNT: 200 })) {
      await client.del(key);
    }
    await client.quit();
  });

  it('add/get/entries가 실서버에서 동작한다', async () => {
    const s = redisStore(client, { keyPrefix: pre });
    expect(await s.add('p|f|2026-07-12', 0.5)).toBeCloseTo(0.5, 10);
    expect(await s.add('p|f|2026-07-12', 0.25)).toBeCloseTo(0.75, 10);
    expect(await s.get('p|f|2026-07-12')).toBeCloseTo(0.75, 10);
    const entries = await s.entries('p|');
    expect(entries).toContainEqual(['p|f|2026-07-12', 0.75]);
  });

  it('addIfUnder: 캡 아래 증가 / 초과 -1 무변경 / TTL 설정', async () => {
    const s = redisStore(client, { keyPrefix: pre, ttlSeconds: 3600 });
    expect(await s.addIfUnder?.('cap-key', 2, 5)).toBeCloseTo(2, 10);
    expect(await s.addIfUnder?.('cap-key', 4, 5)).toBe(-1);
    expect(await s.get('cap-key')).toBeCloseTo(2, 10);
    const ttl = await client.ttl(`${pre}cap-key`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  it('원자성: 100개 동시 $0.10 vs $5 캡 → 정확히 50개 성공, 최종값 5.00', async () => {
    const s = redisStore(client, { keyPrefix: pre });
    const results = await Promise.all(
      Array.from({ length: 100 }, () => Promise.resolve(s.addIfUnder?.('race', 0.1, 5))),
    );
    const ok = results.filter((r) => r !== -1).length;
    expect(ok).toBe(50);
    expect(await s.get('race')).toBeCloseTo(5, 6);
  });

  it('SCRIPT FLUSH 후에도 동작한다 (NOSCRIPT → EVAL 폴백 → 재적재)', async () => {
    const s = redisStore(client, { keyPrefix: pre });
    expect(await s.addIfUnder?.('ns', 1, 10)).toBeCloseTo(1, 10); // sha 적재됨
    await client.scriptFlush(); // 서버 재시작 시뮬레이션
    expect(await s.addIfUnder?.('ns', 1, 10)).toBeCloseTo(2, 10); // NOSCRIPT → EVAL 폴백
    expect(await s.addIfUnder?.('ns', 1, 10)).toBeCloseTo(3, 10); // sha 재적재 후 EVALSHA
  });

  it('guard 예약 경로가 실서버 위에서 end-to-end로 캡을 지킨다', async () => {
    const s = redisStore(client, { keyPrefix: pre });
    const TEN_CENTS: Usage = { input: 0, output: 10000 }; // gpt-4o $0.10
    let calls = 0;
    const ai = guard(
      {
        create: async () => {
          calls++;
          await new Promise((r) => setTimeout(r, 1));
          return { usage: TEN_CENTS };
        },
      },
      { project: `it-${process.pid}`, dailyCapUSD: 1, store: s, estimateUsage: () => TEN_CENTS },
    );
    const rs = await Promise.allSettled(
      Array.from({ length: 20 }, () => ai.create({ model: 'gpt-4o' })),
    );
    expect(rs.filter((r) => r.status === 'fulfilled').length).toBe(10);
    expect(
      rs.filter((r) => r.status === 'rejected' && r.reason instanceof BudgetExceededError).length,
    ).toBe(10);
    expect(calls).toBe(10);
  });
});
