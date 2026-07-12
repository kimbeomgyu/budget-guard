import { describe, expect, it, vi } from 'vitest';
import { guard } from '../src/guard';
import { MemoryStore } from '../src/store';
import type { SpendEvent } from '../src/types';

// 3번 실패 후 성공하는 클라이언트 (앱 레벨 재시도 루프 시뮬레이션)
function flakyClient(failures: number) {
  let n = 0;
  return {
    async create(_args: { model: string }) {
      if (n++ < failures) throw new Error('503 upstream');
      return { usage: { input: 1000, output: 1000 } }; // gpt-4o $0.0125
    },
  };
}

describe('리트라이 스톰 감지', () => {
  it('3회 재시도 → 1회만 정산, 스톰 이벤트 1회, SpendEvent.retryCount=3', async () => {
    const store = new MemoryStore();
    const onRetryStorm = vi.fn();
    const events: SpendEvent[] = [];
    const ai = guard(flakyClient(3), {
      project: 'storm',
      dailyCapUSD: 5,
      store,
      retryStormThreshold: 3,
      onRetryStorm,
      onSpend: (e) => events.push(e),
    });
    // 재시도 루프: 실패하면 다시 호출
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        await ai.create({ model: 'gpt-4o' }, { feature: 'job' });
        break;
      } catch {
        /* retry */
      }
    }
    // 최종 성공 1회만 정산
    const total = await store.get('storm|__total__|' + new Date().toISOString().slice(0, 10));
    expect(total).toBeCloseTo(0.0125, 8);
    expect(events).toHaveLength(1);
    expect(events[0].retryCount).toBe(3);
    // 스톰 이벤트는 임계 도달 시 정확히 1회
    expect(onRetryStorm).toHaveBeenCalledTimes(1);
    expect(onRetryStorm).toHaveBeenCalledWith({
      project: 'storm',
      feature: 'job',
      model: 'gpt-4o',
      consecutiveFailures: 3,
    });
    expect(ai.retryStats()).toEqual({ totalRetries: 3, retryStorms: 1 });
  });

  it('성공이 스트릭을 리셋한다 (2실패-성공-2실패-성공, 임계 3 → 스톰 없음)', async () => {
    const store = new MemoryStore();
    const onRetryStorm = vi.fn();
    let n = 0;
    // 패턴: 실패,실패,성공,실패,실패,성공
    const pattern = [false, false, true, false, false, true];
    const client = {
      async create(_args: { model: string }) {
        if (!pattern[n++]) throw new Error('503');
        return { usage: { input: 0, output: 1000 } };
      },
    };
    const ai = guard(client, {
      project: 'reset',
      dailyCapUSD: 5,
      store,
      retryStormThreshold: 3,
      onRetryStorm,
    });
    for (let i = 0; i < pattern.length; i++) {
      try {
        await ai.create({ model: 'gpt-4o' });
      } catch {
        /* retry */
      }
    }
    expect(onRetryStorm).not.toHaveBeenCalled();
    expect(ai.retryStats()).toEqual({ totalRetries: 4, retryStorms: 0 });
  });

  it('임계 미설정이면 이벤트 없이 통계만 쌓인다', async () => {
    const ai = guard(flakyClient(2), {
      project: 'plain',
      dailyCapUSD: 5,
      store: new MemoryStore(),
    });
    for (let i = 0; i < 5; i++) {
      try {
        await ai.create({ model: 'gpt-4o' });
        break;
      } catch {
        /* retry */
      }
    }
    expect(ai.retryStats()).toEqual({ totalRetries: 2, retryStorms: 0 });
  });

  it('feature가 다르면 스트릭이 섞이지 않는다', async () => {
    const onRetryStorm = vi.fn();
    const alwaysFail = {
      async create(_args: { model: string }): Promise<{ usage: unknown }> {
        throw new Error('503');
      },
    };
    const ai = guard(alwaysFail, {
      project: 'iso',
      dailyCapUSD: 5,
      store: new MemoryStore(),
      retryStormThreshold: 2,
      onRetryStorm,
    });
    const tryOnce = async (f: string) => {
      try {
        await ai.create({ model: 'gpt-4o' }, { feature: f });
      } catch {
        /* retry */
      }
    };
    // a 1회 + b 1회 실패 — 합치면 2지만 feature별 스트릭은 각 1 → 스톰 아님
    await tryOnce('a');
    await tryOnce('b');
    expect(onRetryStorm).not.toHaveBeenCalled();
    // a가 한 번 더 실패하면 a 스트릭만 2 → 스톰 1회, feature는 a
    await tryOnce('a');
    expect(onRetryStorm).toHaveBeenCalledTimes(1);
    expect(onRetryStorm.mock.calls[0][0].feature).toBe('a');
  });
});
