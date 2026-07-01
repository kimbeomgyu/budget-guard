import { describe, expect, it } from 'vitest';
import { MemoryStore, redisStore } from '../src/store';

describe('MemoryStore', () => {
  it('add는 누적하고 새 합계를 돌려준다', () => {
    const s = new MemoryStore();
    expect(s.add('a', 1)).toBe(1);
    expect(s.add('a', 0.5)).toBe(1.5);
    expect(s.get('a')).toBe(1.5);
    expect(s.get('missing')).toBe(0);
  });
  it('entries는 prefix로 거른다', () => {
    const s = new MemoryStore();
    s.add('p|f1|d', 1);
    s.add('p|f2|d', 2);
    s.add('other|f|d', 3);
    expect(s.entries('p|').sort()).toEqual([
      ['p|f1|d', 1],
      ['p|f2|d', 2],
    ]);
  });
  it('clear는 비운다', () => {
    const s = new MemoryStore();
    s.add('a', 1);
    s.clear();
    expect(s.get('a')).toBe(0);
  });
});

// node-redis v4 형태의 mock으로 어댑터 로직 검증 (실제 redis 없이)
function mockRedis() {
  const data = new Map<string, number>();
  const calls: string[] = [];
  return {
    data,
    calls,
    async incrByFloat(k: string, amt: number) {
      const n = (data.get(k) ?? 0) + amt;
      data.set(k, n);
      return String(n);
    },
    async get(k: string) {
      const v = data.get(k);
      return v == null ? null : String(v);
    },
    async expire(_k: string, _s: number) {
      calls.push('expire');
      return 1;
    },
    async scan(_cursor: number, opts: { MATCH: string; COUNT: number }) {
      calls.push('scan');
      const re = new RegExp(
        `^${opts.MATCH.replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === '*' ? '.*' : `\\${m}`))}$`,
      );
      return { cursor: 0, keys: [...data.keys()].filter((k) => re.test(k)) };
    },
  };
}

describe('redisStore (mock client)', () => {
  it('add는 prefix를 붙이고 숫자를 돌려주며 TTL을 건다', async () => {
    const c = mockRedis();
    const s = redisStore(c as never, { keyPrefix: 'bg:' });
    expect(await s.add('p|t|d', 0.25)).toBe(0.25);
    expect(c.data.get('bg:p|t|d')).toBe(0.25);
    expect(c.calls).toContain('expire');
  });
  it('get은 float로 파싱, 없으면 0', async () => {
    const c = mockRedis();
    const s = redisStore(c as never);
    await s.add('k', 1.5);
    expect(await s.get('k')).toBe(1.5);
    expect(await s.get('nope')).toBe(0);
  });
  it('entries는 prefix를 떼고 쌍을 돌려준다', async () => {
    const c = mockRedis();
    const s = redisStore(c as never);
    await s.add('p|f1|d', 1);
    await s.add('p|f2|d', 2);
    expect((await s.entries('p|')).sort()).toEqual([
      ['p|f1|d', 1],
      ['p|f2|d', 2],
    ]);
  });
});
