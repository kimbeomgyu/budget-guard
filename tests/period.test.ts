import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetDefaultStore,
  BudgetExceededError,
  guard,
  periodKey,
  spentTotal,
} from '../src/guard';
import { MemoryStore } from '../src/store';

// gpt-4o 1000/1000 = $0.0125
const fakeClient = () => ({ create: async () => ({ usage: { input: 1000, output: 1000 } }) });
const at = (iso: string) => () => new Date(iso);

beforeEach(() => __resetDefaultStore());

describe('periodKey', () => {
  it('daily/UTC 기본은 ISO 날짜', () => {
    expect(periodKey(new Date('2026-07-01T03:30:00Z'))).toBe('2026-07-01');
  });
  it('monthly는 YYYY-MM', () => {
    expect(periodKey(new Date('2026-07-01T03:30:00Z'), 'monthly')).toBe('2026-07');
  });
  it('timezone은 현지 달력 기준 (03:30Z + America/New_York → 전날)', () => {
    expect(periodKey(new Date('2026-07-01T03:30:00Z'), 'daily', 'America/New_York')).toBe(
      '2026-06-30',
    );
  });
  it('monthly + timezone도 현지 기준 월', () => {
    expect(periodKey(new Date('2026-07-01T03:30:00Z'), 'monthly', 'America/New_York')).toBe(
      '2026-06',
    );
  });
});

describe('guard() period / timezone', () => {
  it('monthly: 같은 달 두 호출이 하나의 캡을 공유한다', async () => {
    const s = new MemoryStore();
    const ai = guard(
      fakeClient(),
      { project: 'm', dailyCapUSD: 0.02, period: 'monthly', store: s },
      { now: at('2026-07-15T00:00:00Z') },
    );
    await ai.create({ model: 'gpt-4o' }); // 0.0125
    await ai.create({ model: 'gpt-4o' }); // 0.025
    await expect(ai.create({ model: 'gpt-4o' })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(await spentTotal('m', s, '2026-07')).toBeCloseTo(0.025, 6); // 월 키에 적립
  });

  it('timezone이 캡 리셋 경계를 현지 날짜로 옮긴다', async () => {
    const s = new MemoryStore();
    const ai = guard(
      fakeClient(),
      { project: 'tz', dailyCapUSD: 99, store: s, timezone: 'America/New_York' },
      { now: at('2026-07-01T03:30:00Z') },
    );
    await ai.create({ model: 'gpt-4o' }, { feature: 'c' });
    expect(await spentTotal('tz', s, '2026-06-30')).toBeCloseTo(0.0125, 6); // NY 기준 전날
    expect(await spentTotal('tz', s, '2026-07-01')).toBe(0); // UTC 날짜엔 없음
  });

  it('daily/UTC 기본 동작은 그대로다(하위호환)', async () => {
    const s = new MemoryStore();
    const ai = guard(
      fakeClient(),
      { project: 'd', dailyCapUSD: 99, store: s },
      { now: at('2026-07-01T03:30:00Z') },
    );
    await ai.create({ model: 'gpt-4o' }, { feature: 'c' });
    expect(await spentTotal('d', s, '2026-07-01')).toBeCloseTo(0.0125, 6);
  });

  it('잘못된 timezone은 guard() 생성 시 throw한다', () => {
    expect(() =>
      guard(fakeClient(), { project: 'x', dailyCapUSD: 1, timezone: 'Not/AZone' }),
    ).toThrow();
  });
});
