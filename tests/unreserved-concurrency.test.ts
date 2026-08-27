import { describe, expect, it } from 'vitest';
import { guard } from '../src/guard';
import { MemoryStore } from '../src/store';
import type { Usage } from '../src/types';

// gpt-4o out $0.01/1K → 10000 out tokens = $0.10 (atomic.test.ts와 같은 단위)
const TEN_CENTS: Usage = { input: 0, output: 10000 };

const slowClient = () => ({
  calls: 0,
  async create(_args: { model: string }) {
    this.calls++;
    await new Promise((r) => setTimeout(r, 1)); // 체크와 정산 사이를 벌린다
    return { usage: TEN_CENTS };
  },
});

const totalOf = (store: MemoryStore, project: string) =>
  store.get(`${project}|__total__|${new Date().toISOString().slice(0, 10)}`);

// 비예약 경로에는 동시성 보장이 없다. README가 그렇게 말하도록 이 테스트가 붙잡는다.
// (예약 경로 = estimateUsage + store.addIfUnder + onCap 'block' → atomic.test.ts에서 검증)
describe('비예약 경로의 동시성 한계 (문서화된 동작)', () => {
  it('estimateUsage 없이 100개 동시 호출 → 전부 통과, 캡 $5를 2배 넘긴다', async () => {
    const store = new MemoryStore();
    const client = slowClient();
    const ai = guard(client, { project: 'unreserved', dailyCapUSD: 5, store });

    await Promise.all(Array.from({ length: 100 }, () => ai.create({ model: 'gpt-4o' })));

    // 100개가 전부 잔액 $0을 보고 통과한다 — 넘는 걸 아무도 못 본다.
    expect(client.calls).toBe(100);
    expect(await totalOf(store, 'unreserved')).toBeCloseTo(10, 6); // 캡 $5의 2배
  });

  it('estimateUsage만 있고 store가 예약을 못 하면 역시 넘는다', async () => {
    // addIfUnder 없는 최소 store — 예약 경로 조건이 깨져 비예약 경로로 폴백한다.
    const inner = new MemoryStore();
    const noReserve = {
      add: (k: string, a: number) => inner.add(k, a),
      get: (k: string) => inner.get(k),
      entries: (p: string) => inner.entries(p),
    };
    const client = slowClient();
    const ai = guard(client, {
      project: 'noreserve',
      dailyCapUSD: 5,
      store: noReserve,
      estimateUsage: () => TEN_CENTS,
    });

    await Promise.all(Array.from({ length: 100 }, () => ai.create({ model: 'gpt-4o' })));

    expect(client.calls).toBe(100);
    expect(
      await inner.get(`noreserve|__total__|${new Date().toISOString().slice(0, 10)}`),
    ).toBeCloseTo(10, 6);
  });

  it('순차 호출이면 비예약 경로는 딱 1회만 오버슛한다', async () => {
    const store = new MemoryStore();
    const client = slowClient();
    // 캡을 호출단가($0.10)의 정수배가 아닌 값으로 둔다 — 캡을 "넘는" 호출이 실제로 생기게.
    const ai = guard(client, { project: 'seq', dailyCapUSD: 5.05, store });

    let blocked = 0;
    for (let i = 0; i < 100; i++) {
      try {
        await ai.create({ model: 'gpt-4o' });
      } catch {
        blocked++;
      }
    }
    // 51번째가 잔액 $5.00(<$5.05)을 보고 통과해 $5.10으로 넘긴다. 그 다음부터 차단.
    expect(client.calls).toBe(51);
    expect(blocked).toBe(49);
    expect(await totalOf(store, 'seq')).toBeCloseTo(5.1, 6); // 오버슛 = 정확히 1회분
  });
});
