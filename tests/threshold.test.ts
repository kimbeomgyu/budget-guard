import { describe, expect, it } from 'vitest';
import { guard } from '../src/guard';
import { MemoryStore } from '../src/store';
import type { Usage } from '../src/types';

// gpt-4o out $0.01/1K → 25000 out tokens = $0.25 (0.25는 이진 표현이 정확해 FP 누적 오차 없음)
const QUARTER: Usage = { input: 0, output: 25000 };

const okClient = () => ({
  async create(_args: { model: string }) {
    return { usage: QUARTER };
  },
});

describe('onThreshold (소프트 임계 경고)', () => {
  it('기본 80%: 넘는 순간 1회만 발화한다', async () => {
    const fired: Array<{ spentUsd: number; threshold: number }> = [];
    const ai = guard(okClient(), {
      project: 'th',
      dailyCapUSD: 2,
      store: new MemoryStore(),
      onThreshold: (e) => fired.push(e),
    });
    for (let i = 0; i < 6; i++) await ai.create({ model: 'gpt-4o' }); // $1.50 < $1.60
    expect(fired).toHaveLength(0);
    await ai.create({ model: 'gpt-4o' }); // $1.75 ≥ 80% of $2
    expect(fired).toHaveLength(1);
    expect(fired[0].spentUsd).toBe(1.75);
    expect(fired[0].threshold).toBe(0.8);
    await ai.create({ model: 'gpt-4o' }); // $2.00 — 재발화 없음
    expect(fired).toHaveLength(1);
  });

  it('thresholdFraction 커스텀 (50%)', async () => {
    const fired: number[] = [];
    const ai = guard(okClient(), {
      project: 'th2',
      dailyCapUSD: 2,
      store: new MemoryStore(),
      thresholdFraction: 0.5,
      onThreshold: (e) => fired.push(e.spentUsd),
    });
    for (let i = 0; i < 4; i++) await ai.create({ model: 'gpt-4o' }); // 4번째에 $1.00 = 50%
    expect(fired).toHaveLength(1);
    expect(fired[0]).toBe(1);
  });

  it('임계 아래면 침묵', async () => {
    const fired: number[] = [];
    const ai = guard(okClient(), {
      project: 'th3',
      dailyCapUSD: 10,
      store: new MemoryStore(),
      onThreshold: (e) => fired.push(e.spentUsd),
    });
    await ai.create({ model: 'gpt-4o' });
    expect(fired).toHaveLength(0);
  });
});
